'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ScanFidelityAnalyzer = require('../scan_fidelity_analyzer');

function page(pageNumber, names = [], hospitalNumbers = [], dates = [], uncertainFindings = []) {
  return {
    pageNumber,
    success: true,
    failureReason: null,
    patientIdentifiers: { names, hospitalNumbers },
    identifierCandidates: { names: [], hospitalNumbers: [] },
    uncertainFindings,
    dates,
    warnings: []
  };
}

function cleanImages() {
  return {
    complete: true,
    failedBatches: [],
    blurryPages: [],
    darkPages: [],
    lightPages: [],
    unreadablePages: [],
    cutoffPages: [],
    incompletePages: [],
    upsideDownPages: [],
    sidewaysPages: [],
    misalignedPages: [],
    visionDuplicateGroups: [],
    exactDuplicateGroups: [],
    possibleDuplicateGroups: []
  };
}

function cleanMetrics() {
  return { complete: true, pages: [] };
}

function attachLinkage(text, values) {
  text.pageLinkage = {
    totalPages: text.identifierCoverage.totalPages,
    identifiedPages: values.identifiedPages || [],
    continuationPages: values.continuationPages || [],
    unresolvedPages: values.unresolvedPages || [],
    failedPages: values.failedPages || [],
    resolvedPages: (values.identifiedPages || []).length + (values.continuationPages || []).length,
    resolvedPercentage: 100
  };
  return text;
}

test('50 percent identifier coverage can pass when remaining pages are resolved continuations', () => {
  const analyzer = new ScanFidelityAnalyzer();
  const text = analyzer.combinePageAnalyses([
    page(1, ['John Smith'], ['123456']),
    page(2, ['John Smith'], ['123456']),
    page(3),
    page(4)
  ], 4);
  attachLinkage(text, { identifiedPages: [1, 2], continuationPages: [3, 4] });
  assert.equal(text.identifierCoverage.coveragePercentage, 50);
  assert.equal(analyzer.evaluateQa(text, cleanImages(), cleanMetrics()).status, 'passed');
});

test('unresolved unidentified page requires review', () => {
  const analyzer = new ScanFidelityAnalyzer();
  const text = analyzer.combinePageAnalyses([page(1, ['John Smith'], ['123456']), page(2)], 2);
  attachLinkage(text, { identifiedPages: [1], unresolvedPages: [2] });
  const qa = analyzer.evaluateQa(text, cleanImages(), cleanMetrics());
  assert.equal(qa.status, 'review-required');
  assert.ok(qa.findings.some(item => item.code === 'UNRESOLVED_PAGE'));
});

test('medium-confidence hospital number is informational unless there is separate scan-fidelity evidence', () => {
  const analyzer = new ScanFidelityAnalyzer();
  const result = analyzer.cleanHospitalNumberCandidates([{ value: '123456', confidence: 'medium', evidence: 'one digit unclear' }]);
  assert.equal(result[0].formatValid, true);
  const text = analyzer.combinePageAnalyses([
    page(1, [], [], [], [{ type: 'hospital-number', value: '123456', confidence: 'medium', formatValid: true }])
  ], 1);
  attachLinkage(text, { identifiedPages: [1] });
  const qa = analyzer.evaluateQa(text, cleanImages(), cleanMetrics());
  assert.equal(qa.status, 'passed');
  assert.ok(!qa.findings.some(item => item.code === 'UNCERTAIN_IDENTIFIER'));
  assert.ok(qa.informationalFindings.some(item => item.code === 'UNCERTAIN_IDENTIFIER'));
});

test('high-confidence organization hospital number is valid', () => {
  const analyzer = new ScanFidelityAnalyzer();
  const result = analyzer.cleanHospitalNumberCandidates([{ value: '123456', confidence: 'high', evidence: 'beside Hospital Number label' }]);
  assert.deepEqual(result, [{ value: '123456', confidence: 'high', evidence: 'beside Hospital Number label', formatValid: true }]);
});

test('different encounters on different pages do not create a false discharge-before-admission anomaly', () => {
  const analyzer = new ScanFidelityAnalyzer();
  const high = (label, normalizedDate) => ({ label, value: normalizedDate, normalizedDate, confidence: 'high', evidence: '' });
  const issues = analyzer.evaluateDateIssues([
    page(1, ['John Smith'], ['123456'], [high('Admission Date', '2025-01-01'), high('Discharge Date', '2025-01-05')]),
    page(2, ['John Smith'], ['123456'], [high('Admission Date', '2025-02-01'), high('Discharge Date', '2025-02-05')])
  ]);
  assert.equal(issues.mismatches.length, 0);
});

test('same-page discharge before admission requires review', () => {
  const analyzer = new ScanFidelityAnalyzer();
  const high = (label, normalizedDate) => ({ label, value: normalizedDate, normalizedDate, confidence: 'high', evidence: '' });
  const text = analyzer.combinePageAnalyses([
    page(1, ['John Smith'], ['123456'], [high('Admission Date', '2026-02-10'), high('Discharge Date', '2026-02-05')])
  ], 1);
  attachLinkage(text, { identifiedPages: [1] });
  const qa = analyzer.evaluateQa(text, cleanImages(), cleanMetrics());
  assert.equal(qa.status, 'review-required');
  assert.ok(qa.findings.some(item => item.code === 'DATE_ANOMALY'));
});

test('near duplicate requires both perceptual and OCR similarity', () => {
  const analyzer = new ScanFidelityAnalyzer({
    auditConfig: {
      dpi: 300,
      imageBatchSize: 2,
      nearDuplicateHammingDistance: 4,
      nearDuplicateTextSimilarity: 0.8,
      minimumDuplicateTextCharacters: 20
    }
  });
  const metrics = {
    complete: true,
    pages: [
      { pageNumber: 1, dhash: '0000000000000000' },
      { pageNumber: 2, dhash: '0000000000000001' },
      { pageNumber: 3, dhash: '0000000000000001' }
    ]
  };
  const contexts = [
    { pageNumber: 1, ocrText: 'patient progress note medication dose blood pressure follow up treatment plan' },
    { pageNumber: 2, ocrText: 'patient progress note medication dose blood pressure follow up treatment plan' },
    { pageNumber: 3, ocrText: 'completely different laboratory form specimen chemistry values unrelated content' }
  ];
  assert.deepEqual(analyzer.findPossibleDuplicateGroups(metrics, contexts, []), [[1, 2]]);
});

test('exact duplicate finding requires review', () => {
  const analyzer = new ScanFidelityAnalyzer();
  const text = analyzer.combinePageAnalyses([page(1, ['John Smith'], ['123456']), page(2, ['John Smith'], ['123456'])], 2);
  attachLinkage(text, { identifiedPages: [1, 2] });
  const images = cleanImages();
  images.exactDuplicateGroups = [[1, 2]];
  const qa = analyzer.evaluateQa(text, images, cleanMetrics());
  assert.equal(qa.status, 'review-required');
  assert.ok(qa.findings.some(item => item.code === 'EXACT_DUPLICATE'));
});

test('all OCR failures produce analysis-failed', () => {
  const analyzer = new ScanFidelityAnalyzer();
  const text = analyzer.combinePageAnalyses([analyzer.failedPage(1, 'ocr-empty'), analyzer.failedPage(2, 'ocr-empty')], 2);
  attachLinkage(text, { failedPages: [1, 2] });
  assert.equal(analyzer.evaluateQa(text, cleanImages(), cleanMetrics()).status, 'analysis-failed');
});
