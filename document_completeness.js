'use strict';

const { parseExplicitPageSequence } = require('./inference_resilience');

// Detect inconsistencies visible *inside* the PDF. A consistent sequence
// cannot establish that every sheet in the original paper folder was scanned.
function analyzeInternalCompleteness(pageContexts = [], totalPages = pageContexts.length) {
  const pages = pageContexts.map((p, i) => {
    const observed = p?.analysis?.success === false ? null : parseExplicitPageSequence(p?.ocrText);
    return {
      pdfPage: i + 1,
      sequencePage: observed?.current ?? null,
      sequenceTotal: observed?.total ?? null,
      readable: p?.analysis?.success === true
    };
  });
  const issues = [];
  const segments = [];
  let segment = null;

  function addIssue(code, affected, missing = []) {
    const list = [...new Set(affected)].sort((a, b) => a - b);
    if (issues.some(issue => issue.code === code && issue.pages.join(',') === list.join(','))) return;
    issues.push({ code, pages: list, missingSequencePages: missing });
  }
  function finishSegment() {
    if (segment) segments.push(segment);
    segment = null;
  }
  for (const item of pages) {
    if (!item.sequencePage) {
      finishSegment();
      continue;
    }
    const prev = segment?.last;
    if (!prev || item.sequencePage === 1 || item.sequenceTotal !== prev.sequenceTotal) {
      finishSegment();
      segment = {
        first: item, last: item, total: item.sequenceTotal, entries: [item],
        startsAtOne: item.sequencePage === 1
      };
      continue;
    }
    if (item.sequencePage === prev.sequencePage) {
      addIssue('REPEATED_PRINTED_PAGE_NUMBER', [prev.pdfPage, item.pdfPage]);
    } else if (item.sequencePage < prev.sequencePage) {
      // Different form may start here; do not infer lost pages from a reset.
      finishSegment();
      segment = {
        first: item, last: item, total: item.sequenceTotal, entries: [item],
        startsAtOne: false
      };
      continue;
    } else if (item.sequencePage > prev.sequencePage + 1) {
      const missing = Array.from({ length: item.sequencePage - prev.sequencePage - 1 }, (_, n) => prev.sequencePage + n + 1);
      addIssue('PRINTED_PAGE_SEQUENCE_GAP', [prev.pdfPage, item.pdfPage], missing);
    }
    segment.entries.push(item);
    segment.last = item;
  }
  finishSegment();

  // Only assert a trailing gap if the form begins with Page 1 of N, its
  // observed numbering is internally consistent, and it ends with the PDF.
  const last = segments[segments.length - 1];
  if (last?.startsAtOne && last.last.pdfPage === totalPages &&
      last.last.sequencePage < last.total && last.entries.length >= 2) {
    const missing = Array.from({ length: last.total - last.last.sequencePage }, (_, i) => last.last.sequencePage + i + 1);
    addIssue('POSSIBLE_TRAILING_PAGES', [last.last.pdfPage], missing);
  }

  // Printed pagination on only some pages is not a proof of loss.
  const numberedPages = pages.filter(item => item.sequencePage !== null).length;
  const failedPages = pages.filter(item => !item.readable).map(item => item.pdfPage);
  const coherentFullSequence = failedPages.length === 0 && numberedPages === totalPages &&
    issues.length === 0 && segments.length === 1 &&
    segments[0].startsAtOne && segments[0].total === totalPages &&
    segments[0].last.sequencePage === totalPages;
  return {
    status: issues.length ? 'potential-gap' : coherentFullSequence ? 'internally-consistent' : 'not-establishable',
    paperCompletenessVerified: false,
    numberedPages, pdfPages: totalPages, failedPages, pages,
    issues, // codes and page numbers only, never OCR text/PHI
    sequenceGroups: segments.map(s => ({
      firstPdfPage: s.first.pdfPage, lastPdfPage: s.last.pdfPage,
      sequenceFirst: s.first.sequencePage, sequenceLast: s.last.sequencePage, declaredTotal: s.total
    })),
    limitation: 'Internal PDF pagination cannot establish the number of sheets in the original paper folder.'
  };
}

module.exports = { analyzeInternalCompleteness };
