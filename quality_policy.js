'use strict';

// VLM observations are hypotheses about the image, not proof of a scanning error.
// Only strong, localized evidence of MATERIAL loss can create an automated review.
// Source-paper limitations cannot be identified from a digital scan alone.
const CODES = Object.freeze({
  unreadable: ['UNREADABLE_PAGE', 'unreadablePages'],
  cutoff: ['POSSIBLE_CUTOFF', 'cutoffPages'],
  incomplete: ['POSSIBLE_INCOMPLETE_PAGE', 'incompletePages'],
  blurry: ['BLURRY_PAGE', 'blurryPages'],
  dark: ['DARK_PAGE', 'darkPages'],
  light: ['LIGHT_PAGE', 'lightPages'],
  upsideDown: ['ORIENTATION_ISSUE', 'upsideDownPages'],
  sideways: ['ORIENTATION_ISSUE', 'sidewaysPages'],
  misaligned: ['ORIENTATION_ISSUE', 'misalignedPages']
});
const MATERIAL_REASONS = Object.freeze({
  unreadable: new Set(['illegible-printed-text']),
  cutoff: new Set(['clipped-content', 'missing-image-region']),
  incomplete: new Set(['clipped-content', 'missing-image-region']),
  upsideDown: new Set(['incorrect-rotation']),
  sideways: new Set(['incorrect-rotation'])
});
const REVIEW_TYPES = new Set(Object.keys(MATERIAL_REASONS));

function qualityFindings(images = {}) {
  const raw = [];
  const review = [];
  const informational = [];
  const signals = Array.isArray(images.qualityEvidence) ? images.qualityEvidence : null;
  for (const [type, [code, field]] of Object.entries(CODES)) {
    const pages = [...new Set((images[field] || []).filter(n => Number.isInteger(n) && n > 0))].sort((a,b)=>a-b);
    for (const page of pages) {
      const signal = signals?.find(x => x.pageNumber === page && x.type === type);
      const strong = Boolean(signal &&
        signal.confidence === 'high' &&
        signal.materialLoss === true &&
        signal.region && signal.region !== 'unknown' &&
        MATERIAL_REASONS[type]?.has(signal.reason));
      // Legacy/local boolean results have no evidence envelope: retain review for
      // severe unreadability/cutoff/incompleteness; don't silently discard defects.
      const legacySevere = !signals && ['unreadable', 'cutoff', 'incomplete'].includes(type);
      const target = strong || legacySevere ? review : informational;
      const item = {
        code, pages: [page],
        message: target === review
          ? 'Possible material reproduction problem on this page. Compare it with the original paper before deciding whether to rescan.'
          : 'Model noted a possible image-quality limitation without sufficient evidence of material digital content loss. This may originate in the paper source.',
        ...(signal ? { reason: signal.reason, region: signal.region, confidence: signal.confidence } : {})
      };
      target.push(item);
      raw.push(item);
    }
  }
  return { review, informational, raw };
}

module.exports = { CODES, qualityFindings, REVIEW_TYPES };
