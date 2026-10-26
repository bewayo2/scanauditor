'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

test('bulk review case shows actionable summary above corrective actions and technical report', () => {
  const start = html.indexOf('id="audit-record-detail"');
  const priority = html.indexOf('id="audit-record-priority"', start);
  const actions = html.indexOf('class="audit-detail-actions"', start);
  const report = html.indexOf('id="audit-record-content"', start);
  assert.ok(start >= 0 && priority > start);
  assert.ok(report > priority);
  assert.ok(actions > report);
  assert.match(renderer, /byId\('audit-record-priority'\)\.replaceChildren\(createActionableSummary\(analysis\)\)/);
  assert.match(renderer, /createResultCard\(\{ analysis \}, \{ priorityShownSeparately: true \}\)/);
});

test('summary shows only material findings as review actions and groups longer details', () => {
  assert.match(renderer, /const findings = Array\.isArray\(qa\.findings\) \? qa\.findings : \[\]/);
  assert.match(renderer, /No material scanning defect detected by automated QA/);
  assert.match(renderer, /categories \+ ' informational observation type/);
  assert.match(renderer, /policyReclassified/);
  assert.match(renderer, /const full = el\('details', 'full-analysis-details'\)/);
  assert.match(renderer, /const optional = el\('details', 'optional-human-review'\)/);
  assert.match(renderer, /full\.appendChild\(inner\)/);
  assert.match(renderer, /createReviewFeedback\(analysis\)/);
  assert.match(renderer, /findingLabel\(finding\.code/);
  assert.match(css, /\.priority-review-panel\.priority-clear/);
  assert.match(css, /\.full-analysis-details > summary/);
  assert.match(main, /evidenceReport\(\{ analysis: record\.analysis \}\)/);
});


test('identity mismatches appear at top, separate from material scan defects, with protected identifiers', () => {
  assert.match(html, /value="attention" selected/);
  assert.match(html, /value="association-review"/);
  assert.match(html, /id="audit-identity-task"/);
  assert.match(html, /id="bulk-identity-review"/);
  assert.match(renderer, /association\.status === 'needs-review'/);
  assert.match(renderer, /Document preparation \/ patient association: possible wrong-patient record/);
  assert.match(renderer, /Scan quality passed\. Record identity/);
  assert.match(renderer, /createMaskedFinding\('Expected folder registration'/);
  assert.match(renderer, /createMaskedFinding\('Observed registration'/);
  assert.match(renderer, /auditAction\('investigation'\)/);
  assert.match(renderer, /folder-mismatch-confirmed/);
  assert.match(renderer, /identity-ocr-false-positive/);
  assert.match(renderer, /summary\.association_review/);
  assert.match(renderer, /item\.overall_audit_status === 'review-required'/);
});


test('overall audit status is central, with preparation findings in the same review table', () => {
  assert.match(html, />Overall audit<\/th>/);
  assert.match(html, />Key audit findings \(scan \/ preparation\)<\/th>/);
  assert.match(renderer, /Overall audit: REVIEW REQUIRED/);
  assert.match(renderer, /item\.overall_audit_status === 'review-required'/);
  assert.match(renderer, /summary\.overall_review_required/);
  assert.match(renderer, /item\.finding_codes/);
  assert.match(renderer, /summary\.association_review/);
});
