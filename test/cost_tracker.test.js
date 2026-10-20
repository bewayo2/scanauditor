'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs-extra');
const path = require('node:path');
const os = require('node:os');
const {
  usageCost, planningPerPage, summarizeCost, validatePlan, MODEL_PRICING,
  getDashboard, recordRun, recordUsage, savePlan
} = require('../cost_tracker');

const plan = { estimatedInputTokensPerPage: 5000, estimatedOutputTokensPerPage: 500, fallbackPercent: 10 };

test('Luna Sol Astra standard token pricing remains explicit', () => {
  assert.equal(MODEL_PRICING['gpt-6-luna'].input, 0.10);
  assert.equal(MODEL_PRICING['gpt-6.1-sol'].output, 10);
  assert.equal(MODEL_PRICING['gpt-6-astra'].input, 10);
});

test('usage cost separates cached and uncached input tokens', () => {
  const result = usageCost('gpt-6-luna', {
    input_tokens: 1000000, output_tokens: 100000,
    input_tokens_details: { cached_tokens: 200000 }
  });
  assert.ok(Math.abs(result - (0.8 * 0.10 + 0.2 * 0.01 + 0.1 * 0.50)) < 1e-10);
});

test('no fixed record count or project page count is assumed', () => {
  const settings = validatePlan(plan);
  assert.equal(settings.targetPages, null);
  const dashboard = summarizeCost([], settings, 'tiered');
  assert.equal(dashboard.run, null);
  assert.equal(dashboard.targetProjectionUSD, null);
});

test('a single 4-page run estimates only 4 pages, not 100,000 records', () => {
  const run = { runId: 'run-one', mode: 'tiered', fileCount: 1, totalPages: 4 };
  const dashboard = summarizeCost([], plan, 'tiered', run);
  assert.equal(dashboard.run.totalPages, 4);
  assert.equal(dashboard.run.meteredPages, 0);
  assert.ok(Math.abs(dashboard.run.forecastPerPageUSD - 0.00225) < 1e-9);
  assert.ok(Math.abs(dashboard.run.projectedTotalUSD - 0.009) < 1e-9);
  assert.equal(dashboard.targetProjectionUSD, null);
});

test('all 4 pages metered gives total run spend, not an extrapolated project', () => {
  const entries = Array.from({ length: 4 }, (_, index) => ({
    runId: 'one', model: 'gpt-6-luna', pageKey: 'file-hash:' + (index + 1),
    usage: { input_tokens: 5000, output_tokens: 500 }
  }));
  const result = summarizeCost(entries, plan, 'tiered',
    { runId: 'one', mode: 'tiered', fileCount: 1, totalPages: 4 });
  assert.equal(result.run.meteredPages, 4);
  assert.equal(result.run.unmeteredPages, 0);
  assert.ok(Math.abs(result.run.recordedSpendUSD - 0.003) < 1e-9);
  assert.ok(Math.abs(result.run.forecastPerPageUSD - 0.00075) < 1e-9);
  assert.ok(Math.abs(result.run.projectedTotalUSD - 0.003) < 1e-9);
});

test('a failed or unmetered page is forecast but clearly counted as unmetered', () => {
  const entries = [{ runId: 'sample', model: 'gpt-6-luna', pageKey: 'hash:1',
    usage: { input_tokens: 5000, output_tokens: 500 } }];
  const result = summarizeCost(entries, plan, 'tiered',
    { runId: 'sample', mode: 'tiered', fileCount: 1, totalPages: 4 });
  assert.equal(result.run.meteredPages, 1);
  assert.equal(result.run.unmeteredPages, 3);
  assert.ok(Math.abs(result.run.projectedTotalUSD - 0.003) < 1e-9);
});

test('fallback and retries increase spend without inflating metered pages', () => {
  const entries = [
    { runId: 'a', model: 'gpt-6-luna', pageKey: 'same:1', usage: { input_tokens: 5000, output_tokens: 500 } },
    { runId: 'a', model: 'gpt-6.1-sol', pageKey: 'same:1', usage: { input_tokens: 5000, output_tokens: 500 } },
    { runId: 'a', model: 'gpt-6-luna', pageKey: 'same:1', usage: { input_tokens: 5000, output_tokens: 500 } }
  ];
  const d = summarizeCost(entries, plan, 'tiered',
    { runId: 'a', mode: 'tiered', fileCount: 1, totalPages: 1 });
  assert.equal(d.run.meteredPages, 1);
  assert.equal(d.chargedCalls, 3);
  assert.ok(Math.abs(d.run.recordedSpendUSD - 0.0165) < 1e-10);
});

test('last-run spending is separated from cumulative spending across runs', () => {
  const entries = [
    { runId: 'previous', model: 'gpt-6-astra', pageKey: 'file1:1',
      usage: { input_tokens: 1000, output_tokens: 100 } },
    { runId: 'current', model: 'gpt-6-luna', pageKey: 'file2:1',
      usage: { input_tokens: 1000, output_tokens: 100 } }
  ];
  const d = summarizeCost(entries, plan, 'tiered',
    { runId: 'current', mode: 'tiered', fileCount: 1, totalPages: 1 });
  assert.ok(d.recordedSpendUSD > d.run.recordedSpendUSD);
  assert.ok(Math.abs(d.run.recordedSpendUSD - 0.00015) < 1e-10);
});

test('local-only run reports its actual page count but zero API cost', () => {
  const d = summarizeCost([], plan, 'tiered',
    { runId: 'local-run', mode: 'local', fileCount: 2, totalPages: 37 });
  assert.equal(d.run.totalPages, 37);
  assert.equal(d.run.recordedSpendUSD, 0);
  assert.equal(d.run.forecastPerPageUSD, 0);
  assert.equal(d.run.projectedTotalUSD, 0);
});

test('optional target is a page count; it does not replace the scanned run count', () => {
  const settings = { ...plan, targetPages: 400000 };
  const d = summarizeCost([], settings, 'tiered',
    { runId: 'only-four', mode: 'tiered', fileCount: 1, totalPages: 4 });
  assert.equal(d.run.totalPages, 4);
  assert.ok(Math.abs(d.run.projectedTotalUSD - 0.009) < 1e-9);
  assert.ok(Math.abs(d.targetProjectionUSD - 900) < 1e-6);
});

test('Astra target projection uses Astra usage, not Luna prices', () => {
  const entries = [
    { runId: 'a', model: 'gpt-6-luna', pageKey: 'h:1', usage: { input_tokens: 1000, output_tokens: 100 } },
    { runId: 'b', model: 'gpt-6-astra', pageKey: 'h:2', usage: { input_tokens: 1000, output_tokens: 100 } }
  ];
  const d = summarizeCost(entries, { ...plan, targetPages: 1000 }, 'astra',
    { runId: 'b', mode: 'astra', fileCount: 1, totalPages: 1 });
  assert.ok(Math.abs(d.targetForecastPerPageUSD - 0.015) < 1e-10);
  assert.ok(Math.abs(d.targetProjectionUSD - 15) < 1e-9);
});

test('invalid and legacy fixed-record settings never recreate a forced 100k forecast', () => {
  const p = validatePlan({ totalRecords: 100000, averagePagesPerRecord: 4,
    fallbackPercent: 300, targetPages: -1 });
  assert.equal(p.targetPages, null);
  assert.equal(p.fallbackPercent, 10);
});

test('disk ledger separates a run from all-time spend without retaining filenames', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scanauditor-cost-test-'));
  t.after(async () => fs.remove(dir));
  await savePlan(dir, plan);
  await recordUsage(dir, { runId: 'a', model: 'gpt-6-luna', pageKey: 'sha:1',
    usage: { input_tokens: 5000, output_tokens: 500 } });
  await recordRun(dir, { runId: 'a', mode: 'tiered', fileCount: 1, totalPages: 1 });
  await recordUsage(dir, { runId: 'b', model: 'gpt-6-luna', pageKey: 'sha:1',
    usage: { input_tokens: 5000, output_tokens: 500 } });
  await recordRun(dir, { runId: 'b', mode: 'tiered', fileCount: 1, totalPages: 7 });
  const d = await getDashboard(dir, 'tiered');
  assert.equal(d.run.totalPages, 7);
  assert.equal(d.run.meteredPages, 1);
  assert.ok(Math.abs(d.run.recordedSpendUSD - 0.00075) < 1e-9);
  assert.ok(Math.abs(d.recordedSpendUSD - 0.0015) < 1e-9);
  assert.equal(d.targetPages, null);
  const written = await fs.readFile(path.join(dir, 'cost-tracker', 'runs.jsonl'), 'utf8');
  assert.equal(written.trim().split('\n').length, 2);
  assert.equal(written.includes('filename'), false);
});


function fourPageCostRun(runId, fileHash = 'same-pdf') {
  const pageEntries = Array.from({ length: 4 }, (_, index) => ({
    runId, model: 'gpt-6-luna', pageKey: fileHash + ':' + (index + 1),
    usage: { input_tokens: 5000, output_tokens: 500 }
  }));
  // One page needed a more expensive fallback: 0.035814 extra.
  pageEntries.push({
    runId, model: 'gpt-6.1-sol', pageKey: fileHash + ':1',
    usage: { input_tokens: 5002, output_tokens: 2581 }
  });
  return pageEntries;
}

test('regression: repeat 4-page PDF twice does not double the 1-million-page forecast', () => {
  const entries = [...fourPageCostRun('first'), ...fourPageCostRun('second')];
  const p = { ...plan, targetPages: 1000000 };
  const result = summarizeCost(entries, p, 'tiered', {
    runId: 'second', mode: 'tiered', fileCount: 1, totalPages: 4
  });
  assert.ok(Math.abs(result.run.recordedSpendUSD - 0.038814) < 1e-10);
  assert.ok(Math.abs(result.recordedSpendUSD - 0.077628) < 1e-10);
  assert.equal(result.run.meteredPages, 4);
  assert.equal(result.historicalMeteredPages, 8);
  assert.equal(result.historicalMeteredRuns, 2);
  assert.equal(result.allTimeMeteredPages, 8);
  assert.equal(result.plan.forecastBasis, 'latest-run');
  assert.equal(result.targetForecastSource, 'latest-run');
  assert.ok(Math.abs(result.targetForecastPerPageUSD - 0.0097035) < 1e-10);
  assert.ok(Math.abs(result.targetProjectionUSD - 9703.50) < 1e-6);
});

test('historical average includes repeat scans in both numerator and denominator', () => {
  const entries = [...fourPageCostRun('first'), ...fourPageCostRun('second')];
  const result = summarizeCost(entries,
    { ...plan, targetPages: 1000000, forecastBasis: 'historical' }, 'tiered', {
      runId: 'second', mode: 'tiered', fileCount: 1, totalPages: 4
    });
  assert.equal(result.targetForecastSource, 'historical');
  assert.equal(result.historicalMeteredPages, 8);
  assert.ok(Math.abs(result.historicalSpendUSD - 0.077628) < 1e-10);
  assert.ok(Math.abs(result.targetProjectionUSD - 9703.50) < 1e-6);
});

test('latest-run and historical forecasts are distinct when earlier processing cost more', () => {
  const entries = [
    ...fourPageCostRun('earlier'),
    ...fourPageCostRun('latest').filter(item => item.model === 'gpt-6-luna')
  ];
  const latestRun = { runId: 'latest', mode: 'tiered', totalPages: 4, fileCount: 1 };
  const latest = summarizeCost(entries, { ...plan, targetPages: 1000000 }, 'tiered', latestRun);
  const historical = summarizeCost(entries, { ...plan, targetPages: 1000000, forecastBasis: 'historical' }, 'tiered', latestRun);
  assert.equal(latest.targetForecastSource, 'latest-run');
  assert.ok(Math.abs(latest.targetProjectionUSD - 750) < 1e-6);
  assert.equal(historical.targetForecastSource, 'historical');
  assert.ok(Math.abs(historical.targetProjectionUSD - 5226.75) < 1e-6);
  assert.equal(historical.historicalMeteredPages, 8);
  assert.ok(historical.recordedSpendUSD > latest.run.recordedSpendUSD);
});

test('most recent local run cannot become the selected paid mode unit cost', () => {
  const entries = fourPageCostRun('old-tiered');
  const localRun = { runId: 'local', mode: 'local', fileCount: 1, totalPages: 4 };
  const paid = summarizeCost(entries, { ...plan, targetPages: 1000000 }, 'tiered', localRun);
  assert.equal(paid.targetForecastSource, 'historical-fallback');
  assert.ok(Math.abs(paid.targetProjectionUSD - 9703.50) < 1e-6);
  const local = summarizeCost(entries, { ...plan, targetPages: 1000000 }, 'local', localRun);
  assert.equal(local.targetForecastSource, 'local');
  assert.equal(local.targetProjectionUSD, 0);
});

test('older ledger entries without run IDs remain in spend but not inflated historical rate', () => {
  const tagged = fourPageCostRun('with-run-id');
  const older = fourPageCostRun(null);
  const result = summarizeCost([...tagged, ...older],
    { ...plan, targetPages: 1000000, forecastBasis: 'historical' }, 'tiered', {
      runId: 'with-run-id', mode: 'tiered', totalPages: 4, fileCount: 1
    });
  assert.ok(Math.abs(result.recordedSpendUSD - 0.077628) < 1e-10);
  assert.equal(result.historicalMeteredPages, 4);
  assert.ok(Math.abs(result.legacySpendExcludedUSD - 0.038814) < 1e-10);
  assert.ok(Math.abs(result.targetProjectionUSD - 9703.50) < 1e-6);
});

test('historical method falls back to planning when paid page-run sample is absent', () => {
  const result = summarizeCost([], { ...plan, targetPages: 1000000, forecastBasis: 'historical' }, 'tiered');
  assert.equal(result.targetForecastSource, 'planning-assumption');
  assert.equal(result.targetProjectionUSD, 2250);
});

test('forecast basis saves locally and invalid values return to latest-run default', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scanauditor-forecast-test-'));
  t.after(async () => fs.remove(dir));
  await savePlan(dir, { ...plan, targetPages: 1000000, forecastBasis: 'historical' });
  const result = await getDashboard(dir, 'tiered');
  assert.equal(result.plan.forecastBasis, 'historical');
  assert.equal(result.plan.targetPages, 1000000);
  assert.equal(validatePlan({ forecastBasis: 'not-a-mode' }).forecastBasis, 'latest-run');
});
