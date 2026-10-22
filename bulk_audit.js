'use strict';

const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const ConfiguredAnalyzer = require('./configured_analyzer');
const CloudScanAnalyzer = require('./cloud_analyzer');
const { recordUsage, recordRun } = require('./cost_tracker');
const { evidenceReport } = require('./evidence_report');

const MODES = new Set(['local', 'tiered', 'astra']);
const MODIFIERS = Object.freeze({ maxDepth: 40 });

function jobDirectory(userData, root, mode) {
  // No directory names, patient names or source file paths in journal.
  const key = crypto.createHash('sha256').update(path.resolve(root) + '\0' + mode).digest('hex');
  return path.join(userData, 'bulk-audit', key);
}
function makeFileKey(secret, rel, stat) {
  return crypto.createHmac('sha256', secret)
    .update(rel + '\0' + stat.size + '\0' + stat.mtimeMs + '\0' + stat.ctimeMs)
    .digest('hex');
}
async function* walkPdfs(folder, depth = 0) {
  if (depth > MODIFIERS.maxDepth) return;
  const items = await fs.readdir(folder, { withFileTypes: true });
  items.sort((a, b) => a.name.localeCompare(b.name));
  for (const item of items) {
    if (item.isSymbolicLink()) continue;
    const candidate = path.join(folder, item.name);
    if (item.isDirectory()) yield* walkPdfs(candidate, depth + 1);
    else if (item.isFile() && path.extname(item.name).toLowerCase() === '.pdf') yield candidate;
  }
}
async function readJournal(file) {
  const states = new Map();
  if (!(await fs.pathExists(file))) return states;
  const reader = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of reader) {
    try {
      const row = JSON.parse(line);
      if (typeof row.key === 'string' && /^[0-9a-f]{64}$/.test(row.key) &&
          ['passed', 'review-required', 'analysis-failed'].includes(row.status)) {
        states.set(row.key, row.status);
      }
    } catch (_) { /* Ignore partial final append. */ }
  }
  return states;
}

async function runBulkAudit({
  root, userData, mode = 'local', apiKey = null, hospitalApproved = false,
  onProgress = () => {}, cancellation = { requested: false }, maxFiles = Infinity,
  retryFailed = false, analyzerFactory = null
} = {}) {
  if (!MODES.has(mode)) throw new Error('Unsupported bulk analysis mode.');
  if (!root || !userData) throw new Error('Choose a PDF folder.');
  if (mode !== 'local' && (!hospitalApproved || !apiKey)) {
    throw new Error('Hospital authorization and project API key are required for cloud batch analysis.');
  }
  const normalizedRoot = await fs.realpath(root);
  const stat = await fs.stat(normalizedRoot);
  if (!stat.isDirectory()) throw new Error('The selected path is not a directory.');
  const output = jobDirectory(userData, normalizedRoot, mode);
  await fs.ensureDir(output);
  const stateFile = path.join(output, 'state.json');
  let state;
  if (await fs.pathExists(stateFile)) {
    state = await fs.readJson(stateFile);
    if (!/^[0-9a-f]{64}$/.test(state.secret || '')) throw new Error('Invalid bulk job state.');
  } else {
    state = { schemaVersion: 1, secret: crypto.randomBytes(32).toString('hex'), mode };
    await fs.writeJson(stateFile, state, { spaces: 2 });
  }
  const journal = path.join(output, 'checkpoint.jsonl');
  const evidence = path.join(output, 'evidence.jsonl');
  const completed = await readJournal(journal);
  const runId = crypto.randomUUID();
  const analyzer = analyzerFactory ? analyzerFactory({
    mode, onUsage: x => recordUsage(userData, { ...x, runId })
  }) : mode === 'local' ? new ConfiguredAnalyzer() :
    new CloudScanAnalyzer({
      mode, apiKey, onUsage: x => recordUsage(userData, { ...x, runId })
    });
  const counters = {
    filesSeen: 0, processed: 0, skippedFromCheckpoint: 0, passed: 0,
    reviewRequired: 0, analysisFailed: 0, pagesProcessed: 0,
    stopped: false, runId, mode
  };
  try {
    for await (const pdfPath of walkPdfs(normalizedRoot)) {
      if (cancellation.requested || counters.processed >= maxFiles) {
        counters.stopped = true;
        break;
      }
      counters.filesSeen += 1;
      const fileStat = await fs.stat(pdfPath);
      const key = makeFileKey(state.secret, path.relative(normalizedRoot, pdfPath), fileStat);
      const prior = completed.get(key);
      if (prior && (prior !== 'analysis-failed' || !retryFailed)) {
        counters.skippedFromCheckpoint += 1;
        if (counters.filesSeen % 25 === 0) onProgress({ ...counters });
        continue;
      }
      let result;
      try {
        result = await analyzer.analyzeFile({ path: pdfPath, originalname: path.basename(pdfPath) });
      } catch (_) {
        // Never emit file path or provider error messages: may contain PHI.
        result = { analysis: { qaAssessment: { status: 'analysis-failed', findings: [] } } };
      }
      const status = result?.analysis?.qaAssessment?.status;
      const safeStatus = ['passed', 'review-required', 'analysis-failed'].includes(status) ? status : 'analysis-failed';
      counters.processed += 1;
      if (safeStatus === 'passed') counters.passed += 1;
      else if (safeStatus === 'review-required') counters.reviewRequired += 1;
      else counters.analysisFailed += 1;
      counters.pagesProcessed += Number(result?.analysis?.fileInformation?.totalPages) || 0;

      // Evidence is deliberately limited to version/config/hash/status; no OCR,
      // filename, original directory, patient identifier, or free-text excerpts.
      if (result?.analysis) {
        await fs.appendFile(evidence, JSON.stringify({
          jobFileKey: key, runId, ...evidenceReport(result)
        }) + '\n');
      }
      await fs.appendFile(journal, JSON.stringify({
        key, status: safeStatus, timestamp: new Date().toISOString()
      }) + '\n');
      completed.set(key, safeStatus);
      if (counters.processed % 10 === 0) onProgress({ ...counters });
    }
  } finally {
    await recordRun(userData, {
      runId, mode, fileCount: counters.processed, totalPages: counters.pagesProcessed,
      pagesUnknown: counters.analysisFailed
    });
    onProgress({ ...counters });
  }
  return { ...counters, jobId: path.basename(output),
    disclaimer: 'Batch checkpoint and evidence contain no patient text. Paper completeness still requires independent source comparison.' };
}
module.exports = { runBulkAudit, walkPdfs, readJournal, makeFileKey, jobDirectory };
