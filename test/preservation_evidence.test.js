'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeInternalCompleteness } = require('../document_completeness');
const { inspectContentPreservation } = require('../content_preservation');
const { evidenceReport } = require('../evidence_report');
const ScanFidelityAnalyzer = require('../scan_fidelity_analyzer');

const contexts = labels => labels.map((label, i) => ({
  pageNumber: i + 1, ocrText: label,
  analysis: { success: true, patientIdentifiers: { names: [], hospitalNumbers: [] } }
}));
const labels = (...nums) => nums.map(([current, total]) => 'Emergency form Page ' + current + ' of ' + total);

test('full 4-page numbering is internally consistent but not paper-verified', () => {
  const r = analyzeInternalCompleteness(contexts(labels([1,4],[2,4],[3,4],[4,4])), 4);
  assert.equal(r.status, 'internally-consistent');
  assert.equal(r.paperCompletenessVerified, false);
  assert.equal(r.issues.length, 0);
});
test('1/4 2/4 4/4 detects a missing printed page number', () => {
  const r = analyzeInternalCompleteness(contexts(labels([1,4],[2,4],[4,4])), 3);
  assert.equal(r.status, 'potential-gap');
  assert.deepEqual(r.issues.find(x => x.code === 'PRINTED_PAGE_SEQUENCE_GAP').missingSequencePages, [3]);
});
test('1/4 2/4 3/4 warns about possible trailing page loss', () => {
  const r = analyzeInternalCompleteness(contexts(labels([1,4],[2,4],[3,4])), 3);
  assert.deepEqual(r.issues.find(x => x.code === 'POSSIBLE_TRAILING_PAGES').missingSequencePages, [4]);
});
test('two numbered documents in a PDF can reset sequence without a false gap', () => {
  const r = analyzeInternalCompleteness(contexts(labels([1,2],[2,2],[1,2],[2,2])), 4);
  assert.deepEqual(r.issues, []);
  assert.equal(r.paperCompletenessVerified, false);
  assert.equal(r.sequenceGroups.length, 2);
});
test('a PDF without explicit pagination is not described as complete', () => {
  const r = analyzeInternalCompleteness(contexts(['Clinical note', 'Medical form']), 2);
  assert.equal(r.status, 'not-establishable');
  assert.deepEqual(r.issues, []);
});
test('isolated page 2 of 4 does not prove source pages missing', () => {
  const r = analyzeInternalCompleteness(contexts(['Page 2 of 4']), 1);
  assert.equal(r.status, 'not-establishable');
  assert.deepEqual(r.issues, []);
});
const features = {
  printedText: 'legible', handwriting: 'uncertain', signatures: 'not-observed',
  stamps: 'not-observed', marginalNotes: 'not-observed', documentEdges: 'visible'
};
test('difficult handwriting is informative, not proof of lost stamps', () => {
  const r = inspectContentPreservation(contexts(['Hospital record Page 1 of 1']), {
    contentAssessments: [{ pageNumber: 1, ...features }]
  }, { pages: [{ pageNumber: 1, whitePixelRatio: 0.7, edgeVariance: 400 }] });
  assert.equal(r.status, 'observations-available');
  assert.equal(r.paperContentVerified, false);
  assert.deepEqual(r.issues, []);
  assert.ok(r.observations.some(x => x.code === 'PARTIALLY_UNCERTAIN_CONTENT'));
});
test('unexpectedly near-white page requires verification', () => {
  const r = inspectContentPreservation(contexts(['']), {}, {
    pages: [{ pageNumber: 1, whitePixelRatio: 0.999, edgeVariance: 0 }]
  });
  assert.deepEqual(r.issues.map(x => x.code), ['POSSIBLY_BLANK_PAGE']);
});
test('intentionally blank page is not a suspected omission', () => {
  const r = inspectContentPreservation(contexts(['Intentionally blank']), {}, {
    pages: [{ pageNumber: 1, whitePixelRatio: 0.999, edgeVariance: 0 }]
  });
  assert.deepEqual(r.issues, []);
});
test('potentially clipped signature remains an observation until corroborated', () => {
  const r = inspectContentPreservation(contexts(['Medical form']), {
    contentAssessments: [{ pageNumber: 1, ...features, signatures: 'potentially-clipped',
      documentEdges: 'possible-clipping' }]
  }, { pages: [] });
  assert.equal(r.paperContentVerified, false);
  assert.ok(r.observations.some(x => x.code === 'CONTENT_AT_RISK'));
  assert.deepEqual(r.issues, []);
});

test('evidenced page sequence gap forces review despite an otherwise clean scan', () => {
  const analyzer = new ScanFidelityAnalyzer();
  const text = analyzer.combinePageAnalyses(contexts(labels([1,4],[2,4],[4,4])).map(p => ({
    pageNumber: p.pageNumber, success: true, patientIdentifiers: { names: [], hospitalNumbers: [] },
    dates: [], uncertainFindings: []
  })), 3);
  text.pageLinkage = { unresolvedPages: [], identifiedPages: [1], continuationPages: [2,3], failedPages: [] };
  const images = { complete: true, failedBatches: [], blurryPages: [], darkPages: [], lightPages: [],
    unreadablePages: [], cutoffPages: [], incompletePages: [], upsideDownPages: [], sidewaysPages: [],
    misalignedPages: [], exactDuplicateGroups: [], possibleDuplicateGroups: [], visionDuplicateGroups: [] };
  const completeness = analyzeInternalCompleteness(contexts(labels([1,4],[2,4],[4,4])), 3);
  const qa = analyzer.evaluateQa(text, images, { complete: true, pages: [] }, completeness);
  assert.equal(qa.status, 'review-required');
  assert.ok(qa.findings.some(f => f.code === 'PRINTED_PAGE_SEQUENCE_GAP'));
});

test('evidence digest is stable and patient identifiers are excluded', () => {
  const input = {
    filename: 'Alice_123456.pdf',
    analysis: {
      fileInformation: { fileName: 'Alice_123456.pdf', totalPages: 1 },
      patientIdentifiers: { names: ['Alice Secret'], hospitalNumbers: ['123456'] },
      analysisMetadata: {
        fileSha256: 'a'.repeat(64), analysisDate: '2026-10-22T12:00:00Z',
        appVersion: '1.0.0', models: { ocr: 'vision-model' }, dpi: 300
      },
      qaAssessment: { status: 'passed', findings: [], informationalFindings: [] },
      internalCompleteness: analyzeInternalCompleteness(contexts(['Page 1 of 1']), 1),
      contentPreservation: inspectContentPreservation(contexts(['Page 1 of 1']), {}, { pages: [] })
    }
  };
  const a = evidenceReport(input), b = evidenceReport(input);
  assert.equal(a.evidenceSha256, b.evidenceSha256);
  assert.equal(a.inputSha256, 'a'.repeat(64));
  assert.equal(a.internalCompleteness.paperCompletenessVerified, false);
  const serialized = JSON.stringify(a);
  for (const forbidden of ['Alice', '123456', 'fileName', 'ocrText']) {
    assert.equal(serialized.includes(forbidden), false);
  }
});
