'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ResilientAnalyzer = require('../resilient_analyzer');
const { parseExplicitPageSequence, runWithRetries } = require('../inference_resilience');

function auditConfig(overrides = {}) {
  return {
    dpi: 300,
    imageBatchSize: 2,
    ocrAttempts: 3,
    structuredAttempts: 2,
    continuationAttempts: 2,
    retryDelayMs: 0,
    nearDuplicateHammingDistance: 4,
    nearDuplicateTextSimilarity: 0.92,
    minimumDuplicateTextCharacters: 50,
    ...overrides
  };
}

function page(pageNumber, names = [], hospitalNumbers = []) {
  return {
    pageNumber,
    success: true,
    failureReason: null,
    patientIdentifiers: { names, hospitalNumbers },
    identifierCandidates: { names: [], hospitalNumbers: [] },
    uncertainFindings: [],
    dates: [],
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

test('explicit page sequence parser recognizes Page X of Y', () => {
  assert.deepEqual(parseExplicitPageSequence('Effective March 2015 Page 2 of 4'), { current: 2, total: 4 });
  assert.deepEqual(parseExplicitPageSequence('PG. 3/12'), { current: 3, total: 12 });
  assert.equal(parseExplicitPageSequence('11/08/2017'), null);
});

test('retry helper succeeds after transient failures', async () => {
  let calls = 0;
  const outcome = await runWithRetries({
    attempts: 3,
    delayMs: 0,
    operation: async () => {
      calls += 1;
      if (calls < 3) throw new Error('temporary timeout');
      return 'ok';
    }
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.attemptsUsed, 3);
  assert.equal(calls, 3);
});

test('OCR is retried before a page is marked failed', async () => {
  class RetryOcrAnalyzer extends ResilientAnalyzer {
    constructor() {
      super({ auditConfig: auditConfig() });
      this.calls = 0;
    }

    async performOcrAttempt() {
      this.calls += 1;
      if (this.calls < 3) {
        const error = new Error('request timeout');
        error.code = 'ECONNABORTED';
        throw error;
      }
      return 'Patient Name: Example Person\nPage 1 of 4';
    }

    log() {}
  }

  const analyzer = new RetryOcrAnalyzer();
  const text = await analyzer.extractTextWithOCR('unused.png', 1);
  assert.match(text, /Patient Name/);
  assert.equal(analyzer.calls, 3);
  assert.deepEqual(analyzer.getDiagnostic(1).ocr, {
    status: 'passed',
    attempts: 3,
    characters: text.length
  });
});

test('structured extraction is retried after a failed model response', async () => {
  class RetryStructuredAnalyzer extends ResilientAnalyzer {
    constructor() {
      super({ auditConfig: auditConfig() });
      this.calls = 0;
    }

    async performStructuredPageAnalysis(text, fileName, pageNumber) {
      this.calls += 1;
      if (this.calls === 1) return this.failedPage(pageNumber, 'text-analysis-failed');
      return page(pageNumber, ['Example Person'], []);
    }

    log() {}
  }

  const analyzer = new RetryStructuredAnalyzer();
  const result = await analyzer.analyzeTextPage('Patient Name: Example Person', 'example.pdf', 1);
  assert.equal(result.success, true);
  assert.equal(analyzer.calls, 2);
  assert.deepEqual(analyzer.getDiagnostic(1).structuredExtraction, {
    status: 'passed',
    attempts: 2
  });
});

test('explicit four-page form pagination resolves continuation pages without model calls', async () => {
  class NoContinuationModelAnalyzer extends ResilientAnalyzer {
    constructor() {
      super({ auditConfig: auditConfig() });
      this.modelCalls = 0;
    }

    async generateStructured() {
      this.modelCalls += 1;
      throw new Error('continuation model should not be called');
    }

    log() {}
  }

  const analyzer = new NoContinuationModelAnalyzer();
  const contexts = [
    { pageNumber: 1, ocrText: 'Emergency Room Patient Record\nPage 1 of 4', analysis: page(1, ['Example Person']) },
    { pageNumber: 2, ocrText: 'Physical Examination\nPage 2 of 4', analysis: page(2) },
    { pageNumber: 3, ocrText: 'Final Diagnosis\nPage 3 of 4', analysis: page(3) },
    { pageNumber: 4, ocrText: 'Emergency Room Nursing Record\nPage 4 of 4', analysis: page(4, ['Example Person']) }
  ];

  const linkage = await analyzer.classifyContinuationPages(contexts, 'example.pdf');
  assert.deepEqual(linkage.identifiedPages, [1, 4]);
  assert.deepEqual(linkage.continuationPages, [2, 3]);
  assert.deepEqual(linkage.unresolvedPages, []);
  assert.equal(linkage.resolvedPercentage, 100);
  assert.equal(analyzer.modelCalls, 0);
  assert.equal(analyzer.getDiagnostic(2).continuation.method, 'explicit-pagination');
  assert.equal(analyzer.getDiagnostic(3).continuation.method, 'explicit-pagination');
});

test('technical OCR failures are reported separately from document uncertainty', () => {
  const analyzer = new ResilientAnalyzer({ auditConfig: auditConfig() });
  analyzer.setStage(1, 'ocr', { status: 'failed', attempts: 3, failureCategory: 'timeout' });
  const failed = analyzer.failedPage(1, 'ocr-or-analysis-failed');
  const text = analyzer.combinePageAnalyses([failed, page(2, ['Example Person'])], 2);
  text.pageLinkage = {
    totalPages: 2,
    identifiedPages: [2],
    continuationPages: [],
    unresolvedPages: [],
    failedPages: [1],
    resolvedPages: 1,
    resolvedPercentage: 50
  };

  const qa = analyzer.evaluateQa(text, cleanImages(), { complete: true, pages: [] });
  assert.equal(qa.status, 'review-required');
  assert.ok(qa.findings.some(item => item.code === 'OCR_MODEL_FAILURE'));
  assert.ok(!qa.findings.some(item => item.code === 'ANALYSIS_INCOMPLETE'));
  assert.deepEqual(qa.recommendations.retryAnalysis, [
    'Retry automated analysis for technical model-processing failures before assigning manual source review.'
  ]);
});
