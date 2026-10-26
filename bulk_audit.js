'use strict';

const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const ConfiguredAnalyzer = require('./configured_analyzer');
const CloudScanAnalyzer = require('./cloud_analyzer');
const { recordUsage, recordRun, usageCost } = require('./cost_tracker');
const { evidenceReport } = require('./evidence_report');
const { AuditStore } = require('./audit_store');
const pdfParse = require('pdf-parse');

const MODES = new Set(['local', 'tiered', 'astra']);
const MODIFIERS = Object.freeze({ maxDepth: 40 });

function jobDirectory(userData, root, mode) {
  // No directory names, patient names or source file paths in journal.
  // New SQLite-backed workspace starts fresh; legacy test checkpoints are not imported.
  const key = crypto.createHash('sha256').update(path.resolve(root) + '\0' + mode + '\0sqlite-v1').digest('hex');
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

// A metadata-only sample: never extract or store OCR, patient text, filenames or
// source paths as part of progress reporting. PDF-parse is already required by
// the normal analyzer. Restrict it to one rendered page for the page-count probe.
async function readPdfPageCount(pdfPath) {
  const document = await pdfParse(await fs.readFile(pdfPath), { max: 1 });
  const count = Number(document.numpages);
  if (!Number.isSafeInteger(count) || count < 1) throw new Error('Cannot count PDF pages');
  return count;
}

// One streaming walk counts PDF files. A bounded reservoir gives a more
// representative page-size sample than simply taking the first files, which
// may all belong to one date/patient/visit. Nothing is written to disk.
async function inspectBulkFolder({
  root, onProgress = () => {}, cancellation = { requested: false },
  sampleLimit = 60, readPageCount = readPdfPageCount
} = {}) {
  if (!root) throw new Error('Choose a folder of PDFs first.');
  if (!Number.isInteger(sampleLimit) || sampleLimit < 1 || sampleLimit > 500) {
    throw new Error('Invalid page sampling limit.');
  }
  const folder = await fs.realpath(root);
  if (!(await fs.stat(folder)).isDirectory()) throw new Error('Choose a directory.');
  let filesTotal = 0;
  const reservoir = [];
  let tick = Date.now();
  const emit = progress => onProgress(progress);
  emit({ phase: 'inventory', filesTotal: 0, sampledFiles: 0, estimatedPages: null });
  for await (const filePath of walkPdfs(folder)) {
    if (cancellation.requested) {
      emit({ phase: 'canceled', filesTotal, estimatedPages: null });
      return { canceled: true, filesTotal, estimatedPages: null };
    }
    filesTotal += 1;
    if (reservoir.length < sampleLimit) {
      reservoir.push(filePath);
    } else {
      const index = crypto.randomInt(filesTotal);
      if (index < sampleLimit) reservoir[index] = filePath;
    }
    // Real time-based throttling avoids a million interprocess UI events.
    if (Date.now() - tick >= 160 || filesTotal === 1) {
      emit({ phase: 'inventory', filesTotal, sampledFiles: 0, estimatedPages: null });
      tick = Date.now();
    }
  }
  let sampledFiles = 0;
  let sampledPages = 0;
  let sampleFailed = 0;
  tick = 0;
  for (const filePath of reservoir) {
    if (cancellation.requested) {
      emit({ phase: 'canceled', filesTotal, sampledFiles, estimatedPages: null });
      return { canceled: true, filesTotal, estimatedPages: null };
    }
    try {
      const count = await readPageCount(filePath);
      if (!Number.isSafeInteger(count) || count < 1) throw new Error('Bad PDF count');
      sampledFiles += 1;
      sampledPages += count;
    } catch (_) {
      // An unreadable or encrypted PDF reduces the quality of the estimate,
      // but does not prevent the actual audit from continuing.
      sampleFailed += 1;
    }
    if (Date.now() - tick >= 160 || sampledFiles + sampleFailed === reservoir.length) {
      emit({ phase: 'sampling', filesTotal, sampledFiles, sampleFailed,
        sampleTarget: reservoir.length, estimatedPages: null });
      tick = Date.now();
    }
  }
  const estimatedPages = filesTotal === 0 ? 0 :
    sampledFiles ? Math.round(filesTotal * sampledPages / sampledFiles) : null;
  const exact = filesTotal === 0 || sampledFiles === filesTotal && sampleFailed === 0;
  const result = {
    phase: 'ready', filesTotal, estimatedPages,
    estimateKind: exact ? 'exact-metadata' : !sampledFiles ? 'unavailable' : 'sampled',
    sampledFiles, sampleFailed, sampleTarget: reservoir.length,
    averagePagesPerFile: sampledFiles ? sampledPages / sampledFiles : null,
    // Inventory counts files, not actual analysis successes.
    completedFiles: null
  };
  emit(result);
  return result;
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
  retryFailed = false, maxUsd = 5, analyzerFactory = null,
  inventory = null, readPageCount = readPdfPageCount, store = null
} = {}) {
  if (!MODES.has(mode)) throw new Error('Unsupported bulk analysis mode.');
  if (!root || !userData) throw new Error('Choose a PDF folder.');
  if (mode !== 'local' && (!hospitalApproved || !apiKey)) {
    throw new Error('Hospital authorization and project API key are required for cloud batch analysis.');
  }
  if (mode !== 'local' && (!Number.isFinite(maxUsd) || maxUsd <= 0 || maxUsd > 100000)) {
    throw new Error('Set a positive cloud-batch API spending limit.');
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
  // CLI can inventory on demand. Desktop may supply the in-memory preview for
  // the currently selected folder; no patient paths are persisted or emitted.
  if (!inventory || inventory.canceled || !Number.isSafeInteger(inventory.filesTotal) ||
      inventory.filesTotal < 0) {
    inventory = await inspectBulkFolder({ root: normalizedRoot, cancellation, onProgress, readPageCount });
  }
  if (inventory.canceled) return { ...inventory, stopped: true, processed: 0, skippedFromCheckpoint: 0,
    reviewRequired: 0, analysisFailed: 0, pagesProcessed: 0, meteredSpendUSD: 0 };
  const auditStore = store || new AuditStore(userData);
  const auditProject = await auditStore.upsertProject(normalizedRoot, mode, 'folder');
  const runId = crypto.randomUUID();
  let meteredSpendUSD = 0;
  const onUsage = async entry => {
    meteredSpendUSD += usageCost(entry.model, entry.usage);
    await recordUsage(userData, { ...entry, runId });
  };
  const analyzer = analyzerFactory ? analyzerFactory({ mode, onUsage }) :
    mode === 'local' ? new ConfiguredAnalyzer() :
      new CloudScanAnalyzer({ mode, apiKey, onUsage });
  const counters = {
    filesSeen: 0, processed: 0, skippedFromCheckpoint: 0, passed: 0,
    reviewRequired: 0, analysisFailed: 0, pagesProcessed: 0,
    stopped: false, runId, mode, meteredSpendUSD: 0, spendingLimitUSD: mode === 'local' ? null : maxUsd,
    phase: 'running', filesTotal: inventory.filesTotal, estimatedPages: inventory.estimatedPages,
    estimateKind: inventory.estimateKind, sampledFiles: inventory.sampledFiles,
    sampleFailed: inventory.sampleFailed, currentFileNumber: null,
    sessionTarget: Math.min(maxFiles, inventory.filesTotal), finished: false
  };
  onProgress({ ...counters });
  try {
    for await (const pdfPath of walkPdfs(normalizedRoot)) {
      if (cancellation.requested || counters.processed >= maxFiles ||
          (mode !== 'local' && meteredSpendUSD >= maxUsd)) {
        counters.stopped = true;
        break;
      }
      counters.filesSeen += 1;
      counters.currentFileNumber = counters.filesSeen;
      const fileStat = await fs.stat(pdfPath);
      const key = makeFileKey(state.secret, path.relative(normalizedRoot, pdfPath), fileStat);
      const prior = completed.get(key);
      if (prior && (prior !== 'analysis-failed' || !retryFailed)) {
        counters.skippedFromCheckpoint += 1;
        // Progress reporting is PHI-free: only counters, never file names.
        if (counters.filesSeen === 1 || counters.filesSeen % 25 === 0) {
          onProgress({ ...counters, phase: 'running' });
        }
        continue;
      }
      counters.phase = 'processing';
      onProgress({ ...counters });
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
      counters.meteredSpendUSD = meteredSpendUSD;

      // Evidence is deliberately limited to version/config/hash/status; no OCR,
      // filename, original directory, patient identifier, or free-text excerpts.
      if (result?.analysis) {
        await fs.appendFile(evidence, JSON.stringify({
          jobFileKey: key, runId, ...evidenceReport(result)
        }) + '\n');
      }
      // The indexed workspace must be written before the checkpoint.
      // Source path and detailed analysis stay in the local SQLite file.
      await auditStore.saveDocument(auditProject.id, pdfPath, result, runId, key);
      await fs.appendFile(journal, JSON.stringify({
        key, status: safeStatus, timestamp: new Date().toISOString()
      }) + '\n');
      completed.set(key, safeStatus);
      counters.currentFileNumber = null;
      counters.phase = 'running';
      onProgress({ ...counters });
    }
  } finally {
    counters.currentFileNumber = null;
    counters.finished = true;
    counters.phase = counters.stopped ? 'stopped' : 'completed';
    await recordRun(userData, {
      runId, mode, fileCount: counters.processed, totalPages: counters.pagesProcessed,
      pagesUnknown: counters.analysisFailed
    });
    onProgress({ ...counters });
    if (!store) await auditStore.close();
  }
  return { ...counters, projectId: auditProject.id, jobId: path.basename(output),
    disclaimer: 'Batch checkpoint and evidence contain no patient text. Paper completeness still requires independent source comparison.' };
}
module.exports = { runBulkAudit, inspectBulkFolder, walkPdfs, readJournal, makeFileKey, jobDirectory };
