const test = require('node:test');
const assert = require('node:assert/strict');
const ComprehensiveAnalyzer = require('../comprehensive_analyzer');

function page(pageNumber, names = [], hospitalNumbers = [], dates = []) {
  return {
    pageNumber,
    success: true,
    failureReason: null,
    patientIdentifiers: { names, hospitalNumbers },
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
    duplicateGroups: []
  };
}

test('shared surname does not merge different patients', () => {
  const analyzer = new ComprehensiveAnalyzer();
  assert.equal(analyzer.namesLikelySame('John Smith', 'Mary Smith'), false);
  assert.equal(analyzer.namesLikelySame('John Smith', 'John A. Smith'), true);
  assert.equal(analyzer.namesLikelySame('Hubert Gerard', 'Gerard Hubert'), true);
});

test('hospital numbers differing by one digit remain distinct', () => {
  const analyzer = new ComprehensiveAnalyzer();
  const result = analyzer.combinePageAnalyses([
    page(1, ['John Smith'], ['123456']),
    page(2, ['John Smith'], ['123457'])
  ], 2);

  assert.deepEqual(result.patientIdentifiers.hospitalNumbers.sort(), ['123456', '123457']);
  assert.equal(result.multiplePatients.detected, true);
});

test('failed OCR pages reduce coverage and make analysis incomplete', () => {
  const analyzer = new ComprehensiveAnalyzer();
  const result = analyzer.combinePageAnalyses([
    analyzer.failedPage(1, 'ocr-empty'),
    analyzer.failedPage(2, 'ocr-empty')
  ], 2);

  assert.equal(result.identifierCoverage.coveragePercentage, 0);
  assert.equal(result.identifierCoverage.complete, false);
  assert.deepEqual(result.failedPages, [1, 2]);
  assert.equal(analyzer.evaluateSafety(result, cleanImages()).safetyAssessment.safeForUse, false);
});

test('coverage is calculated against the full document', () => {
  const analyzer = new ComprehensiveAnalyzer();
  const result = analyzer.combinePageAnalyses([
    page(1, ['John Smith'], ['123456']),
    page(2, [], []),
    page(3, [], []),
    page(4, [], [])
  ], 4);

  assert.equal(result.identifierCoverage.coveragePercentage, 25);
  assert.equal(analyzer.evaluateSafety(result, cleanImages()).safetyAssessment.safeForUse, false);
});

test('critical image problems override otherwise good identifiers', () => {
  const analyzer = new ComprehensiveAnalyzer();
  const text = analyzer.combinePageAnalyses([
    page(1, ['John Smith'], ['123456']),
    page(2, ['John Smith'], ['123456'])
  ], 2);
  const images = cleanImages();
  images.unreadablePages = [2];

  const decision = analyzer.evaluateSafety(text, images);
  assert.equal(decision.safetyAssessment.safeForUse, false);
  assert.match(decision.safetyAssessment.reason, /Critical image\/content problems/);
});

test('complete, consistent document can pass deterministic safety checks', () => {
  const analyzer = new ComprehensiveAnalyzer();
  const text = analyzer.combinePageAnalyses([
    page(1, ['John Smith'], ['123456']),
    page(2, ['John A Smith'], ['123456'])
  ], 2);

  const decision = analyzer.evaluateSafety(text, cleanImages());
  assert.equal(text.multiplePatients.detected, false);
  assert.equal(text.identifierCoverage.coveragePercentage, 100);
  assert.equal(decision.safetyAssessment.safeForUse, true);
});
