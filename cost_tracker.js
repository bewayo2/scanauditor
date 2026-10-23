'use strict';

const fs = require('fs-extra');
const path = require('path');
const readline = require('readline');

// USD per one million tokens: OpenAI standard pricing, checked 2026-10-20.
// Review pricing regularly. These are estimates, not invoice reconciliation.
const MODEL_PRICING = Object.freeze({
  'gpt-6-luna': Object.freeze({ input: 0.10, cachedInput: 0.01, output: 0.50 }),
  'gpt-6.1-sol': Object.freeze({ input: 2.00, cachedInput: 0.10, output: 10.00 }),
  'gpt-6-astra': Object.freeze({ input: 10.00, cachedInput: 1.00, output: 50.00 })
});
const DEFAULT_PLAN = Object.freeze({
  targetPages: null,
  targetFiles: null,
  selectedRunId: null,
  forecastBasis: 'latest-run',
  estimatedInputTokensPerPage: 5000,
  estimatedOutputTokensPerPage: 500,
  fallbackPercent: 10
});

function finiteRange(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : fallback;
}
function validatePlan(value = {}) {
  return {
    // Latest matching run is preferred; history counts scans, not unique documents.
    forecastBasis: ['historical', 'selected-run'].includes(value.forecastBasis) ? value.forecastBasis : 'latest-run',
    selectedRunId: typeof value.selectedRunId === 'string' && /^[a-zA-Z0-9:_-]{1,100}$/.test(value.selectedRunId)
      ? value.selectedRunId : null,
    targetFiles: value.targetFiles === '' || value.targetFiles == null ||
      !Number.isSafeInteger(Number(value.targetFiles)) ||
      Number(value.targetFiles) < 1 || Number(value.targetFiles) > 100000000
      ? null : Number(value.targetFiles),
    // Optional extrapolation, never the page count of the current run.
    targetPages: value.targetPages === '' || value.targetPages == null ||
      !Number.isSafeInteger(Number(value.targetPages)) ||
      Number(value.targetPages) < 1 || Number(value.targetPages) > 100000000
      ? null : Number(value.targetPages),
    estimatedInputTokensPerPage: Math.floor(finiteRange(value.estimatedInputTokensPerPage, DEFAULT_PLAN.estimatedInputTokensPerPage, 1, 1000000)),
    estimatedOutputTokensPerPage: Math.floor(finiteRange(value.estimatedOutputTokensPerPage, DEFAULT_PLAN.estimatedOutputTokensPerPage, 1, 100000)),
    fallbackPercent: finiteRange(value.fallbackPercent, DEFAULT_PLAN.fallbackPercent, 0, 100)
  };
}
function usageCost(model, usage = {}) {
  const rate = MODEL_PRICING[model];
  if (!rate) return 0;
  const input = Math.max(0, Number(usage.input_tokens) || 0);
  const output = Math.max(0, Number(usage.output_tokens) || 0);
  const cached = Math.min(input, Math.max(0, Number(usage.input_tokens_details?.cached_tokens) || 0));
  return ((input - cached) * rate.input + cached * rate.cachedInput + output * rate.output) / 1000000;
}
function planningPerPage(plan, mode = 'tiered') {
  const p = validatePlan(plan);
  const tokens = { input_tokens: p.estimatedInputTokensPerPage, output_tokens: p.estimatedOutputTokensPerPage };
  if (mode === 'astra') return usageCost('gpt-6-astra', tokens);
  if (mode === 'local') return 0;
  return usageCost('gpt-6-luna', tokens) + p.fallbackPercent / 100 * usageCost('gpt-6.1-sol', tokens);
}
function summarizeCost(entries, plan, mode = 'tiered', lastRun = null, runs = []) {
  const p = validatePlan(plan);
  const allPages = new Set();
  const runPages = new Set();
  const historicalPages = new Set();
  const historicalRunIds = new Set();
  const selectedRunMetrics = new Map();
  const selectedModeModels = mode === 'astra'
    ? new Set(['gpt-6-astra'])
    : mode === 'tiered' ? new Set(['gpt-6-luna', 'gpt-6.1-sol']) : new Set();
  const modelSpend = {};
  let recordedSpendUSD = 0;
  let runSpendUSD = 0;
  let historicalSpendUSD = 0;
  let legacySpendExcludedUSD = 0;
  let chargedCalls = 0;

  for (const entry of entries) {
    if (!entry || !Object.hasOwn(MODEL_PRICING, entry.model)) continue;
    const cost = usageCost(entry.model, entry.usage);
    recordedSpendUSD += cost;
    chargedCalls += 1;
    modelSpend[entry.model] = (modelSpend[entry.model] || 0) + cost;

    // A page scanned on two occasions is two paid page-processing events.
    // Deduplicate Luna/Sol calls for the SAME page WITHIN a run, not between runs.
    const runId = typeof entry.runId === 'string' && entry.runId ? entry.runId : null;
    const pageKey = typeof entry.pageKey === 'string' && entry.pageKey ? entry.pageKey : null;
    if (pageKey) allPages.add(JSON.stringify([runId || 'legacy', pageKey]));
    if (selectedModeModels.has(entry.model)) {
      if (runId) {
        if (!selectedRunMetrics.has(runId)) selectedRunMetrics.set(runId, { spendUSD: 0, pages: new Set() });
        const sample = selectedRunMetrics.get(runId);
        sample.spendUSD += cost;
        if (pageKey) sample.pages.add(pageKey);
        historicalSpendUSD += cost;
        if (pageKey) {
          historicalPages.add(JSON.stringify([runId, pageKey]));
          historicalRunIds.add(runId);
        }
      } else {
        // Older usage rows cannot be assigned reliably to an individual run.
        // Include their dollars in lifetime spend, but not an observed per-page forecast.
        legacySpendExcludedUSD += cost;
      }
    }
    if (lastRun && runId && runId === lastRun.runId) {
      runSpendUSD += cost;
      if (pageKey) runPages.add(pageKey);
    }
  }

  const knownPages = lastRun && Number.isSafeInteger(lastRun.totalPages) && lastRun.totalPages >= 0
    ? lastRun.totalPages : 0;
  const activeMode = lastRun?.mode || 'local';
  const isCloudRun = activeMode === 'tiered' || activeMode === 'astra';
  const meteredRunPages = runPages.size;
  const estimatedRunPerPage = isCloudRun ? planningPerPage(p, activeMode) : 0;
  const observedRunPerPage = isCloudRun && meteredRunPages
    ? runSpendUSD / meteredRunPages : null;
  const runPerPage = observedRunPerPage === null ? estimatedRunPerPage : observedRunPerPage;
  const unmeteredRunPages = Math.max(0, knownPages - meteredRunPages);
  const runProjectedTotalUSD = runSpendUSD + unmeteredRunPages * runPerPage;

  // Build run samples from the run ledger, never infer file counts from OCR
  // usage events. Only runs in the chosen model mode may set a per-file rate.
  const seen = new Set();
  const allRecordedRuns = Array.isArray(runs) && runs.length ? runs : lastRun ? [lastRun] : [];
  const runSamples = [];
  for (const record of allRecordedRuns) {
    if (!record || typeof record.runId !== 'string' || seen.has(record.runId)) continue;
    seen.add(record.runId);
    if (!['tiered', 'astra', 'local'].includes(record.mode)) continue;
    const fileCount = Number(record.fileCount);
    const totalPages = Number(record.totalPages);
    const pagesUnknown = Number(record.pagesUnknown) || 0;
    const sample = selectedRunMetrics.get(record.runId);
    const spendUSD = record.mode === mode ? (sample?.spendUSD || 0) : 0;
    const meteredPages = record.mode === mode ? (sample?.pages.size || 0) : 0;
    const usableCount = Number.isSafeInteger(fileCount) && fileCount > 0 &&
      Number.isSafeInteger(totalPages) && totalPages >= 0 &&
      Number.isSafeInteger(pagesUnknown) && pagesUnknown === 0 &&
      (record.mode === 'local' || meteredPages > 0);
    const extraPages = Math.max(0, totalPages - meteredPages);
    const extrapolatedSpendUSD = record.mode === 'local' ? 0 :
      meteredPages ? spendUSD + extraPages * spendUSD / meteredPages : null;
    runSamples.push({
      runId: record.runId, timestamp: String(record.timestamp || ''),
      mode: record.mode, fileCount: Number.isSafeInteger(fileCount) && fileCount >= 0 ? fileCount : 0,
      totalPages: Number.isSafeInteger(totalPages) && totalPages >= 0 ? totalPages : 0,
      pagesUnknown, meteredPages, recordedSpendUSD: spendUSD,
      observedPerPageUSD: meteredPages ? spendUSD / meteredPages : null,
      forecastPerFileUSD: usableCount ? extrapolatedSpendUSD / fileCount : null,
      estimatedUnmeteredPages: usableCount && extraPages > 0
    });
  }
  const matchingRuns = runSamples.filter(item => item.mode === mode);
  const latestMatching = matchingRuns.length ? matchingRuns[matchingRuns.length - 1] : null;
  const selected = p.selectedRunId ? matchingRuns.find(item => item.runId === p.selectedRunId) : null;
  // Historical file weighting counts files processed in comparable runs,
  // rather than assigning equal influence to one-file and thousand-file runs.
  // Partial scans are excluded: otherwise the per-file rate is understated.
  const historicalFileSamples = matchingRuns.filter(item =>
    item.forecastPerFileUSD !== null && item.pagesUnknown === 0 &&
    (mode === 'local' || item.meteredPages === item.totalPages));
  const historicalFileCount = historicalFileSamples.reduce((sum, item) => sum + item.fileCount, 0);
  const historicalFileSpendUSD = historicalFileSamples.reduce((sum, item) => sum + item.recordedSpendUSD, 0);
  const historicalPerFile = historicalFileCount ? historicalFileSpendUSD / historicalFileCount : null;

  const historicalPerPage = historicalPages.size ? historicalSpendUSD / historicalPages.size : null;
  let targetPerPage;
  let targetPerFile;
  let targetForecastSource;
  if (mode === 'local') {
    targetPerPage = 0;
    targetPerFile = 0;
    targetForecastSource = 'local';
  } else if (p.forecastBasis === 'selected-run') {
    // Strict isolation: never silently replace the chosen run with history.
    targetPerPage = selected?.observedPerPageUSD ?? null;
    targetPerFile = selected?.forecastPerFileUSD ?? null;
    targetForecastSource = targetPerPage === null ? 'selected-run-unavailable' : 'selected-run';
  } else if (p.forecastBasis === 'latest-run' && latestMatching?.observedPerPageUSD !== null &&
      latestMatching?.observedPerPageUSD !== undefined) {
    targetPerPage = latestMatching.observedPerPageUSD;
    targetPerFile = latestMatching.forecastPerFileUSD;
    targetForecastSource = 'latest-run';
  } else {
    targetPerPage = historicalPerPage === null ? planningPerPage(p, mode) : historicalPerPage;
    targetPerFile = historicalPerFile;
    targetForecastSource = historicalPerPage === null ? 'planning-assumption' :
      p.forecastBasis === 'historical' ? 'historical' : 'historical-fallback';
  }
  const forecastFileSample = p.forecastBasis === 'selected-run' ? selected :
    p.forecastBasis === 'latest-run' ? latestMatching : null;
  // The UI lists recent run IDs/dates/counts only. No filenames or patient data.
  const recentRuns = runSamples.slice(-200).reverse().map(item => ({
    runId: item.runId, timestamp: item.timestamp, mode: item.mode,
    fileCount: item.fileCount, totalPages: item.totalPages,
    meteredPages: item.meteredPages,
    recordedSpendUSD: item.recordedSpendUSD,
    fileRateAvailable: item.forecastPerFileUSD !== null && item.mode !== 'local'
  }));
  if (selected && !recentRuns.some(item => item.runId === selected.runId)) {
    recentRuns.push({
      runId: selected.runId, timestamp: selected.timestamp, mode: selected.mode,
      fileCount: selected.fileCount, totalPages: selected.totalPages,
      meteredPages: selected.meteredPages,
      recordedSpendUSD: selected.recordedSpendUSD,
      fileRateAvailable: selected.forecastPerFileUSD !== null
    });
  }

  return {
    plan: p,
    currency: 'USD',
    mode, pricing: MODEL_PRICING, byModel: modelSpend,
    recordedSpendUSD, chargedCalls, allTimeMeteredPages: allPages.size,
    run: lastRun ? {
      runId: lastRun.runId, mode: activeMode, fileCount: lastRun.fileCount,
      totalPages: knownPages, pagesUnknown: lastRun.pagesUnknown || 0,
      meteredPages: meteredRunPages, unmeteredPages: unmeteredRunPages,
      recordedSpendUSD: runSpendUSD,
      observedPerPageUSD: observedRunPerPage,
      forecastPerPageUSD: runPerPage,
      projectedTotalUSD: runProjectedTotalUSD,
      costBasis: observedRunPerPage === null ? 'planning-assumption' : 'observed-api-usage'
    } : null,
    historicalMeteredPages: historicalPages.size,
    historicalMeteredRuns: historicalRunIds.size,
    historicalSpendUSD,
    historicalPerPageUSD: historicalPerPage,
    legacySpendExcludedUSD,
    targetPages: p.targetPages,
    targetFiles: p.targetFiles,
    targetForecastPerPageUSD: targetPerPage,
    targetProjectionUSD: p.targetPages === null || targetPerPage === null ? null : targetPerPage * p.targetPages,
    targetForecastPerFileUSD: targetPerFile,
    targetFilesProjectionUSD: p.targetFiles === null || targetPerFile === null ? null : targetPerFile * p.targetFiles,
    forecastFileSample: forecastFileSample ? {
      runId: forecastFileSample.runId, fileCount: forecastFileSample.fileCount,
      meteredPages: forecastFileSample.meteredPages,
      totalPages: forecastFileSample.totalPages,
      estimatedUnmeteredPages: forecastFileSample.estimatedUnmeteredPages
    } : null,
    historicalFileCount, historicalFileSpendUSD,
    runs: recentRuns,
    targetForecastSource,
    targetCostBasis: ['latest-run', 'selected-run', 'historical', 'historical-fallback'].includes(targetForecastSource)
      ? 'observed-api-usage' : 'planning-assumption',
    disclaimer: 'API usage estimates only, not the provider invoice. Excludes unmetered failed requests, taxes, special processing tiers and other account activity.'
  };
}
function costDirectory(userData) { return path.join(userData, 'cost-tracker'); }
async function loadPlan(userData) {
  try { return validatePlan(await fs.readJson(path.join(costDirectory(userData), 'plan.json'))); }
  catch (_) { return validatePlan(); }
}
async function savePlan(userData, plan) {
  const clean = validatePlan(plan);
  await fs.ensureDir(costDirectory(userData));
  await fs.writeJson(path.join(costDirectory(userData), 'plan.json'), clean, { spaces: 2 });
  return clean;
}
async function recordUsage(userData, entry) {
  if (!Object.hasOwn(MODEL_PRICING, entry?.model)) return;
  const u = entry.usage || {};
  const safe = {
    timestamp: new Date().toISOString(),
    model: entry.model,
    pageKey: typeof entry.pageKey === 'string' ? entry.pageKey.slice(0, 100) : null,
    runId: typeof entry.runId === 'string' ? entry.runId.slice(0, 100) : null,
    input_tokens: Math.max(0, Math.floor(Number(u.input_tokens) || 0)),
    output_tokens: Math.max(0, Math.floor(Number(u.output_tokens) || 0)),
    cached_tokens: Math.max(0, Math.floor(Number(u.input_tokens_details?.cached_tokens) || 0))
  };
  await fs.ensureDir(costDirectory(userData));
  await fs.appendFile(path.join(costDirectory(userData), 'usage.jsonl'), JSON.stringify(safe) + '\n');
}
async function recordRun(userData, run) {
  const safe = {
    runId: String(run.runId || '').slice(0, 100),
    timestamp: new Date().toISOString(),
    mode: ['local', 'tiered', 'astra'].includes(run.mode) ? run.mode : 'local',
    fileCount: Math.max(0, Math.floor(Number(run.fileCount) || 0)),
    totalPages: Math.max(0, Math.floor(Number(run.totalPages) || 0)),
    pagesUnknown: Math.max(0, Math.floor(Number(run.pagesUnknown) || 0))
  };
  if (!safe.runId) throw new Error('Missing cost tracker run ID.');
  await fs.ensureDir(costDirectory(userData));
  await fs.appendFile(path.join(costDirectory(userData), 'runs.jsonl'), JSON.stringify(safe) + '\n');
}
async function listRuns(userData) {
  const file = path.join(costDirectory(userData), 'runs.jsonl');
  if (!(await fs.pathExists(file))) return [];
  const result = [];
  const reader = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of reader) {
    try {
      const record = JSON.parse(line);
      if (record && typeof record.runId === 'string' &&
          /^[a-zA-Z0-9:_-]{1,100}$/.test(record.runId) &&
          ['local', 'tiered', 'astra'].includes(record.mode)) result.push(record);
    } catch (_) { /* Ignore interrupted trailing append. */ }
  }
  return result;
}
async function latestRun(userData) {
  const runs = await listRuns(userData);
  return runs.length ? runs[runs.length - 1] : null;
}
async function resetCostHistory(userData) {
  // Only removes this app's local cost ledger and assumptions; no API billing
  // records, audit evidence, PDFs, or bulk processing checkpoints are touched.
  await fs.remove(costDirectory(userData));
  return { cleared: true };
}
async function getDashboard(userData, mode = 'tiered') {
  const entries = [];
  const file = path.join(costDirectory(userData), 'usage.jsonl');
  if (await fs.pathExists(file)) {
    const stream = fs.createReadStream(file, { encoding: 'utf8' });
    const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of reader) {
      try {
        const x = JSON.parse(line);
        entries.push({ model: x.model, pageKey: x.pageKey, runId: x.runId, usage: {
          input_tokens: x.input_tokens, output_tokens: x.output_tokens,
          input_tokens_details: { cached_tokens: x.cached_tokens }
        } });
      } catch (_) { /* Ignore truncated line if a process was interrupted. */ }
    }
  }
  const runs = await listRuns(userData);
  return summarizeCost(entries, await loadPlan(userData), mode,
    runs.length ? runs[runs.length - 1] : null, runs);
}
module.exports = { MODEL_PRICING, DEFAULT_PLAN, validatePlan, usageCost, planningPerPage, summarizeCost, loadPlan, savePlan, recordUsage, recordRun, getDashboard, listRuns, resetCostHistory };
