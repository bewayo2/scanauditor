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
function summarizeCost(entries, plan, mode = 'tiered', lastRun = null) {
  const p = validatePlan(plan);
  const allPages = new Set();
  const runPages = new Set();
  const selectedModePages = new Set();
  const selectedModeModels = mode === 'astra'
    ? new Set(['gpt-6-astra'])
    : mode === 'tiered' ? new Set(['gpt-6-luna', 'gpt-6.1-sol']) : new Set();
  const modelSpend = {};
  let recordedSpendUSD = 0;
  let runSpendUSD = 0;
  let selectedModeSpendUSD = 0;
  let chargedCalls = 0;
  for (const entry of entries) {
    if (!entry || !Object.hasOwn(MODEL_PRICING, entry.model)) continue;
    const cost = usageCost(entry.model, entry.usage);
    recordedSpendUSD += cost;
    chargedCalls += 1;
    modelSpend[entry.model] = (modelSpend[entry.model] || 0) + cost;
    if (entry.pageKey) allPages.add(entry.pageKey);
    if (selectedModeModels.has(entry.model)) {
      selectedModeSpendUSD += cost;
      if (entry.pageKey) selectedModePages.add(entry.pageKey);
    }
    if (lastRun && entry.runId && entry.runId === lastRun.runId) {
      runSpendUSD += cost;
      if (entry.pageKey) runPages.add(entry.pageKey);
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

  // An OPTIONAL future-page extrapolation is separate from the real scanned run.
  // Prefer the selected mode's actual observed price rather than unrelated model usage.
  const selectedObserved = selectedModePages.size
    ? selectedModeSpendUSD / selectedModePages.size : null;
  const targetPerPage = mode === 'local' ? 0
    : selectedObserved === null ? planningPerPage(p, mode) : selectedObserved;

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
    targetPages: p.targetPages,
    targetForecastPerPageUSD: targetPerPage,
    targetProjectionUSD: p.targetPages === null ? null : targetPerPage * p.targetPages,
    targetCostBasis: selectedObserved === null ? 'planning-assumption' : 'observed-api-usage',
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
async function latestRun(userData) {
  const file = path.join(costDirectory(userData), 'runs.jsonl');
  if (!(await fs.pathExists(file))) return null;
  let last = null;
  const reader = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of reader) {
    try {
      const candidate = JSON.parse(line);
      if (candidate?.runId && ['local', 'tiered', 'astra'].includes(candidate.mode)) last = candidate;
    } catch (_) { /* Ignore interrupted trailing write. */ }
  }
  return last;
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
  return summarizeCost(entries, await loadPlan(userData), mode, await latestRun(userData));
}
module.exports = { MODEL_PRICING, DEFAULT_PLAN, validatePlan, usageCost, planningPerPage, summarizeCost, loadPlan, savePlan, recordUsage, recordRun, getDashboard };
