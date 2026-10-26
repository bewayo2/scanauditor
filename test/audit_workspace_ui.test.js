'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const bulk = fs.readFileSync(path.join(root, 'bulk_audit.js'), 'utf8');

test('the folder audit and review queue are the primary workflow', () => {
  const provider = html.indexOf('id="provider-heading"');
  const bulkSection = html.indexOf('id="bulk-heading"');
  const workspace = html.indexOf('id="workspace-heading"');
  const individual = html.indexOf('class="audit-individual-tools"');
  const cost = html.indexOf('id="cost-heading"');
  assert.ok(provider >= 0 && bulkSection > provider);
  assert.ok(workspace > bulkSection && individual > workspace);
  assert.ok(cost > individual);
  assert.match(html, /<summary>Audit an individual PDF \(uses the same Review Queue\)<\/summary>/);
});

test('queue uses server pagination, filters, a single-case viewer and manual actions', () => {
  for (const id of ['audit-project','audit-status-filter','audit-review-filter','audit-finding',
    'audit-search','audit-next','audit-previous','audit-queue-rows',
    'audit-record-detail','audit-open-pdf','audit-reanalyze','audit-rescan-task',
    'audit-paper-task','audit-export-summary','audit-export-evidence',
    'audit-export-record-excel','audit-backup']) {
    assert.ok(html.includes('id="' + id + '"'), id);
  }
  assert.match(renderer, /limit: 50/);
  assert.match(renderer, /window\.electronAPI\.auditListDocuments\(params\)/);
  assert.match(renderer, /createResultCard\(\{ analysis \}\)/);
  assert.match(renderer, /window\.electronAPI\.auditCreateAction/);
  assert.match(renderer, /window\.electronAPI\.auditOpenPdf/);
  assert.match(renderer, /window\.electronAPI\.auditReanalyzeDocument/);
  assert.match(renderer, /reviewerLabel: reviewer\.value\.trim\(\)/);
});

test('bulk and individual results both persist into the same SQLite case store', () => {
  assert.match(bulk, /await auditStore\.saveDocument\(auditProject\.id, pdfPath/);
  assert.match(main, /await workspace\.saveDocument\(individualProject\.id, requestedPath/);
  assert.match(main, /store: await getWorkspace\(\)/);
  assert.match(main, /await workspace\.saveDocument\(record\.project_id, source, result/);
  assert.match(main, /ipcMain\.handle\('audit-review-document'/);
  assert.match(preload, /auditGetDocument: id => ipcRenderer\.invoke/);
});

test('privacy warnings and backup/export confirmations are not bypassed', () => {
  assert.match(main, /message: 'Export filenames and review results\?'/);
  assert.match(main, /message: 'Create a sensitive audit database backup\?'/);
  assert.match(main, /ipcMain\.handle\('audit-export-record-excel'/);
  assert.match(main, /message: 'Export detailed record findings\?'/);
  assert.match(preload, /auditExportRecordExcel/);
  assert.match(main, /dialog\.showMessageBox/);
  assert.match(html, /may include filenames, detailed scan findings and patient identifiers/);
  assert.match(html, /Audit Projects &amp; Review Queue/);
});
