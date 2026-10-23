'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
const start = html.indexOf('<section class="cost-section"');
const end = html.indexOf('<section class="file-section"', start);
const section = html.slice(start, end);

test('page-first cost screen exposes one page target and hides advanced controls by default', () => {
  const advanced = section.indexOf('<details class="cost-advanced"');
  const firstPageInput = section.indexOf('id="forecast-target-pages"');
  const action = section.indexOf('id="save-cost-plan"');
  const estimate = section.indexOf('id="cost-page-estimate"');
  assert.ok(start >= 0 && end > start);
  assert.ok(firstPageInput > 0 && firstPageInput < advanced);
  assert.ok(action > firstPageInput && action < advanced);
  assert.ok(estimate > action && estimate < advanced);
  assert.match(section.slice(0, advanced), /How many pages do you need to process\?/);
  assert.match(section.slice(0, advanced), /Estimated total API cost/);
  assert.equal((section.slice(0, advanced).match(/<input\b/g) || []).length, 1);
  assert.ok(!section.includes('id="forecast-target-files"'));
  assert.ok(!section.includes('id="cost-file-estimate"'));
  for (const id of ['forecast-basis', 'forecast-selected-run',
    'planning-input-tokens', 'planning-output-tokens', 'fallback-percent']) {
    assert.ok(section.indexOf('id="' + id + '"') > advanced, id + ' should only be in Advanced Options');
  }
});

test('cost reset requires two disclosures and retains the existing server confirmation', () => {
  const advanced = section.indexOf('<details class="cost-advanced"');
  const resetDisclosure = section.indexOf('<details class="cost-reset-area"');
  const resetButton = section.indexOf('id="reset-cost-history"');
  assert.ok(resetDisclosure > advanced);
  assert.ok(resetButton > resetDisclosure);
  assert.match(section.slice(resetDisclosure, resetButton), /permanently deletes/);
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /ipcMain\.handle\('reset-cost-history'/);
  assert.match(main, /dialog\.showMessageBox/);
});

test('primary cost forecast only depends on observed or assumed page rate', () => {
  assert.match(script, /dashboard\.targetProjectionUSD/);
  assert.match(script, /dashboard\.targetForecastPerPageUSD/);
  assert.match(script, /dashboard\.targetPages/);
  assert.match(script, /dashboard\.historicalMeteredPages/);
  assert.match(script, /dashboard\.forecastFileSample/);
  assert.match(script, /syncCostRunSelector/);
  assert.match(script, /byId\('cost-page-estimate'\)/);
  assert.doesNotMatch(script, /dashboard\.targetFilesProjectionUSD/);
  assert.doesNotMatch(script, /dashboard\.targetForecastPerFileUSD/);
  assert.match(script, /plan\.targetFiles = null/);
});

test('cost UI element IDs are unique', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
});
