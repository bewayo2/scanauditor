'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ScanFidelityAnalyzer = require('../scan_fidelity_analyzer');

function cleanImages() {
  return {
    complete: true, failedBatches: [],
    blurryPages: [], lightPages: [], darkPages: [],
    unreadablePages: [], cutoffPages: [], incompletePages: [],
    upsideDownPages: [], sidewaysPages: [], misalignedPages: [],
    exactDuplicateGroups: [], possibleDuplicateGroups: [], visionDuplicateGroups: [],
    qualityEvidence: []
  };
}
function textWithContextOnly() {
  return {
    identifierCoverage: {
      complete: true, totalPages: 11, pagesProcessedSuccessfully: 11,
      pagesWithIdentifiers: 5, pagesWithoutIdentifiers: 6, pagesFailed: 0,
      coveragePercentage: 5 / 11 * 100
    },
    failedPages: [],
    pageLinkage: {
      documentStartPages: [], continuationPages: [2, 3, 4, 6], unresolvedPages: [9, 11]
    },
    uncertainFindings: [{ page: 1, reason: 'handwriting unclear' }],
    multiplePatients: { detected: true, pages: [1] },
    dateIssues: { mismatches: [] }
  };
}

test('11-page, two-visit record with clear images is not flagged only for OCR names or unnumbered pages', () => {
  const analyzer = new ScanFidelityAnalyzer();
  const completeness = {
    status: 'numbered-sections-consistent', issues: [], observations: [],
    numberedPages: 6, pdfPages: 11, unnumberedPages: [7, 8, 9, 10, 11],
    sequenceGroups: [
      { firstPdfPage: 1, lastPdfPage: 4, sequenceFirst: 1, sequenceLast: 4, declaredTotal: 4, internallyComplete: true },
      { firstPdfPage: 5, lastPdfPage: 6, sequenceFirst: 1, sequenceLast: 2, declaredTotal: 2, internallyComplete: true }
    ]
  };
  const preservation = {
    status: 'observations-available', issues: [],
    observations: [{ code: 'PARTIALLY_UNCERTAIN_CONTENT', pages: [1, 2, 3, 4, 5, 6, 7, 8, 10] }]
  };
  const qa = analyzer.evaluateQa(textWithContextOnly(), cleanImages(),
    { complete: true, pages: [] }, completeness, preservation);
  assert.equal(qa.status, 'passed');
  assert.deepEqual(qa.findings, []);
  assert.ok(qa.informationalFindings.some(f =>
    f.code === 'UNRESOLVED_PAGE' && f.pages.join(',') === '9,11'));
  assert.ok(qa.informationalFindings.some(f => f.code === 'MULTIPLE_PATIENT_IDENTIFIERS'));
  assert.deepEqual(qa.recommendations.manualReview, []);
  assert.deepEqual(qa.recommendations.compareWithSource, []);
  assert.match(qa.reason, /No material scan-fidelity defect/);
});

test('identical or similar pages without proven content loss are informational only', () => {
  const analyzer = new ScanFidelityAnalyzer();
  const images = cleanImages();
  images.exactDuplicateGroups = [[2, 4]];
  images.possibleDuplicateGroups = [[7, 8]];
  const qa = analyzer.evaluateQa(textWithContextOnly(), images, { complete: true, pages: [] });
  assert.equal(qa.status, 'passed');
  assert.ok(qa.informationalFindings.some(f => f.code === 'EXACT_DUPLICATE'));
  assert.ok(qa.informationalFindings.some(f => f.code === 'POSSIBLE_DUPLICATE'));
  assert.deepEqual(qa.findings, []);
});

test('localized material cropping still requires review despite benign OCR and continuation uncertainty', () => {
  const analyzer = new ScanFidelityAnalyzer();
  const images = cleanImages();
  images.cutoffPages = [4];
  images.qualityEvidence = [{
    pageNumber: 4, type: 'cutoff', region: 'right',
    reason: 'clipped-content', materialLoss: true, confidence: 'high'
  }];
  const qa = analyzer.evaluateQa(textWithContextOnly(), images, { complete: true, pages: [] });
  assert.equal(qa.status, 'review-required');
  assert.deepEqual(qa.findings.map(f => f.code), ['POSSIBLE_CUTOFF']);
  assert.ok(qa.informationalFindings.some(f => f.code === 'UNRESOLVED_PAGE'));
  assert.ok(qa.recommendations.compareWithSource.some(f => f.includes('4')));
});
