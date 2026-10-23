'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
const start = html.indexOf('id="bulk-heading"');
const end = html.indexOf('<section class="results-section"', start);
const area = html.slice(start, end);

test('folder UI provides selected path, preview total, actual pages and status/progress bar', () => {
  for (const id of ['bulk-folder-label', 'bulk-files-total', 'bulk-pages-expected',
    'bulk-pages-done', 'bulk-phase', 'bulk-current', 'bulk-progress-percentage',
    'bulk-progress-bar', 'bulk-estimate-note', 'bulk-processed', 'bulk-skipped']) {
    assert.ok(area.includes('id="' + id + '"'), id);
  }
  assert.match(area, /Anticipated pages in folder/);
  assert.match(area, /Pages actually processed this session/);
  assert.match(area, /Selected folder/);
  assert.match(area, /<progress [^>]*aria-label=/);
});

test('path is displayed locally and not written into checkpoint or progress IPC', () => {
  assert.match(main, /return \{ selected: true, path: selectedBulkRoot \}/);
  assert.match(renderer, /byId\('bulk-folder-label'\)\.textContent = result\.path/);
  assert.match(preload, /inspectBulkFolder: \(\) => ipcRenderer\.invoke\('inspect-bulk-folder'\)/);
  assert.match(main, /ipcMain\.handle\('inspect-bulk-folder'/);
  assert.match(renderer, /window\.electronAPI\.onBulkProgress\(renderBulkProgress\)/);
});

test('each batch stage is displayed distinctly without exposing filenames', () => {
  for (const stage of ['inventory', 'sampling', 'ready', 'processing', 'running',
    'stopped', 'completed', 'canceled']) {
    assert.ok(renderer.includes(stage), stage);
  }
  assert.match(renderer, /meter\.removeAttribute\('value'\)/);
  assert.match(renderer, /meter\.value = fraction/);
  assert.match(renderer, /currentFileNumber/);
  assert.match(renderer, /sampledFiles/);
  assert.match(renderer, /estimateKind/);
});
