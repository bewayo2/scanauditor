'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  usageCost, planningPerPage, summarizeCost, validatePlan, MODEL_PRICING
} = require('../cost_tracker');

test('standard Luna Sol Astra pricing is explicit in USD per million tokens', () => {
  assert.equal(MODEL_PRICING['gpt-6-luna'].input, 0.10);
  assert.equal(MODEL_PRICING['gpt-6.1-sol'].output, 10);
  assert.equal(MODEL_PRICING['gpt-6-astra'].input, 10);
});

test('usage charges separate cached from uncached input tokens', () => {
  const actual = usageCost('gpt-6-luna', {
    input_tokens: 1000000, output_tokens: 100000,
    input_tokens_details: { cached_tokens: 200000 }
  });
  assert.ok(Math.abs(actual - (0.8 * 0.10 + 0.2 * 0.01 + 0.1 * 0.50)) < 1e-10);
});

test('cost projection blends Luna and expected Sol fallbacks', () => {
  const plan = validatePlan({ totalRecords: 100000, averagePagesPerRecord: 4,
    estimatedInputTokensPerPage: 5000, estimatedOutputTokensPerPage: 500, fallbackPercent: 10 });
  const pageCost = planningPerPage(plan, 'tiered');
  assert.ok(Math.abs(pageCost - 0.00225) < 1e-9);
  const dash = summarizeCost([], plan, 'tiered');
  assert.equal(dash.plannedPages, 400000);
  assert.ok(Math.abs(dash.projectedTotalUSD - 900) < 1e-6);
  assert.equal(dash.costBasis, 'planning-assumption');
});

test('repeated metering of same scanned page increases spend but not completed page count', () => {
  const entries = [
    { model: 'gpt-6-luna', pageKey: 'hash:1', usage: { input_tokens: 5000, output_tokens: 500 } },
    { model: 'gpt-6.1-sol', pageKey: 'hash:1', usage: { input_tokens: 5000, output_tokens: 500 } },
    { model: 'gpt-6-luna', pageKey: 'hash:1', usage: { input_tokens: 5000, output_tokens: 500 } }
  ];
  const dash = summarizeCost(entries, { totalRecords: 10, averagePagesPerRecord: 1 }, 'tiered');
  assert.equal(dash.processedPages, 1);
  assert.equal(dash.chargedCalls, 3);
  assert.ok(Math.abs(dash.recordedSpendUSD - 0.0165) < 1e-10);
  assert.equal(dash.costBasis, 'observed-api-usage');
});

test('Astra benchmark forecasts use Astra observations, not cheap Luna observations', () => {
  const entries = [
    { model: 'gpt-6-luna', pageKey: 'hash:1', usage: { input_tokens: 1000, output_tokens: 100 } },
    { model: 'gpt-6-astra', pageKey: 'hash:2', usage: { input_tokens: 1000, output_tokens: 100 } }
  ];
  const dash = summarizeCost(entries, { totalRecords: 10, averagePagesPerRecord: 1 }, 'astra');
  assert.equal(dash.processedPages, 2);
  assert.ok(Math.abs(dash.forecastPerPageUSD - 0.015) < 1e-10);
});

test('planning parameter validation prevents negative or implausible forecasts', () => {
  const plan = validatePlan({ totalRecords: -1, averagePagesPerRecord: -2, fallbackPercent: 300 });
  assert.equal(plan.totalRecords, 100000);
  assert.equal(plan.fallbackPercent, 10);
  assert.equal(plan.averagePagesPerRecord, 4);
});
