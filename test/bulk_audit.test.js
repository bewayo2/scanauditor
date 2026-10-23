'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs-extra');
const os = require('node:os');
const path = require('node:path');
const { runBulkAudit, inspectBulkFolder, walkPdfs, jobDirectory } = require('../bulk_audit');

const fakeAnalyzer = () => ({
  analyzeFile: async ({ path: filename }) => ({
    analysis: {
      fileInformation: { totalPages: filename.includes('two') ? 2 : 4 },
      analysisMetadata: {
        fileSha256: 'a'.repeat(64), analysisDate: '2026-10-22T10:00:00Z',
        appVersion: 'test', models: { ocr: 'test' }, dpi: 300
      },
      qaAssessment: { status: 'passed', findings: [], informationalFindings: [] }
    }
  })
});
async function tempJob(t) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'scan-audit-batch-'));
  t.after(async () => fs.remove(temp));
  const root = path.join(temp, 'records');
  const userData = path.join(temp, 'app');
  await fs.ensureDir(root);
  await fs.ensureDir(userData);
  await fs.writeFile(path.join(root, 'Patient_Alice.pdf'), 'synthetic-not-medical');
  await fs.writeFile(path.join(root, 'two_Patient_Bob.PDF'), 'synthetic-not-medical');
  await fs.writeFile(path.join(root, 'not-a-pdf.txt'), 'unrelated');
  await fs.symlink(path.join(root, 'Patient_Alice.pdf'), path.join(root, 'alias.pdf'));
  return { root, userData };
}

test('recursive PDF walker skips symlinks and non-PDF files', async t => {
  const { root } = await tempJob(t);
  const paths = [];
  for await (const filename of walkPdfs(root)) paths.push(filename);
  assert.equal(paths.length, 2);
  assert.ok(paths.every(p => p.toLowerCase().endsWith('.pdf')));
});

test('batch can stop after one PDF and resume without reprocessing completed files', async t => {
  const { root, userData } = await tempJob(t);
  let calls = 0;
  const factory = () => ({ analyzeFile: async file => {
    calls += 1;
    return fakeAnalyzer().analyzeFile(file);
  } });
  const first = await runBulkAudit({ root, userData, maxFiles: 1, analyzerFactory: factory });
  assert.equal(first.stopped, true);
  assert.equal(first.processed, 1);
  const second = await runBulkAudit({ root, userData, analyzerFactory: factory });
  assert.equal(second.processed, 1);
  assert.equal(second.skippedFromCheckpoint, 1);
  assert.equal(calls, 2);
  assert.equal(second.stopped, false);
  const third = await runBulkAudit({ root, userData, analyzerFactory: factory });
  assert.equal(third.processed, 0);
  assert.equal(third.skippedFromCheckpoint, 2);
  const dir = jobDirectory(userData, root, 'local');
  const journal = await fs.readFile(path.join(dir, 'checkpoint.jsonl'), 'utf8');
  const evidence = await fs.readFile(path.join(dir, 'evidence.jsonl'), 'utf8');
  assert.equal(journal.trim().split('\n').length, 2);
  assert.equal(evidence.trim().split('\n').length, 2);
  for (const forbidden of ['Patient_Alice', 'Patient_Bob', 'synthetic-not-medical']) {
    assert.equal(journal.includes(forbidden), false);
    assert.equal(evidence.includes(forbidden), false);
  }
});

test('changed file is reprocessed as a new checkpoint version', async t => {
  const { root, userData } = await tempJob(t);
  const factory = fakeAnalyzer;
  const first = await runBulkAudit({ root, userData, analyzerFactory: factory });
  assert.equal(first.processed, 2);
  await fs.appendFile(path.join(root, 'Patient_Alice.pdf'), 'changed');
  const second = await runBulkAudit({ root, userData, analyzerFactory: factory });
  assert.equal(second.processed, 1);
  assert.equal(second.skippedFromCheckpoint, 1);
});

test('analysis failures are skipped until explicit retry is selected', async t => {
  const { root, userData } = await tempJob(t);
  let calls = 0;
  const factory = () => ({ analyzeFile: async () => {
    calls += 1;
    if (calls === 1) throw new Error('synthetic test failure');
    return fakeAnalyzer().analyzeFile({ path: 'two' });
  } });
  const first = await runBulkAudit({ root, userData, analyzerFactory: factory });
  assert.equal(first.analysisFailed, 1);
  const second = await runBulkAudit({ root, userData, analyzerFactory: factory });
  assert.equal(second.processed, 0);
  const third = await runBulkAudit({ root, userData, retryFailed: true, analyzerFactory: factory });
  assert.equal(third.processed, 1);
  assert.equal(third.passed, 1);
});

test('cloud bulk analysis is blocked without explicit hospital consent and API key', async t => {
  const { root, userData } = await tempJob(t);
  await assert.rejects(runBulkAudit({ root, userData, mode: 'tiered', analyzerFactory: fakeAnalyzer }), /authorization/);
});

test('cloud spend cap stops after currently charged PDF without starting another', async t => {
  const { root, userData } = await tempJob(t);
  let paidCalls = 0;
  const factory = ({ onUsage }) => ({
    analyzeFile: async file => {
      paidCalls += 1;
      await onUsage({ model: 'gpt-6-luna', pageKey: 'synthetic-page-' + paidCalls,
        usage: { input_tokens: 10000, output_tokens: 1000 } });
      return fakeAnalyzer().analyzeFile(file);
    }
  });
  const result = await runBulkAudit({
    root, userData, mode: 'tiered', apiKey: 'sk-test-nonproduction',
    hospitalApproved: true, maxUsd: 0.001, analyzerFactory: factory
  });
  assert.equal(result.processed, 1);
  assert.equal(result.stopped, true);
  assert.equal(paidCalls, 1);
  assert.ok(result.meteredSpendUSD >= 0.001);
});


test('folder preview counts all PDFs but estimates pages from safe metadata sampling', async t => {
  const { root } = await tempJob(t);
  const events = [];
  const info = await inspectBulkFolder({
    root,
    readPageCount: async file => path.basename(file).startsWith('two_') ? 2 : 4,
    sampleLimit: 20,
    onProgress: event => events.push(event)
  });
  assert.equal(info.filesTotal, 2);
  assert.equal(info.estimatedPages, 6);
  assert.equal(info.estimateKind, 'exact-metadata');
  assert.equal(info.sampledFiles, 2);
  assert.equal(info.sampleFailed, 0);
  assert.ok(events.some(x => x.phase === 'inventory'));
  assert.ok(events.some(x => x.phase === 'sampling'));
  assert.ok(events.some(x => x.phase === 'ready'));
  const serialized = JSON.stringify(events);
  assert.ok(!serialized.includes('Patient_Alice'));
  assert.ok(!serialized.includes('Patient_Bob'));
  assert.ok(!serialized.includes(root));
});

test('page preview marks sampled forecasts approximate when not every file is counted', async t => {
  const { root } = await tempJob(t);
  const result = await inspectBulkFolder({
    root, sampleLimit: 1, readPageCount: async () => 3
  });
  assert.equal(result.filesTotal, 2);
  assert.equal(result.sampledFiles, 1);
  assert.equal(result.estimatedPages, 6);
  assert.equal(result.estimateKind, 'sampled');
});

test('unreadable preview PDFs preserve PDF counts but do not invent pages', async t => {
  const { root } = await tempJob(t);
  const result = await inspectBulkFolder({
    root, readPageCount: async () => { throw new Error('synthetic encrypted PDF'); }
  });
  assert.equal(result.filesTotal, 2);
  assert.equal(result.estimatedPages, null);
  assert.equal(result.sampleFailed, 2);
  assert.equal(result.estimateKind, 'unavailable');
});

test('folder inventory is cancellable and does not perform any source-file mutation', async t => {
  const { root } = await tempJob(t);
  const cancel = { requested: false };
  const events = [];
  const summary = await inspectBulkFolder({
    root, cancellation: cancel, sampleLimit: 2,
    onProgress: event => {
      events.push(event);
      if (event.phase === 'inventory' && event.filesTotal > 0) cancel.requested = true;
    },
    readPageCount: async () => 4
  });
  assert.equal(summary.canceled, true);
  assert.ok(events.some(x => x.phase === 'canceled'));
  assert.equal(await fs.readFile(path.join(root, 'Patient_Alice.pdf'), 'utf8'), 'synthetic-not-medical');
});

test('batch emits processing/completed events for every PDF with pages but no source path', async t => {
  const { root, userData } = await tempJob(t);
  const events = [];
  const info = await inspectBulkFolder({
    root, readPageCount: async () => 3
  });
  const result = await runBulkAudit({
    root, userData, inventory: info, analyzerFactory: fakeAnalyzer,
    onProgress: progress => events.push(progress)
  });
  assert.equal(result.processed, 2);
  assert.equal(result.pagesProcessed, 6);
  assert.equal(result.filesTotal, 2);
  assert.equal(result.estimatedPages, 6);
  const processing = events.filter(x => x.phase === 'processing');
  assert.equal(processing.length, 2);
  assert.deepEqual(processing.map(x => x.currentFileNumber), [1, 2]);
  assert.ok(events.some(x => x.phase === 'running' && x.pagesProcessed === 4));
  assert.ok(events.some(x => x.phase === 'completed' && x.pagesProcessed === 6));
  const serialized = JSON.stringify(events);
  for (const privateText of ['Patient_Alice', 'Patient_Bob', root, 'synthetic-not-medical']) {
    assert.equal(serialized.includes(privateText), false);
  }
});

test('previously checkpointed PDFs increment skip count and preserve processed-page meaning', async t => {
  const { root, userData } = await tempJob(t);
  const info = await inspectBulkFolder({ root, readPageCount: async () => 3 });
  const first = await runBulkAudit({
    root, userData, maxFiles: 1, inventory: info, analyzerFactory: fakeAnalyzer
  });
  assert.equal(first.processed, 1);
  const events = [];
  const resumed = await runBulkAudit({
    root, userData, inventory: info, analyzerFactory: fakeAnalyzer,
    onProgress: event => events.push(event)
  });
  assert.equal(resumed.processed, 1);
  assert.equal(resumed.skippedFromCheckpoint, 1);
  assert.equal(resumed.pagesProcessed, 2);
  assert.equal(resumed.filesTotal, 2);
  assert.equal(resumed.phase, 'completed');
  assert.ok(events.some(x => x.phase === 'completed' && x.skippedFromCheckpoint === 1));
});
