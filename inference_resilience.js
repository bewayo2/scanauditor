'use strict';

function classifyInferenceError(error) {
  if (!error) return 'unknown';
  const message = String(error.message || '');
  if (error.code === 'ECONNABORTED' || /timed?\s*out|timeout/i.test(message)) return 'timeout';
  if (error.code === 'SCANAUDITOR_EMPTY_RESULT') return 'empty-output';
  if (error.code === 'SCANAUDITOR_STRUCTURED_FAILED') return 'structured-output-failed';
  if (error.response && Number.isInteger(error.response.status)) return `http-${error.response.status}`;
  if (/json|parse/i.test(message)) return 'invalid-json';
  if (/connect|econnrefused/i.test(message)) return 'ollama-unavailable';
  return 'inference-error';
}

function parseExplicitPageSequence(text) {
  const value = String(text || '');
  const patterns = [
    /\bpage\s*[:#.-]?\s*(\d{1,4})\s*(?:of|\/)\s*(\d{1,4})\b/i,
    /\bpg\.?\s*[:#.-]?\s*(\d{1,4})\s*(?:of|\/)\s*(\d{1,4})\b/i
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (!match) continue;
    const current = Number.parseInt(match[1], 10);
    const total = Number.parseInt(match[2], 10);
    if (Number.isInteger(current) && Number.isInteger(total) && current > 0 && total > 0 && current <= total) {
      return { current, total };
    }
  }
  return null;
}

async function runWithRetries({ attempts, delayMs = 0, operation, acceptResult, onFailure }) {
  const totalAttempts = Math.max(1, Number(attempts) || 1);
  let lastError = null;
  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    try {
      const result = await operation(attempt);
      if (acceptResult && !acceptResult(result)) {
        const error = new Error('Inference returned an unusable result');
        error.code = 'SCANAUDITOR_EMPTY_RESULT';
        throw error;
      }
      return { ok: true, result, attemptsUsed: attempt };
    } catch (error) {
      lastError = error;
      if (onFailure) onFailure(error, attempt);
      if (attempt < totalAttempts && delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
      }
    }
  }
  return { ok: false, error: lastError, attemptsUsed: totalAttempts };
}

function buildLinkage(entries) {
  const identifiedPages = entries.filter(item => item.classification === 'identified').map(item => item.pageNumber);
  const continuationPages = entries.filter(item => item.classification === 'continuation').map(item => item.pageNumber);
  const unresolvedPages = entries.filter(item => item.classification === 'unresolved').map(item => item.pageNumber);
  const failedPages = entries.filter(item => item.classification === 'failed').map(item => item.pageNumber);
  const resolvedPages = identifiedPages.length + continuationPages.length;
  const totalPages = entries.length;
  return {
    entries,
    totalPages,
    identifiedPages,
    continuationPages,
    unresolvedPages,
    failedPages,
    resolvedPages,
    resolvedPercentage: totalPages > 0 ? (resolvedPages / totalPages) * 100 : 0
  };
}

module.exports = {
  buildLinkage,
  classifyInferenceError,
  parseExplicitPageSequence,
  runWithRetries
};
