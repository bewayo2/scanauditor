'use strict';

const { parseExplicitPageSequence } = require('./inference_resilience');

// Page numbering is optional and normally scoped to a FORM or VISIT, not the
// patient's whole record. The PDF alone cannot establish source-paper presence.
function analyzeInternalCompleteness(pageContexts = [], totalPages = pageContexts.length) {
  const pages = pageContexts.map((context, index) => {
    // OCR may find a printed sequence only if that page was readable.
    const sequence = context?.analysis?.success === false
      ? null : parseExplicitPageSequence(context?.ocrText);
    return {
      pdfPage: index + 1,
      sequencePage: sequence?.current ?? null,
      sequenceTotal: sequence?.total ?? null,
      readable: context?.analysis?.success === true
    };
  });
  const issues = [];
  const observations = [];
  const segments = [];
  const unnumberedPages = pages.filter(page => page.sequencePage === null).map(page => page.pdfPage);
  let segment = null;

  function add(collection, code, affectedPages, missing = []) {
    const seen = [...new Set(affectedPages)].sort((a, b) => a - b);
    if (collection.some(item => item.code === code && item.pages.join(',') === seen.join(','))) return;
    collection.push({ code, pages: seen, missingSequencePages: missing });
  }
  function finish() {
    if (segment) segments.push(segment);
    segment = null;
  }
  function begin(page) {
    segment = {
      first: page, last: page, total: page.sequenceTotal,
      entries: [page], startsAtOne: page.sequencePage === 1, hasJump: false
    };
  }

  for (const page of pages) {
    if (page.sequencePage === null) {
      // Do not require pagination on handwritten or additional sheets.
      // An unnumbered page may itself contain the missing numbered content.
      continue;
    }
    if (!segment) {
      begin(page);
      continue;
    }
    const prev = segment.last;
    if (page.sequencePage === 1 || page.sequenceTotal !== segment.total ||
        page.sequencePage < prev.sequencePage) {
      // New visit/form, potentially with the SAME "of N" as the prior visit.
      finish();
      begin(page);
      continue;
    }
    if (page.sequencePage === prev.sequencePage) {
      // Two forms can bear the same printed number; no automatic scan defect.
      add(observations, 'REPEATED_PRINTED_PAGE_NUMBER', [prev.pdfPage, page.pdfPage]);
      finish();
      begin(page);
      continue;
    }

    const delta = page.sequencePage - prev.sequencePage;
    if (delta > 1) {
      const missing = Array.from({ length: delta - 1 }, (_, i) => prev.sequencePage + 1 + i);
      // Require a strong, consecutively observed run already starting at 1
      // before referring an abrupt jump for review. If there was an unnumbered
      // PDF sheet in between, do not infer that the source sheet was omitted.
      const stronglySuggested = segment.startsAtOne && segment.entries.length >= 2 &&
        prev.pdfPage + 1 === page.pdfPage;
      add(stronglySuggested ? issues : observations,
        stronglySuggested ? 'PRINTED_PAGE_SEQUENCE_GAP' : 'UNCONFIRMED_PAGE_NUMBER_JUMP',
        [prev.pdfPage, page.pdfPage], missing);
      segment.hasJump = true;
    }
    segment.entries.push(page);
    segment.last = page;
  }
  finish();

  // A partly numbered form at the end of a *combined* PDF is only suggestive.
  // Refer only when we saw 1, 2, 3... together at its physical end.
  const last = segments[segments.length - 1];
  if (last?.startsAtOne && last.entries.length >= 3 &&
      !last.hasJump && last.last.pdfPage === totalPages &&
      last.last.sequencePage < last.total) {
    const missing = Array.from({ length: last.total - last.last.sequencePage },
      (_, index) => last.last.sequencePage + index + 1);
    add(issues, 'POSSIBLE_TRAILING_PAGES', [last.last.pdfPage], missing);
  }

  const numberedPages = pages.length - unnumberedPages.length;
  const failedPages = pages.filter(item => !item.readable).map(item => item.pdfPage);
  const coherentSections = segments.length > 0 && issues.length === 0 &&
    failedPages.length === 0 && segments.every(part =>
      part.startsAtOne && !part.hasJump && part.last.sequencePage === part.total);
  const status = issues.length ? 'potential-gap' : coherentSections
    ? segments.length === 1 && unnumberedPages.length === 0
      ? 'internally-consistent' : 'numbered-sections-consistent'
    : 'not-establishable';

  return {
    status,
    paperCompletenessVerified: false,
    numberingRequired: false,
    numberedPages, unnumberedPages,
    pdfPages: totalPages, failedPages, pages,
    issues, observations,
    sequenceGroups: segments.map(part => ({
      firstPdfPage: part.first.pdfPage, lastPdfPage: part.last.pdfPage,
      sequenceFirst: part.first.sequencePage, sequenceLast: part.last.sequencePage,
      declaredTotal: part.total,
      internallyComplete: part.startsAtOne && part.last.sequencePage === part.total && !part.hasJump
    })),
    limitation: 'Numbers are optional and may restart per visit/form. Internal PDF evidence does not prove the source-paper folder was complete.'
  };
}

module.exports = { analyzeInternalCompleteness };
