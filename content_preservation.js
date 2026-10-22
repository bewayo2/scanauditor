'use strict';

const FEATURES = Object.freeze(['printedText', 'handwriting', 'signatures', 'stamps', 'marginalNotes']);
const STATES = new Set(['legible', 'uncertain', 'potentially-clipped', 'not-observed']);
const EDGE_STATES = new Set(['visible', 'possible-clipping', 'unknown']);

// Source signatures/stamps cannot be proven missing from a digital-only image.
// "not-observed" is a description of the PDF, not an absence finding.
function inspectContentPreservation(pageContexts = [], imageAnalysis = {}, metrics = {}) {
  const visual = Array.isArray(imageAnalysis.contentAssessments) ? imageAnalysis.contentAssessments : [];
  const byPage = new Map(visual.map(x => [x.pageNumber, x]));
  const metricMap = new Map((metrics.pages || []).map(x => [x.pageNumber, x]));
  const pages = [];
  const issues = [];
  const observations = [];

  for (const ctx of pageContexts) {
    const number = ctx.pageNumber;
    const record = byPage.get(number);
    const assessed = Boolean(record);
    const features = Object.fromEntries(FEATURES.map(field => [field,
      STATES.has(record?.[field]) ? record[field] : 'not-observed']));
    const edges = EDGE_STATES.has(record?.documentEdges) ? record.documentEdges : 'unknown';
    const metric = metricMap.get(number);
    // Blank-looking pages often return NO OCR text at all. A failed OCR stage
    // must not conceal this independent, deterministic image observation.
    const blankCandidate = String(ctx.ocrText || '').trim().length < 20 &&
      Number(metric?.whitePixelRatio) >= 0.995 &&
      Number(metric?.edgeVariance) < 20 &&
      !/intentionally\s+blank/i.test(ctx.ocrText || '');
    const possibleLoss = assessed && (
      edges === 'possible-clipping' ||
      FEATURES.some(field => features[field] === 'potentially-clipped')
    );
    const page = {
      pageNumber: number, assessed, features, documentEdges: edges,
      potentiallyBlank: Boolean(blankCandidate),
      materialLossSuspected: possibleLoss
    };
    pages.push(page);
    if (blankCandidate) issues.push({ code: 'POSSIBLY_BLANK_PAGE', pages: [number] });
    if (possibleLoss) {
      // VLM concern alone is not proof that scanning introduced a defect.
      observations.push({ code: 'CONTENT_AT_RISK', pages: [number] });
    }
    if (assessed && FEATURES.some(field => features[field] === 'uncertain')) {
      observations.push({ code: 'PARTIALLY_UNCERTAIN_CONTENT', pages: [number] });
    }
  }

  return {
    status: issues.length ? 'possible-content-loss' :
      pages.some(x => x.assessed) ? 'observations-available' : 'not-assessed',
    paperContentVerified: false,
    pages,
    issues,
    observations,
    limitation: 'The PDF alone cannot prove that paper annotations, signatures, or whole pages were present before scanning.'
  };
}

module.exports = { FEATURES, STATES, EDGE_STATES, inspectContentPreservation };
