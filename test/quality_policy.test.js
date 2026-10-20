'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { qualityFindings } = require('../quality_policy');
const ScanFidelityAnalyzer = require('../scan_fidelity_analyzer');

function images() {
  return {
    complete: true, failedBatches: [],
    blurryPages: [1, 3, 4], lightPages: [1],
    unreadablePages: [1], upsideDownPages: [1],
    darkPages: [], cutoffPages: [], incompletePages: [],
    sidewaysPages: [], misalignedPages: [],
    exactDuplicateGroups: [], possibleDuplicateGroups: [], visionDuplicateGroups: [],
    qualityEvidence: [
      { pageNumber: 1, type: 'unreadable', confidence: 'low', region: 'top', reason: 'original-handwriting', materialLoss: false },
      { pageNumber: 1, type: 'blurry', confidence: 'medium', region: 'whole-page', reason: 'original-handwriting', materialLoss: false },
      { pageNumber: 1, type: 'light', confidence: 'medium', region: 'whole-page', reason: 'faint-original', materialLoss: false },
      { pageNumber: 1, type: 'upsideDown', confidence: 'low', region: 'unknown', reason: 'other', materialLoss: false }
    ]
  };
}

test('reviewed four-page form image observations are informational without material loss evidence', () => {
  const q = qualityFindings(images());
  assert.equal(q.review.length, 0);
  assert.ok(q.informational.length >= 6);
});

test('uncertain handwriting and unsupported blur do not automatically cause QA review', () => {
  const analyzer = new ScanFidelityAnalyzer();
  const contexts = Array.from({ length: 4 }, (_, i) => ({
    pageNumber: i + 1, success: true,
    patientIdentifiers: { names: [], hospitalNumbers: [] }, dates: [],
    uncertainFindings: i === 0 || i === 3
      ? [{ type: 'patient-name', confidence: 'medium', value: 'unreadable handwritten name' }] : []
  }));
  const combined = analyzer.combinePageAnalyses(contexts, 4);
  combined.pageLinkage = {
    documentStartPages: [1], identifiedPages: [], continuationPages: [2,3,4],
    unresolvedPages: [], failedPages: [], resolvedPages: 4
  };
  const qa = analyzer.evaluateQa(combined, images(), { complete: true, pages: [] });
  assert.equal(qa.status, 'passed');
  assert.equal(qa.findings.length, 0);
  assert.ok(qa.informationalFindings.some(f => f.code === 'UNCERTAIN_IDENTIFIER'));
  assert.ok(qa.informationalFindings.some(f => f.code === 'BLURRY_PAGE'));
  assert.equal(analyzer.createSummaryTable(qa).length, 0);
});

test('real suspected clipping remains review-worthy with localized material-loss evidence', () => {
  const photo = images();
  photo.cutoffPages = [2];
  photo.qualityEvidence.push({
    pageNumber: 2, type: 'cutoff', confidence: 'high',
    region: 'right', reason: 'clipped-content', materialLoss: true
  });
  const q = qualityFindings(photo);
  assert.ok(q.review.some(f => f.code === 'POSSIBLE_CUTOFF' && f.pages.includes(2)));
});

test('undocumented subjective flags never become a severe scanning defect automatically in cloud mode', () => {
  const photo = images();
  photo.unreadablePages = [1];
  photo.qualityEvidence = [];
  const q = qualityFindings(photo);
  assert.equal(q.review.length, 0);
});

test('legacy local-model cutoff still triggers review; mild blur only informs', () => {
  const photo = images();
  delete photo.qualityEvidence;
  photo.cutoffPages = [2];
  const q = qualityFindings(photo);
  assert.ok(q.review.some(f => f.code === 'POSSIBLE_CUTOFF'));
  assert.ok(q.informational.some(f => f.code === 'BLURRY_PAGE'));
});
