'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs-extra');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
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
  assert.match(text, /Document,Pages,Overall audit result,Scan quality QA/);
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


test('inconclusive reviews remain in the unresolved queue until a definitive decision', async t => {
  const { store, project, root } = await setup(t);
  const doc = await store.saveDocument(project.id, path.join(root, 'uncertain.pdf'),
    analysis('uncertain.pdf', 'review-required'));
  await store.reviewDocument(doc.id, 'inconclusive', 'Test reviewer');
  const unresolved = await store.listDocuments({
    projectId: project.id, status: 'review-required', review: 'pending'
  });
  assert.equal(unresolved.total, 1);
  assert.equal((await store.summary(project.id)).pending_review, 1);
  await store.reviewDocument(doc.id, 'model-false-positive', 'Test reviewer');
  assert.equal((await store.listDocuments({
    projectId: project.id, status: 'review-required', review: 'pending'
  })).total, 0);
  assert.equal((await store.listDocuments({
    projectId: project.id, status: 'review-required', review: 'reviewed'
  })).total, 1);
});

test('corrective-action transitions preserve optional staff labels as unauthenticated provenance', async t => {
  const { store, project, root } = await setup(t);
  const doc = await store.saveDocument(project.id, path.join(root, 'review.pdf'),
    analysis('review.pdf', 'review-required'));
  const action = await store.createAction(doc.id, 'rescan', 'Operator A');
  await store.updateAction(action.id, 'completed', 'Operator B');
  const loaded = await store.getDocument(doc.id);
  assert.deepEqual(loaded.actionHistory.map(x => x.reviewer_label), ['Operator B', 'Operator A']);
});


test('problem type dropdown includes only review findings for its selected project', async t => {
  const { store, project, root } = await setup(t);
  const first = await store.saveDocument(project.id, path.join(root, 'first.pdf'),
    analysis('first.pdf', 'review-required'));
  await store.saveDocument(project.id, path.join(root, 'second.pdf'),
    analysis('second.pdf', 'review-required'));
  const another = await store.upsertProject(path.join(root, 'second-area'), 'local', 'folder');
  await store.saveDocument(another.id, path.join(root, 'third.pdf'),
    analysis('third.pdf', 'review-required'));
  const types = await store.listFindingTypes(project.id);
  assert.deepEqual(types, [{ code: 'CUT_OFF_TEXT', documents: 2 }]);
  assert.deepEqual(await store.listFindingTypes(another.id), [{ code: 'CUT_OFF_TEXT', documents: 1 }]);
  assert.equal((await store.listDocuments({ projectId: project.id,
    findingCode: types[0].code, status: 'all', review: 'all' })).total, 2);
  await store.reviewDocument(first.id, 'model-false-positive', 'Tester');
  // A human review changes disposition, but not the recorded automated category.
  assert.deepEqual(await store.listFindingTypes(project.id), types);
  await assert.rejects(store.listFindingTypes(''), /SQLite/);
});


test('previously scanned context-only reviews are removed from pending queue without a rescan', async t => {
  const { store, project, root } = await setup(t);
  const source = path.join(root, 'synthetic-11-page.pdf');
  const old = analysis('synthetic-11-page.pdf', 'review-required', initialHash, 11);
  old.analysis.qaAssessment.findings = [
    { code: 'UNRESOLVED_PAGE', pages: [9, 11], message: 'Old rule required paper comparison.' },
    { code: 'MULTIPLE_PATIENT_IDENTIFIERS', pages: [1], message: 'Old rule required paper comparison.' }
  ];
  old.analysis.qaAssessment.reason = 'Old scan-fidelity rules require manual review.';
  old.analysis.recommendations = { manualReview: ['Old rule required paper comparison.'],
    compareWithSource: ['Compare pages 1, 9, 11'], rescanning: [] };
  const saved = await store.saveDocument(project.id, source, old, 'historical-run');
  await store.reviewDocument(saved.id, 'inconclusive', 'Tester');
  const before = await store.getDocument(saved.id);
  assert.equal(before.qa_status, 'review-required');
  const result = await store.call('reclassifyPolicy');
  assert.equal(result.reclassified, 1);
  const after = await store.getDocument(saved.id);
  assert.equal(after.qa_status, 'passed');
  assert.equal(after.analysis.qaAssessment.status, 'passed');
  assert.equal(after.analysis.qaAssessment.policyReclassified, true);
  assert.equal(after.analysis.qaAssessment.findings.length, 0);
  assert.deepEqual(after.analysis.qaAssessment.informationalFindings
    .filter(f => f.code === 'UNRESOLVED_PAGE')[0].pages, [9, 11]);
  assert.equal(after.reviews.length, 1);
  assert.equal(after.review_outcome, 'inconclusive');
  assert.equal((await store.summary(project.id)).pending_review, 0);
  assert.equal((await store.listDocuments({
    projectId: project.id, status: 'review-required', review: 'pending'
  })).total, 0);
  const types = await store.listFindingTypes(project.id);
  assert.deepEqual(types, []);
  // Original cryptographic evidence is retained as a historic scan snapshot.
  assert.equal(before.evidence.qa.status, 'review-required');
  assert.equal(after.evidence.qa.status, 'review-required');
  assert.equal((await store.call('reclassifyPolicy')).reclassified, 0);
});

test('material defects survive reclassification alongside unrelated OCR uncertainty', async t => {
  const { store, project, root } = await setup(t);
  const old = analysis('material.pdf', 'review-required');
  old.analysis.qaAssessment.findings = [
    { code: 'UNRESOLVED_PAGE', pages: [3], message: 'Legacy unknown continuation' },
    { code: 'POSSIBLE_CUTOFF', pages: [4], message: 'Potential material crop' }
  ];
  const doc = await store.saveDocument(project.id, path.join(root, 'material.pdf'), old);
  assert.equal((await store.call('reclassifyPolicy')).reclassified, 1);
  const after = await store.getDocument(doc.id);
  assert.equal(after.qa_status, 'review-required');
  assert.deepEqual(after.analysis.qaAssessment.findings.map(f => f.code), ['POSSIBLE_CUTOFF']);
  assert.equal(after.analysis.qaAssessment.informationalFindings[0].code, 'UNRESOLVED_PAGE');
  assert.equal((await store.summary(project.id)).pending_review, 1);
});


test('opening an existing v1 SQLite workspace reclassifies prior contextual-only cases automatically', async t => {
  const { store, project, root, dir } = await setup(t);
  const old = analysis('previous-sample.pdf', 'review-required', initialHash, 11);
  old.analysis.qaAssessment.findings = [
    { code: 'UNRESOLVED_PAGE', pages: [9, 11], message: 'Legacy review' },
    { code: 'MULTIPLE_PATIENT_IDENTIFIERS', pages: [1], message: 'Legacy review' }
  ];
  const original = await store.saveDocument(project.id, path.join(root, 'previous-sample.pdf'),
    old, 'pre-policy-run');
  await store.close();
  const dbPath = path.join(dir, 'audit-workspace', 'workspace.sqlite3');
  const downgrade = spawnSync(store.python, ['-c',
    'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute("PRAGMA user_version=1"); c.close()',
    dbPath], { encoding: 'utf8' });
  assert.equal(downgrade.status, 0, 'Synthetic v1 database fixture should be writable');
  const restored = new AuditStore(dir);
  t.after(async () => restored.close());
  assert.deepEqual(await restored.call('ping'), { ready: true, schema: 4 });
  const upgraded = await restored.getDocument(original.id);
  assert.equal(upgraded.qa_status, 'passed');
  assert.equal(upgraded.analysis.qaAssessment.policyReclassified, true);
  assert.equal(upgraded.evidence.qa.status, 'review-required');
  assert.equal((await restored.listDocuments({
    projectId: project.id, status: 'review-required', review: 'pending'
  })).total, 0);
});


test('patient folder association review is queued separately from a passing scan QA assessment', async t => {
  const { store, project, root } = await setup(t);
  const pdf = analysis('synthetic-record.pdf', 'passed');
  pdf.analysis.recordAssociation = {
    status: 'needs-review', basis: 'authoritative-folder',
    expectedRegistration: '654321',
    flags: [{ code: 'REGISTRATION_DISCREPANCY', observedRegistration: '345678',
      pages: [4, 8], confidence: 'high' }]
  };
  const saved = await store.saveDocument(project.id, path.join(root, '654321', 'synthetic-record.pdf'), pdf);
  assert.equal(saved.qaStatus, 'passed');
  assert.equal(saved.associationStatus, 'needs-review');
  const attention = await store.listDocuments({
    projectId: project.id, status: 'attention', review: 'pending'
  });
  assert.equal(attention.total, 1);
  assert.equal(attention.rows[0].association_status, 'needs-review');
  assert.equal(attention.rows[0].qa_status, 'passed');
  assert.equal(attention.rows[0].overall_audit_status, 'review-required');
  assert.equal(attention.rows[0].finding_codes, 'REGISTRATION_DISCREPANCY');
  const issueOptions = await store.listFindingTypes(project.id);
  assert.deepEqual(issueOptions, [{ code: 'REGISTRATION_DISCREPANCY', documents: 1 }]);
  const filteredIdentity = await store.listDocuments({
    projectId: project.id, status: 'attention',
    findingCode: 'REGISTRATION_DISCREPANCY', review: 'pending'
  });
  assert.equal(filteredIdentity.total, 1);
  assert.equal(filteredIdentity.rows[0].overall_audit_status, 'review-required');
  assert.equal((await store.listDocuments({
    projectId: project.id, status: 'review-required', review: 'pending'
  })).total, 0);
  assert.equal((await store.listDocuments({
    projectId: project.id, status: 'association-review', review: 'pending'
  })).total, 1);
  const stats = await store.summary(project.id);
  assert.equal(stats.review_required, 0);
  assert.equal(stats.association_review, 1);
  assert.equal(stats.overall_review_required, 1);
  assert.equal(stats.pending_review, 1);
  await store.reviewDocument(saved.id, 'folder-mismatch-confirmed', 'Synthetic reviewer');
  assert.equal((await store.listDocuments({
    projectId: project.id, status: 'attention', review: 'pending'
  })).total, 0);
  const record = await store.getDocument(saved.id);
  assert.equal(record.review_outcome, 'folder-mismatch-confirmed');
  assert.equal(record.reviews[0].comparison_basis, 'digital-only');
  assert.equal(record.analysis.recordAssociation.flags[0].observedRegistration, '345678');
});

test('SQLite schema migration retains old cases while adding the association index', async t => {
  const { store, dir, project, root } = await setup(t);
  const old = await store.saveDocument(project.id, path.join(root, 'old.pdf'),
    analysis('old.pdf', 'passed'));
  await store.close();
  const file = path.join(dir,'audit-workspace','workspace.sqlite3');
  const downgraded = spawnSync(store.python, ['-c',
    'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute("PRAGMA user_version=2"); c.close()', file],
    {encoding:'utf8'});
  assert.equal(downgraded.status, 0);
  const restarted = new AuditStore(dir);
  t.after(async () => restarted.close());
  assert.deepEqual(await restarted.call('ping'), { ready:true,schema:4 });
  assert.equal((await restarted.getDocument(old.id)).qa_status, 'passed');
  assert.equal((await restarted.getDocument(old.id)).association_status, 'not-assessed');
});


test('overall audit includes document preparation findings without double-counting scan defects', async t => {
  const { store, project, root } = await setup(t);
  const one = analysis('identity-only.pdf', 'passed');
  one.analysis.recordAssociation = { status: 'needs-review', basis: 'authoritative-folder',
    flags: [{ code: 'PATIENT_NAME_DISCREPANCY', pages: [2, 4], confidence: 'high',
      observedName: 'Synthetic name' }] };
  const both = analysis('two-types.pdf', 'review-required');
  both.analysis.recordAssociation = { status: 'needs-review', basis: 'authoritative-folder',
    flags: [{ code: 'REGISTRATION_DISCREPANCY', pages: [1, 3], confidence: 'high',
      observedRegistration: '345678' }] };
  await store.saveDocument(project.id, path.join(root, 'identity-only.pdf'), one);
  await store.saveDocument(project.id, path.join(root, 'two-types.pdf'), both);
  const summary = await store.summary(project.id);
  assert.equal(summary.documents, 2);
  assert.equal(summary.review_required, 1); // Scan-fidelity problems only.
  assert.equal(summary.association_review, 2);
  assert.equal(summary.overall_review_required, 2); // Both concerns on one PDF count once.
  const issues = await store.listFindingTypes(project.id);
  assert.ok(issues.some(x => x.code === 'PATIENT_NAME_DISCREPANCY'));
  assert.ok(issues.some(x => x.code === 'REGISTRATION_DISCREPANCY'));
  const rows = await store.listDocuments({ projectId: project.id, status: 'attention' });
  assert.equal(rows.total, 2);
  assert.ok(rows.rows.every(x => x.overall_audit_status === 'review-required'));
  assert.ok(rows.rows.find(x => x.display_name === 'two-types.pdf').finding_codes.includes('REGISTRATION_DISCREPANCY'));
  // No names, patient registrations or clinical text appear in index entries.
  assert.ok(!JSON.stringify(issues).includes('345678'));
  assert.ok(!JSON.stringify(issues).includes('Synthetic name'));
  const csv = path.join(root, 'project.csv');
  assert.equal((await store.exportQueue(project.id, csv)).rows, 2);
  const output = await fs.readFile(csv, 'utf8');
  assert.match(output, /Overall audit result,Scan quality QA,Document preparation/);
  assert.match(output, /REGISTRATION_DISCREPANCY/);
  assert.match(output, /PATIENT_NAME_DISCREPANCY/);
});
test('SQLite upgrades preexisting v3 identity cases into the same findings index once', async t => {
  const { store, project, root, dir } = await setup(t);
  const caseResult = analysis('old-identity.pdf', 'passed');
  caseResult.analysis.recordAssociation = { status: 'needs-review',
    flags: [{ code: 'REGISTRATION_DISCREPANCY', pages: [3, 5], confidence: 'high' }] };
  const row = await store.saveDocument(project.id, path.join(root, 'old-identity.pdf'), caseResult);
  await store.close();
  const location = path.join(dir, 'audit-workspace', 'workspace.sqlite3');
  // Simulate pre-v4 data: identity status was stored but no finding index rows.
  const reset = spawnSync(store.python, ['-c',
    'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute("DELETE FROM findings"); c.execute("PRAGMA user_version=3"); c.commit(); c.close()', location],
    { encoding: 'utf8' });
  assert.equal(reset.status, 0);
  const reopened = new AuditStore(dir);
  t.after(async () => reopened.close());
  assert.deepEqual(await reopened.call('ping'), { ready: true, schema: 4 });
  let findings = await reopened.listFindingTypes(project.id);
  assert.deepEqual(findings, [{ code: 'REGISTRATION_DISCREPANCY', documents: 1 }]);
  const details = await reopened.getDocument(row.id);
  assert.equal(details.qa_status, 'passed');
  assert.equal(details.association_status, 'needs-review');
  await reopened.close();
  const reopenedAgain = new AuditStore(dir);
  t.after(async () => reopenedAgain.close());
  findings = await reopenedAgain.listFindingTypes(project.id);
  assert.deepEqual(findings, [{ code: 'REGISTRATION_DISCREPANCY', documents: 1 }]);
});
