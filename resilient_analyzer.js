'use strict';

const ScanFidelityAnalyzer = require('./scan_fidelity_analyzer');
const { buildLinkage, classifyInferenceError, runWithRetries } = require('./inference_resilience');
const { classifyContinuationPage } = require('./continuation_classifier');

class ResilientScanFidelityAnalyzer extends ScanFidelityAnalyzer {
  constructor(options = {}) {
    super(options);
    this.processingDiagnostics = new Map();
  }

  getDiagnostic(pageNumber) {
    if (!this.processingDiagnostics.has(pageNumber)) {
      this.processingDiagnostics.set(pageNumber, { pageNumber });
    }
    return this.processingDiagnostics.get(pageNumber);
  }

  setStage(pageNumber, stage, details) {
    this.getDiagnostic(pageNumber)[stage] = { ...details };
  }

  classifyInferenceError(error) {
    return classifyInferenceError(error);
  }

  async performOcrAttempt(imagePath, pageNumber) {
    return super.extractTextWithOCR(imagePath, pageNumber);
  }

  async extractTextWithOCR(imagePath, pageNumber) {
    const outcome = await runWithRetries({
      attempts: this.auditConfig.ocrAttempts || 3,
      delayMs: this.auditConfig.retryDelayMs || 0,
      operation: () => this.performOcrAttempt(imagePath, pageNumber),
      acceptResult: value => Boolean(String(value || '').trim()),
      onFailure: (error, attempt) => this.log('ocr_attempt_failed', {
        pageNumber,
        attempt,
        failureCategory: classifyInferenceError(error)
      })
    });

    if (!outcome.ok) {
      this.setStage(pageNumber, 'ocr', {
        status: 'failed',
        attempts: outcome.attemptsUsed,
        failureCategory: classifyInferenceError(outcome.error)
      });
      throw outcome.error || new Error('OCR failed after retries');
    }

    const text = String(outcome.result || '').trim();
    this.setStage(pageNumber, 'ocr', {
      status: 'passed',
      attempts: outcome.attemptsUsed,
      characters: text.length
    });
    return text;
  }

  async performStructuredPageAnalysis(text, fileName, pageNumber) {
    return super.analyzeTextPage(text, fileName, pageNumber);
  }

  async analyzeTextPage(text, fileName, pageNumber) {
    if (!text || !text.trim()) {
      this.setStage(pageNumber, 'structuredExtraction', { status: 'skipped', reason: 'no-ocr-text' });
      return this.failedPage(pageNumber, 'ocr-empty');
    }

    const outcome = await runWithRetries({
      attempts: this.auditConfig.structuredAttempts || 2,
      delayMs: this.auditConfig.retryDelayMs || 0,
      operation: async () => {
        const result = await this.performStructuredPageAnalysis(text, fileName, pageNumber);
        if (!result || result.success !== true) {
          const error = new Error('Structured extraction did not complete successfully');
          error.code = 'SCANAUDITOR_STRUCTURED_FAILED';
          throw error;
        }
        return result;
      },
      acceptResult: result => Boolean(result && result.success === true),
      onFailure: (error, attempt) => this.log('structured_extraction_attempt_failed', {
        pageNumber,
        attempt,
        failureCategory: classifyInferenceError(error)
      })
    });

    if (!outcome.ok) {
      this.setStage(pageNumber, 'structuredExtraction', {
        status: 'failed',
        attempts: outcome.attemptsUsed,
        failureCategory: classifyInferenceError(outcome.error)
      });
      return this.failedPage(pageNumber, 'structured-analysis-failed-after-retries');
    }

    this.setStage(pageNumber, 'structuredExtraction', { status: 'passed', attempts: outcome.attemptsUsed });
    return outcome.result;
  }

  async classifyContinuationPages(pageContexts, fileName) {
    const entries = [];
    for (let index = 0; index < pageContexts.length; index += 1) {
      const current = pageContexts[index];
      const pageNumber = current.pageNumber;

      if (!current.analysis.success) {
        entries.push({ pageNumber, classification: 'failed', confidence: 'high', direction: 'none', method: 'prior-stage-failure' });
        this.setStage(pageNumber, 'continuation', { status: 'skipped', method: 'prior-stage-failure' });
        continue;
      }

      const names = current.analysis.patientIdentifiers?.names || [];
      const numbers = current.analysis.patientIdentifiers?.hospitalNumbers || [];
      if (names.length || numbers.length) {
        entries.push({ pageNumber, classification: 'identified', confidence: 'high', direction: 'none', method: 'confirmed-identifier' });
        this.setStage(pageNumber, 'continuation', { status: 'passed', method: 'confirmed-identifier' });
        continue;
      }

      const classified = await classifyContinuationPage({ analyzer: this, pageContexts, index, fileName });
      entries.push(classified.entry);
      this.setStage(pageNumber, 'continuation', classified.diagnostic);
    }
    return buildLinkage(entries);
  }

  combinePageAnalyses(pageAnalyses, totalPages) {
    const combined = super.combinePageAnalyses(pageAnalyses, totalPages);
    combined.processingFailures = pageAnalyses
      .filter(page => page && page.success !== true)
      .map(page => {
        const diagnostic = this.processingDiagnostics.get(page.pageNumber) || {};
        if (diagnostic.ocr?.status === 'failed') {
          return { page: page.pageNumber, stage: 'ocr', failureCategory: diagnostic.ocr.failureCategory || 'unknown' };
        }
        if (diagnostic.structuredExtraction?.status === 'failed') {
          return { page: page.pageNumber, stage: 'structured-extraction', failureCategory: diagnostic.structuredExtraction.failureCategory || 'unknown' };
        }
        return { page: page.pageNumber, stage: 'page-processing', failureCategory: page.failureReason || 'unknown' };
      });
    return combined;
  }

  evaluateQa(textAnalysis, imageAnalysis, metrics) {
    const qa = super.evaluateQa(textAnalysis, imageAnalysis, metrics);
    const failures = Array.isArray(textAnalysis.processingFailures) ? textAnalysis.processingFailures : [];
    if (!failures.length) return qa;

    qa.findings = qa.findings.filter(item => item.code !== 'ANALYSIS_INCOMPLETE');
    const pagesByStage = stage => failures.filter(item => item.stage === stage).map(item => item.page);
    const ocrPages = pagesByStage('ocr');
    const structuredPages = pagesByStage('structured-extraction');
    const otherPages = pagesByStage('page-processing');

    if (ocrPages.length) {
      this.addFinding(
        qa.findings,
        'OCR_MODEL_FAILURE',
        `Automated OCR did not produce usable text after ${this.auditConfig.ocrAttempts || 3} attempts. Retry automated analysis before assigning manual source review.`,
        ocrPages
      );
    }
    if (structuredPages.length) {
      this.addFinding(
        qa.findings,
        'STRUCTURED_EXTRACTION_FAILURE',
        `Identifier/date extraction did not complete after ${this.auditConfig.structuredAttempts || 2} attempts. Retry automated analysis before assigning manual source review.`,
        structuredPages
      );
    }
    if (otherPages.length) {
      this.addFinding(qa.findings, 'PAGE_PROCESSING_FAILURE', 'One or more pages could not complete automated processing after retries.', otherPages);
    }

    qa.status = textAnalysis.identifierCoverage.pagesProcessedSuccessfully === 0
      ? 'analysis-failed'
      : qa.findings.length ? 'review-required' : 'passed';
    qa.reason = qa.status === 'analysis-failed'
      ? 'Automated QA could not produce a meaningful page-level analysis for this document.'
      : qa.status === 'review-required'
        ? 'One or more automated scan-fidelity findings require manual review.'
        : 'No configured automated scan-fidelity finding requires manual review.';
    qa.recommendations = qa.recommendations || {};
    qa.recommendations.manualReview = qa.findings.map(item => item.message);
    qa.recommendations.retryAnalysis = ['Retry automated analysis for technical model-processing failures before assigning manual source review.'];
    return qa;
  }

  async analyzeFile(file) {
    this.processingDiagnostics = new Map();
    const result = await super.analyzeFile(file);
    if (result?.analysis) {
      result.analysis.processingDiagnostics = [...this.processingDiagnostics.values()]
        .sort((a, b) => a.pageNumber - b.pageNumber);
    }
    return result;
  }
}

module.exports = ResilientScanFidelityAnalyzer;
