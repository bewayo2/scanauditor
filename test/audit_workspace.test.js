'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs-extra');
const os = require('node:os');
const path = require('node:path');
const { AuditStore, localProjectId } = require('../audit_store');

const initialHash = 'a'.repeat(64);
const updatedHash = 'b'.repeat(64);
function analysis(name, status, hash = initialHash, pages = 4) {
  return { analysis: {
    fileInformation: { fileName: name, totalPages: pages },
    analysisMetadata: { fileSha256: hash, analysisDate: '2026-10-26T08:00:00Z', models: {}, dpi: 300 },
    qaAssessment: { status,
      findings: status === 'review-required' ? [{ code: 'CUT_OFF_TEXT', pages: [2, 3] }] : [],
      informationalFindings: [] },
    patientIdentifiers: { names: [], hospitalNumbers: [] },
    summaryTable: [], informationalTable: []
  } };
}
async function setup(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scanauditor-sqlite-'));
  t.after(async () => fs.remove(dir));
  const store = new AuditStore(dir);
  await store.start();
  t.after(async () => store.close());
  const root = path.join(dir, 'source');
  await fs.ensureDir(root);
  const project = await store.upsertProject(root, 'local', 'folder');
  return { dir, store, project, root };
}
test('SQLite initializes a local WAL-backed indexed workspace with no external server', async t => {
  const { dir, store, project, root } = await setup(t);
  assert.match(project.id, /^[a-f0-9]{64}$/);
  assert.equal(localProjectId(root, 'local'), project.id);
  assert.equal((await store.listProjects()).length, 1);
  assert.ok(await fs.pathExists(path.join(dir, 'audit-workspace', 'workspace.sqlite3')));
  const summary = await store.summary(project.id);
  assert.equal(summary.documents, 0);
  assert.equal(summary.pages, 0);
});

test('bulk and individual cases are searchable without loading all documents', async t => {
  const { store, project, root } = await setup(t);
  for (let i = 0; i < 115; i += 1) {
    const name = 'synthetic_' + String(i).padStart(4, '0') + '.pdf';
    await store.saveDocument(project.id, path.join(root, name),
      analysis(name, i % 2 ? 'passed' : 'review-required'), 'test-run');
  }
  const all = await store.listDocuments({ projectId: project.id, status: 'all', review: 'all', page: 1, limit: 50 });
  assert.equal(all.total, 115);
  assert.equal(all.rows.length, 50);
  assert.ok(all.rows.every(x => !Object.hasOwn(x, 'analysis_json')));
  assert.ok(all.rows.every(x => !Object.hasOwn(x, 'source_path')));
  const last = await store.listDocuments({ projectId: project.id, status: 'all', review: 'all', page: 3, limit: 50 });
  assert.equal(last.rows.length, 15);
  const review = await store.listDocuments({ projectId: project.id, status: 'review-required', review: 'pending', page: 1, limit: 50 });
  assert.equal(review.total, 58);
  const search = await store.listDocuments({ projectId: project.id, status: 'all', review: 'all',
    search: 'synthetic_0005', page: 1, limit: 50 });
  assert.equal(search.total, 1);
  const finding = await store.listDocuments({ projectId: project.id, status: 'all', review: 'all',
    findingCode: 'CUT_OFF_TEXT', page: 1, limit: 50 });
  assert.equal(finding.total, 58);
  await assert.rejects(store.listDocuments({ projectId: project.id, page: 1, limit: 100000 }), /SQLite/);
  assert.equal((await store.summary(project.id)).pages, 115 * 4);
});

test('manual decisions, source-paper basis and corrective actions are retained across restarts', async t => {
  const { dir, store, project, root } = await setup(t);
  const source = path.join(root, 'synthetic-case.pdf');
  const saved = await store.saveDocument(project.id, source, analysis('synthetic-case.pdf', 'review-required'));
  const review = await store.reviewDocument(saved.id, 'scan-defect-confirmed', 'Test reviewer');
  assert.equal(review.comparisonBasis, 'paper-compared');
  const action = await store.createAction(saved.id, 'rescan');
  assert.equal(action.status, 'open');
  await store.updateAction(action.id, 'completed');
  const stored = await store.getDocument(saved.id);
  assert.equal(stored.review_outcome, 'scan-defect-confirmed');
  assert.equal(stored.reviews.length, 1);
  assert.equal(stored.actions[0].status, 'completed');
  assert.equal(stored.analysis.qaAssessment.findings[0].pages[0], 2);
  assert.equal((await store.summary(project.id)).reviewed, 1);
  const filtered = await store.listDocuments({ projectId: project.id, review: 'reviewed', status: 'all' });
  assert.equal(filtered.total, 1);

  // A restart should not lose decisions or require scanning the PDFs again.
  await store.close();
  const reopened = new AuditStore(dir);
  t.after(async () => reopened.close());
  const again = await reopened.getDocument(saved.id);
  assert.equal(again.review_outcome, 'scan-defect-confirmed');
  assert.equal(again.reviews[0].comparison_basis, 'paper-compared');
  assert.equal(again.actions[0].status, 'completed');
});

test('reanalyzing a changed PDF supersedes current status but retains review event history', async t => {
  const { store, project, root } = await setup(t);
  const source = path.join(root, 'test-case.pdf');
  const first = await store.saveDocument(project.id, source, analysis('test-case.pdf', 'review-required'));
  await store.reviewDocument(first.id, 'no-defect-digital', 'Tester');
  const unchanged = await store.saveDocument(project.id, source, analysis('test-case.pdf', 'passed'));
  assert.equal(unchanged.id, first.id);
  assert.equal((await store.getDocument(first.id)).review_outcome, 'no-defect-digital');
  const changed = await store.saveDocument(project.id, source,
    analysis('test-case.pdf', 'review-required', updatedHash));
  const record = await store.getDocument(changed.id);
  assert.equal(record.review_outcome, null);
  assert.equal(record.reviews.length, 1);
  assert.equal(record.revision, 3);
  assert.equal(record.qa_status, 'review-required');
  await assert.rejects(store.reviewDocument(first.id, 'unsupported', ''), /SQLite/);
});

test('project summaries and queue filters never leak detailed source path or OCR payloads', async t => {
  const { store, project, root } = await setup(t);
  const source = path.join(root, 'Sensitive Patient Number 123.pdf');
  const result = analysis('Sensitive Patient Number 123.pdf', 'review-required');
  result.analysis.patientIdentifiers.names = [{ value: 'Synthetic Alice' }];
  const saved = await store.saveDocument(project.id, source, result);
  const summary = JSON.stringify(await store.listDocuments({ projectId: project.id, status: 'all' }));
  assert.ok(!summary.includes(root));
  assert.ok(!summary.includes('Synthetic Alice'));
  const full = await store.getDocument(saved.id);
  assert.equal(full.analysis.patientIdentifiers.names[0].value, 'Synthetic Alice');
  assert.equal(full.source_path, source);
  assert.equal(full.evidence.inputSha256, initialHash);
});


test('SQLite backup is complete and summary CSV streams records with spreadsheet-injection protection', async t => {
  const { dir, store, project, root } = await setup(t);
  const risky = path.join(root, '=TEST_FORMULA(1).pdf');
  const saved = await store.saveDocument(project.id, risky,
    analysis('=TEST_FORMULA(1).pdf', 'review-required'));
  await store.reviewDocument(saved.id, 'inconclusive', 'Test reviewer');
  const csv = path.join(dir, 'summary.csv');
  const exported = await store.exportQueue(project.id, csv);
  assert.equal(exported.rows, 1);
  const text = await fs.readFile(csv, 'utf8');
  assert.match(text, /Document,Pages,Automated QA/);
  assert.ok(text.includes("'=TEST_FORMULA(1).pdf"));
  assert.ok(text.includes('inconclusive'));
  const backupPath = path.join(dir, 'secure-backup.sqlite3');
  assert.deepEqual(await store.backupDatabase(backupPath), { saved: true });
  await store.close();

  // Verify the backup is a valid independently openable database snapshot.
  const backupDir = path.join(dir, 'restored', 'audit-workspace');
  await fs.ensureDir(backupDir);
  await fs.copy(backupPath, path.join(backupDir, 'workspace.sqlite3'));
  const restored = new AuditStore(path.join(dir, 'restored'));
  t.after(async () => restored.close());
  const loaded = await restored.getDocument(saved.id);
  assert.equal(loaded.review_outcome, 'inconclusive');
  assert.equal(loaded.analysis.qaAssessment.status, 'review-required');
});

test('corrective-action status changes create append-only history without losing previous transitions', async t => {
  const { store, project, root } = await setup(t);
  const saved = await store.saveDocument(project.id, path.join(root, 'test.pdf'),
    analysis('test.pdf', 'review-required'));
  const action = await store.createAction(saved.id, 'paper-comparison');
  await store.updateAction(action.id, 'completed');
  await store.updateAction(action.id, 'open');
  const doc = await store.getDocument(saved.id);
  assert.deepEqual(doc.actionHistory.map(x => x.status), ['open', 'completed', 'open']);
  assert.equal(doc.actions[0].status, 'open');
});
