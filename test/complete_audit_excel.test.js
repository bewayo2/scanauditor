'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs-extra');
const os = require('node:os');
const path = require('node:path');
const XLSX = require('xlsx');
const { AuditStore } = require('../audit_store');

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
function reportResult(fileName, status = 'review-required', hash = HASH_A) {
  const findings = status === 'review-required'
    ? [{ code: 'POSSIBLE_CUTOFF', pages: [2], message: 'Possible cropped region' }] : [];
  return { analysis: {
    fileInformation: { fileName, totalPages: 4, analysisDate: '2026-10-29T08:00:00Z' },
    analysisMetadata: { fileSha256: hash, analysisDate: '2026-10-29T08:00:00Z', models: {}, dpi: 300 },
    qaAssessment: { status, findings, informationalFindings: [] },
    patientIdentifiers: { names: [], hospitalNumbers: [] },
    summaryTable: [], informationalTable: [],
    recordAssociation: { status: 'not-configured' }
  }};
}
async function setup(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scanauditor-complete-report-'));
  t.after(async () => fs.remove(dir));
  const store = new AuditStore(dir);
  await store.start();
  t.after(async () => store.close());
  const project = await store.upsertProject(path.join(dir, 'records'), 'local', 'folder');
  return { dir, store, project };
}

function sheetRows(book, sheet) {
  assert.ok(book.SheetNames.includes(sheet), 'Missing workbook sheet ' + sheet);
  return XLSX.utils.sheet_to_json(book.Sheets[sheet], { defval: '', raw: true });
}

test('complete workbook includes all records, historic issues, decisions and corrective-action events', async t => {
  const { dir, store, project } = await setup(t);
  const first = await store.saveDocument(project.id,
    path.join(dir, 'records', '=HYPERLINK("bad").pdf'),
    reportResult('=HYPERLINK("bad").pdf'), 'run-one');
  await store.reviewDocument(first.id, 'inconclusive', 'Reviewer One');
  await store.reviewDocument(first.id, 'scan-defect-confirmed', 'Reviewer Two');
  const action = await store.createAction(first.id, 'rescan', 'Reviewer Two');
  await store.updateAction(action.id, 'completed', 'Reviewer Three');
  await store.updateAction(action.id, 'open', 'Reviewer Four');
  // Reanalysis changed the result and removed the current human decision;
  // history must still show both old decisions and prior findings.
  await store.saveDocument(project.id,
    path.join(dir, 'records', '=HYPERLINK("bad").pdf'),
    reportResult('=HYPERLINK("bad").pdf', 'passed', HASH_B), 'run-two');

  const second = await store.saveDocument(project.id,
    path.join(dir, 'records', 'reviewed.pdf'),
    reportResult('reviewed.pdf'), 'run-three');
  await store.reviewDocument(second.id, 'source-issue-confirmed', 'Reviewer Five');
  // Reanalyze an unchanged assessment. The retained decision stays current.
  await store.saveDocument(project.id,
    path.join(dir, 'records', 'reviewed.pdf'), reportResult('reviewed.pdf'), 'run-four');

  for (let i = 0; i < 61; i++) {
    await store.saveDocument(project.id,
      path.join(dir, 'records', 'extra-' + i + '.pdf'),
      reportResult('extra-' + i + '.pdf', 'passed'), 'run-extra-' + i);
  }
  const other = await store.upsertProject(path.join(dir, 'other-project'), 'local', 'folder');
  await store.saveDocument(other.id, path.join(dir, 'other-project', 'exclude.pdf'),
    reportResult('exclude.pdf', 'passed'), 'other');

  const dest = path.join(dir, 'complete.xlsx');
  const exported = await store.exportCompleteExcel(project.id, dest);
  assert.equal(exported.saved, true);
  assert.equal(exported.rows, 63);
  assert.equal(exported.sheets, 8);
  assert.ok((await fs.stat(dest)).size > 0);
  const book = XLSX.readFile(dest, { cellFormula: true });
  assert.deepEqual(book.SheetNames, [
    'Executive Summary', 'Record Register', 'Current Findings',
    'Analysis Runs', 'Run Findings History', 'Human Review Decisions',
    'Corrective Actions', 'Action History'
  ]);
  const register = sheetRows(book, 'Record Register');
  assert.equal(register.length, 63, 'the export must not inherit the 50-row Review Queue limit');
  assert.equal(register.some(r => r.Filename === 'exclude.pdf'), false);
  assert.equal(register.find(r => r['Record ID'] === first.id)['Latest human outcome'], '');
  assert.equal(register.find(r => r['Record ID'] === second.id)['Latest human outcome'], 'source-issue-confirmed');

  const history = sheetRows(book, 'Human Review Decisions');
  assert.equal(history.length, 3);
  assert.equal(history.filter(r => r['Decision status'] === 'Historical / superseded').length, 2);
  assert.equal(history.find(r => r['Reviewer (staff-entered)'] === 'Reviewer Five')['Decision status'], 'Current');

  const runs = sheetRows(book, 'Analysis Runs');
  assert.equal(runs.length, 65);
  assert.equal(runs.filter(r => r['Record ID'] === first.id).length, 2);
  assert.equal(runs.find(r => r['Record ID'] === first.id)['Historical / current'], 'Historical');

  const priorFindings = sheetRows(book, 'Run Findings History');
  assert.ok(priorFindings.some(r =>
    r['Record ID'] === first.id && r['Finding code'] === 'POSSIBLE_CUTOFF' && r['PDF page'] === 2));
  assert.equal(sheetRows(book, 'Current Findings').some(r => r['Record ID'] === first.id), false);

  assert.deepEqual(sheetRows(book, 'Corrective Actions').map(r => r['Current status']), ['open']);
  assert.deepEqual(sheetRows(book, 'Action History').map(r => r['Status event']),
    ['open', 'completed', 'open']);

  const overview = sheetRows(book, 'Executive Summary');
  assert.ok(overview.some(r => r.Measure === 'Documents indexed' && r.Value === 63));
  assert.ok(overview.some(r => r.Measure === 'Open corrective actions' && r.Value === 1));
  assert.ok(overview.some(r => r.Measure === 'Disposal limitation' && /destruction/i.test(r.Value)));
  // The formula-looking synthetic filename must be a literal Excel string.
  const formulas = Object.values(book.Sheets['Record Register']).filter(v => v && typeof v === 'object' && v.f);
  assert.equal(formulas.length, 0, 'patient-identifying filenames must never be interpreted as formulas');
});

test('an unknown project cannot be exported and errors leave no partial report', async t => {
  const { dir, store } = await setup(t);
  const destination = path.join(dir, 'invalid.xlsx');
  await assert.rejects(store.exportCompleteExcel('not-a-project', destination), /SQLite/);
  assert.equal(await fs.pathExists(destination), false);
});

test('large numeric findings remain a bounded, searchable worksheet', async t => {
  const { dir, store, project } = await setup(t);
  const doc = reportResult('case.pdf');
  doc.analysis.qaAssessment.findings = [{ code: 'PRINTED_PAGE_SEQUENCE_GAP', pages: [2, 4, 7] }];
  await store.saveDocument(project.id, path.join(dir, 'records', 'case.pdf'), doc);
  const dest = path.join(dir, 'findings.xlsx');
  await store.exportCompleteExcel(project.id, dest);
  const book = XLSX.readFile(dest);
  assert.deepEqual(sheetRows(book, 'Current Findings').map(x => x['PDF page']), [2, 4, 7]);
  assert.equal(sheetRows(book, 'Current Findings')[0]['Issue identified'], 'Possible missing numbered page');
});
