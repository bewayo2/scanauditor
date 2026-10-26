'use strict';

// Staff-facing wording is separate from stable stored diagnostic identifiers.
// Never change the database code when the UI label changes.
const FINDING_LABELS = Object.freeze({
  UNREADABLE_PAGE: 'Unreadable page',
  POSSIBLE_CUTOFF: 'Possibly cropped or cut-off content',
  CUT_OFF_TEXT: 'Cut-off text',
  POSSIBLE_INCOMPLETE_PAGE: 'Possibly incomplete page',
  BLURRY_PAGE: 'Blurry page',
  DARK_PAGE: 'Page too dark',
  LIGHT_PAGE: 'Page too light',
  ORIENTATION_ISSUE: 'Page rotated or misaligned',
  PRINTED_PAGE_SEQUENCE_GAP: 'Possible missing numbered page',
  POSSIBLE_TRAILING_PAGES: 'Possible missing final page(s)',
  REPEATED_PRINTED_PAGE_NUMBER: 'Repeated printed page number',
  UNCONFIRMED_PAGE_NUMBER_JUMP: 'Uncertain printed page sequence',
  POSSIBLY_BLANK_PAGE: 'Possibly blank page',
  CONTENT_AT_RISK: 'Potential loss of page content',
  PARTIALLY_UNCERTAIN_CONTENT: 'Content difficult to assess',
  ANALYSIS_INCOMPLETE: 'Analysis did not finish',
  IMAGE_ANALYSIS_INCOMPLETE: 'Image analysis did not finish',
  IMAGE_METRICS_INCOMPLETE: 'Image quality checks did not finish',
  UNRESOLVED_PAGE: 'Page relationship needs review',
  UNCERTAIN_IDENTIFIER: 'Uncertain patient identifier',
  MULTIPLE_PATIENT_IDENTIFIERS: 'Multiple patient identifiers',
  DATE_ANOMALY: 'Date inconsistency',
  EXACT_DUPLICATE: 'Duplicate page detected',
  POSSIBLE_DUPLICATE: 'Possible duplicate page'
});

function findingLabel(code) {
  if (typeof code !== 'string' || !/^[A-Z][A-Z0-9_]{0,71}$/.test(code)) {
    return 'Other scan quality issue';
  }
  if (Object.hasOwn(FINDING_LABELS, code)) return FINDING_LABELS[code];
  const normalized = code.replace(/_/g, ' ').toLowerCase();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { findingLabel, FINDING_LABELS };
}
