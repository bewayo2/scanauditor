'use strict';

const path = require('path');
const { parseExplicitPageSequence, runWithRetries } = require('./inference_resilience');

const CONTINUATION_SCHEMA = {
  type: 'object',
  properties: {
    classification: { type: 'string', enum: ['continuation', 'standalone', 'uncertain'] },
    direction: { type: 'string', enum: ['previous', 'next', 'both', 'none'] },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    evidence: { type: 'string' }
  },
  required: ['classification', 'direction', 'confidence', 'evidence']
};

const CONFIDENCE_LEVELS = new Set(['high', 'medium', 'low']);

function neighborHasIdentifier(neighbor) {
  return Boolean(
    neighbor?.analysis?.success &&
    ((neighbor.analysis.patientIdentifiers?.names || []).length ||
      (neighbor.analysis.patientIdentifiers?.hospitalNumbers || []).length)
  );
}

async function classifyContinuationPage({ analyzer, pageContexts, index, fileName }) {
  const current = pageContexts[index];
  const pageNumber = current.pageNumber;
  const totalPages = pageContexts.length;

  const explicit = parseExplicitPageSequence(current.ocrText);
  if (explicit && pageNumber === 1 && explicit.current === 1 && explicit.total === totalPages) {
    return {
      entry: { pageNumber, classification: 'document-start', confidence: 'high', direction: 'none', method: 'explicit-pagination' },
      diagnostic: { status: 'passed', method: 'explicit-pagination', pageSequence: '1/' + totalPages }
    };
  }
  if (explicit && pageNumber > 1 && explicit.current === pageNumber && explicit.total === totalPages) {
    return {
      entry: {
        pageNumber,
        classification: 'continuation',
        confidence: 'high',
        direction: 'previous',
        method: 'explicit-pagination'
      },
      diagnostic: {
        status: 'passed',
        method: 'explicit-pagination',
        pageSequence: `${explicit.current}/${explicit.total}`
      }
    };
  }

  const previous = index > 0 ? pageContexts[index - 1] : null;
  const next = index < pageContexts.length - 1 ? pageContexts[index + 1] : null;
  const prompt = `Determine whether CURRENT PAGE of ${path.basename(fileName)} is a continuation of the same physical document/form as an adjacent page.\n\n` +
    'This is a document-structure classification task. Do not determine whether the patient is correct. Do not invent an identity. Do not treat absence of a name as an error.\n' +
    'Strong continuation evidence may include continued sentences/tables, repeated form structure or heading, explicit page numbering, continued clinical notes, signatures/sections that clearly continue an adjacent page, or other clear multi-page structure.\n' +
    'Return continuation only with strong evidence. If evidence is weak, return uncertain. If this appears to be an independent document with no identifier, return standalone.\n\n' +
    `Physical page number in PDF: ${pageNumber} of ${totalPages}\n` +
    `Previous page has confirmed identifier: ${neighborHasIdentifier(previous) ? 'yes' : 'no'}\n` +
    `Next page has confirmed identifier: ${neighborHasIdentifier(next) ? 'yes' : 'no'}\n` +
    `<previous_page>\n${analyzer.excerpt(previous?.ocrText, 'end')}\n</previous_page>\n` +
    `<current_page>\n${analyzer.excerpt(current.ocrText, 'start')}\n</current_page>\n` +
    `<next_page>\n${analyzer.excerpt(next?.ocrText, 'start')}\n</next_page>`;

  const outcome = await runWithRetries({
    attempts: analyzer.auditConfig.continuationAttempts || 2,
    delayMs: analyzer.auditConfig.retryDelayMs || 0,
    operation: () => analyzer.generateStructured({
      model: analyzer.textModel,
      prompt,
      schema: CONTINUATION_SCHEMA,
      timeout: 120000
    }),
    acceptResult: result => Boolean(result && result.classification && result.confidence),
    onFailure: (error, attempt) => analyzer.log('continuation_model_attempt_failed', {
      pageNumber,
      attempt,
      failureCategory: analyzer.classifyInferenceError(error)
    })
  });

  if (!outcome.ok) {
    return {
      entry: {
        pageNumber,
        classification: 'unresolved',
        confidence: 'low',
        direction: 'none',
        method: 'model-failed'
      },
      diagnostic: {
        status: 'failed',
        method: 'model',
        attempts: outcome.attemptsUsed,
        failureCategory: analyzer.classifyInferenceError(outcome.error)
      }
    };
  }

  const result = outcome.result;
  const classification = String(result.classification || '').toLowerCase();
  const confidence = String(result.confidence || '').toLowerCase();
  const direction = String(result.direction || 'none').toLowerCase();
  // A first PDF page cannot continue a preceding page in this PDF. Without an
  // explicit start marker it remains unresolved, even if a model calls it continuation.
  if (classification === 'continuation' && confidence === 'high' && pageNumber > 1) {
    return {
      entry: { pageNumber, classification: 'continuation', confidence: 'high', direction, method: 'model' },
      diagnostic: { status: 'passed', method: 'model', attempts: outcome.attemptsUsed }
    };
  }

  return {
    entry: {
      pageNumber,
      classification: 'unresolved',
      confidence: CONFIDENCE_LEVELS.has(confidence) ? confidence : 'low',
      direction,
      method: 'model'
    },
    diagnostic: {
      status: 'unresolved',
      method: 'model',
      attempts: outcome.attemptsUsed,
      confidence: CONFIDENCE_LEVELS.has(confidence) ? confidence : 'low'
    }
  };
}

module.exports = { classifyContinuationPage };
