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
  totalRecords: 100000,
  averagePagesPerRecord: 4,
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
    totalRecords: Math.floor(finiteRange(value.totalRecords, DEFAULT_PLAN.totalRecords, 1, 10000000)),
    averagePagesPerRecord: finiteRange(value.averagePagesPerRecord, DEFAULT_PLAN.averagePagesPerRecord, 0.1, 10000),
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
function summarizeCost(entries, plan, mode = 'tiered') {
  const p = validatePlan(plan);
  const pages = new Set();
  const byModel = {};
  let recordedSpendUSD = 0;
  let chargedCalls = 0;
  for (const entry of entries) {
    if (!entry || !Object.hasOwn(MODEL_PRICING, entry.model)) continue;
    const cost = usageCost(entry.model, entry.usage);
    recordedSpendUSD += cost;
    chargedCalls += 1;
    byModel[entry.model] = (byModel[entry.model] || 0) + cost;
    if (typeof entry.pageKey === 'string' && entry.pageKey) pages.add(entry.pageKey);
  }
  const processedPages = pages.size;
  const plannedPages = Math.ceil(p.totalRecords * p.averagePagesPerRecord);
  const observedPerPage = processedPages ? recordedSpendUSD / processedPages : null;
  const plannedPerPage = planningPerPage(p, mode);
  const perPage = observedPerPage === null ? plannedPerPage : observedPerPage;
  const remainingPages = Math.max(0, plannedPages - processedPages);
  return {
    plan: p, mode, pricing: MODEL_PRICING, currency: 'USD',
    recordedSpendUSD, chargedCalls, processedPages,
    observedPerPageUSD: observedPerPage,
    estimatedPerPageUSD: plannedPerPage,
    forecastPerPageUSD: perPage,
    plannedPages, remainingPages,
    projectedRemainingUSD: remainingPages * perPage,
    projectedTotalUSD: recordedSpendUSD + remainingPages * perPage,
    costBasis: observedPerPage === null ? 'planning-assumption' : 'observed-api-usage',
    disclaimer: 'Estimated API usage costs, not the provider invoice. Excludes failed requests without usage data, special tiers, taxes, and charges outside this app.'
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
    input_tokens: Math.max(0, Math.floor(Number(u.input_tokens) || 0)),
    output_tokens: Math.max(0, Math.floor(Number(u.output_tokens) || 0)),
    cached_tokens: Math.max(0, Math.floor(Number(u.input_tokens_details?.cached_tokens) || 0))
  };
  await fs.ensureDir(costDirectory(userData));
  await fs.appendFile(path.join(costDirectory(userData), 'usage.jsonl'), JSON.stringify(safe) + '\n');
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
        entries.push({ model: x.model, pageKey: x.pageKey, usage: {
          input_tokens: x.input_tokens, output_tokens: x.output_tokens,
          input_tokens_details: { cached_tokens: x.cached_tokens }
        } });
      } catch (_) { /* Ignore truncated line if a process was interrupted. */ }
    }
  }
  return summarizeCost(entries, await loadPlan(userData), mode);
}
module.exports = { MODEL_PRICING, DEFAULT_PLAN, validatePlan, usageCost, planningPerPage, summarizeCost, loadPlan, savePlan, recordUsage, getDashboard };
