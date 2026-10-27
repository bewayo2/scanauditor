'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ScanFidelityAnalyzer = require('../scan_fidelity_analyzer');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
const bulk = fs.readFileSync(path.join(__dirname, '..', 'bulk_audit.js'), 'utf8');

test('review case offers optional recommendations in one labeled location', () => {
  const details = html.indexOf('id="audit-record-detail"');
  const start = html.indexOf('id="audit-recommendations"', details);
  const end = html.indexOf('</details>', start);
  const section = html.slice(start, end);
  assert.ok(details >= 0 && start > details && end > start);
  assert.match(section, /Recommendations \(optional\)/);
  for (const id of ['audit-paper-task', 'audit-rescan-task', 'audit-identity-task']) {
    assert.match(section, new RegExp('id="' + id + '"'));
    assert.equal((html.match(new RegExp('id="' + id + '"', 'g')) || []).length, 1);
  }
  assert.match(section, /without recommending any corrective action/);
  assert.match(renderer, /byId\('audit-recommendations'\)\.open = false/);
  assert.match(renderer, /byId\('audit-recommendation-guidance'\)\.textContent = guidance/);
});

test('one indexed workspace owns manual decisions and advanced tools are collapsed', () => {
  assert.match(html, /<details class="workflow-settings">/);
  assert.match(html, /<details class="admin-tools cost-tools">/);
  assert.match(html, /<summary>Reports, backup and administration<\/summary>/);
  assert.match(html, /<summary>Case reports and advanced actions<\/summary>/);
  assert.match(html, /<summary>Export recently analyzed files \(optional\)<\/summary>/);
  assert.match(html, /id="cloud-spending-limit" hidden/);
  assert.doesNotMatch(html, /id="bulk-review-queue"/);
  assert.match(renderer, /All findings and human decisions live in the indexed Review Queue/);
  assert.match(renderer, /await refreshAuditProjects\(response\?\.projectId\)/);
  assert.match(renderer, /const reviewer = analysis\.workspaceDocumentId \? byId\('audit-action-reviewer'\)/);
  assert.match(html, /Open Scanned PDF/);
});

test('page progress is relayed from analyzer to each workflow without PHI', () => {
  const events = [];
  const analyzer = new ScanFidelityAnalyzer({ onProgress: value => events.push(value) });
  analyzer.reportProgress('preparing-pages', 300);
  analyzer.reportProgress('reading-page', 300, 149);
  analyzer.reportProgress('reading-pages', 300, 150);
  analyzer.reportProgress('checking-quality', 300, 200);
  assert.deepEqual(events[2], { stage: 'reading-pages', totalPages: 300, completedPages: 150 });
  assert.equal(events[2].fileName, undefined);
  assert.equal(events[2].path, undefined);
  assert.ok(renderer.includes('PDF '));
  for (const id of ['bulk-page-progress-bar', 'individual-progress-bar',
    'loading-progress-bar', 'reanalyze-progress-bar']) {
    assert.ok(html.includes('id="' + id + '"'), id);
  }
  assert.match(main, /mainWindow\.webContents\.send\('scan-progress'/);
  assert.match(preload, /onScanProgress: callback =>/);
  assert.match(renderer, /window\.electronAPI\.onScanProgress\(renderScanProgress\)/);
  assert.match(bulk, /analyzer\.onProgress = progress =>/);
  assert.match(renderer, /Checking image quality:/);
});

test('progress reporting cannot interrupt the analysis', () => {
  const analyzer = new ScanFidelityAnalyzer({
    onProgress: () => { throw new Error('Disconnected renderer'); }
  });
  assert.doesNotThrow(() => analyzer.reportProgress('reading-pages', 300, 21));
});

test('PDF page-image conversion reports completed pages before OCR begins', () => {
  const converter = fs.readFileSync(path.join(__dirname, '..', 'pdf_to_images.py'), 'utf8');
  const engine = fs.readFileSync(path.join(__dirname, '..', 'comprehensive_analyzer.js'), 'utf8');
  assert.match(converter, /SCAN_PROGRESS:/);
  assert.match(converter, /sys\.stderr\.flush\(\)/);
  assert.match(engine, /progressBuffer\.indexOf/);
  assert.match(engine, /this\.reportProgress\('converting-pages'/);
  assert.match(renderer, /case 'converting-pages'/);
});

test('HTML controls have unique IDs and balanced named sections', () => {
  const ids = [...html.matchAll(/\\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, new Set(ids).size);
  const tags = ['section', 'details', 'div', 'main', 'header'];
  for (const tag of tags) {
    const opened = (html.match(new RegExp('<' + tag + '(?:\\s|>)', 'g')) || []).length;
    const closed = (html.match(new RegExp('</' + tag + '>', 'g')) || []).length;
    assert.equal(opened, closed, tag + ' tags must balance');
  }
});
