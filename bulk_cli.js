#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs-extra');
const { runBulkAudit } = require('./bulk_audit');

function argument(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
}
async function main() {
  const root = argument('--root');
  const mode = argument('--mode', 'local');
  if (!root) {
    process.stderr.write('Usage: node bulk_cli.js --root <PDF folder> [--mode local|tiered|astra] [--max-files N] [--retry-failed]\n');
    process.exitCode = 2;
    return;
  }
  const consent = process.argv.includes('--hospital-approved');
  const apiKey = process.env.OPENAI_API_KEY;
  if (mode !== 'local' && (!consent || !apiKey)) {
    process.stderr.write('Cloud batch use requires --hospital-approved and a hospital-owned OPENAI_API_KEY environment variable.\n');
    process.exitCode = 2;
    return;
  }
  const userData = path.join(process.env.SCANAUDITOR_DATA_DIR || path.join(require('os').homedir(), '.scanauditor'));
  await fs.ensureDir(userData);
  const stop = { requested: false };
  process.on('SIGINT', () => { stop.requested = true; process.stderr.write('Stopping after current PDF; resume with the same command.\n'); });
  const maxRaw = argument('--max-files');
  const max = maxRaw === undefined ? (mode === 'local' ? Infinity : 100) : Number(maxRaw);
  const maxUsdRaw = argument('--max-usd');
  const maxUsd = maxUsdRaw === undefined ? 5 : Number(maxUsdRaw);
  if (mode !== 'local' && (!Number.isFinite(maxUsd) || maxUsd < 0.01 || maxUsd > 100000)) {
    throw new Error('Cloud batch requires a valid API spend limit.');
  }
  if (maxRaw !== undefined && (!Number.isSafeInteger(max) || max < 1)) throw new Error('Invalid --max-files value.');
  const stats = await runBulkAudit({
    root, userData, mode, apiKey, hospitalApproved: consent,
    retryFailed: process.argv.includes('--retry-failed'), maxFiles: max, maxUsd,
    cancellation: stop,
    onProgress: s => process.stdout.write(JSON.stringify({
      scanned: s.processed, skipped: s.skippedFromCheckpoint,
      passed: s.passed, reviewRequired: s.reviewRequired,
      failed: s.analysisFailed, pages: s.pagesProcessed, stopped: s.stopped
    }) + '\n')
  });
  process.stdout.write(JSON.stringify({
    complete: !stats.stopped, processed: stats.processed, skipped: stats.skippedFromCheckpoint,
    failed: stats.analysisFailed, pages: stats.pagesProcessed, jobId: stats.jobId
  }) + '\n');
}
main().catch(() => {
  // Avoid exposing paths, document contents, or provider error text.
  process.stderr.write('Bulk audit could not start or complete. Review your local configuration.\n');
  process.exitCode = 1;
});
