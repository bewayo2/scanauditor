'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const js = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
const { findingLabel } = require('../finding_labels');

function luminance(hex) {
  const parts = hex.match(/[\da-f]{2}/gi).map(v => parseInt(v, 16) / 255);
  const [r, g, b] = parts.map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}
function contrast(a, b) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}

test('main background and buttons have WCAG AA normal-text contrast with white', () => {
  for (const background of ['#4c398e', '#493474', '#166534', '#15803d']) {
    assert.ok(contrast(background, '#ffffff') >= 4.5,
      background + ' should be at least 4.5:1 against white');
    assert.ok(css.includes(background));
  }
  assert.match(css, /\.file-section > \.cost-planning label/);
  assert.match(css, /\.audit-workspace \.audit-queue-toolbar label/);
  assert.match(css, /\.file-section > \.small-note/);
  assert.match(css, /\.file-section > \.approval-line/);
  assert.match(css, /\.audit-workspace > \.audit-filter-help/);
  assert.match(css, /\.provider-section \.section-header h2/);
});

test('technical finding-code textbox is replaced with accessible problem choices', () => {
  assert.match(html, /<label for="audit-finding">Type of problem<\/label>/);
  assert.match(html, /<select id="audit-finding" aria-describedby="audit-issue-help">/);
  assert.match(html, /All problem types/);
  assert.doesNotMatch(html, /Finding code<\/label>/);
  assert.match(html, /<script src="finding_labels\.js"><\/script>\s*<script src="renderer\.js"><\/script>/);
  assert.match(js, /auditListFindingTypes\(projectId\)/);
  assert.match(js, /findingLabel\(item\.code\)/);
  assert.match(js, /findingLabel\(code\.trim\(\)\)/);
});

test('known scan issues are understandable and unknown codes cannot inject content', () => {
  assert.equal(findingLabel('POSSIBLE_CUTOFF'), 'Possibly cropped or cut-off content');
  assert.equal(findingLabel('UNREADABLE_PAGE'), 'Unreadable page');
  assert.equal(findingLabel('PRINTED_PAGE_SEQUENCE_GAP'), 'Possible missing numbered page');
  assert.equal(findingLabel('CUT_OFF_TEXT'), 'Cut-off text');
  assert.equal(findingLabel('SYNTHETIC_RARE_ISSUE'), 'Synthetic rare issue');
  assert.equal(findingLabel('<script>'), 'Other scan quality issue');
});
