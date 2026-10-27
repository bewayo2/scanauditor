'use strict';

// Local, non-cloud patient-folder association check. This does NOT evaluate
// scan fidelity. Never send folder paths or expected registration IDs to AI.
const path = require('path');

function folderIdentity(sourcePath, root) {
  if (typeof sourcePath !== 'string') return null;
  const absolute = path.resolve(sourcePath);
  const base = root && path.isAbsolute(root) ? path.resolve(root) : path.dirname(absolute);
  const relative = path.relative(base, absolute);
  if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) return null;
  const folders = relative.split(path.sep).slice(0, -1);
  // Also permit the chosen root itself to be a patient-registration folder.
  folders.unshift(path.basename(base));
  // The patient folder may contain additional visit/subfolder levels.
  // Prefer a clearly REG-labeled folder; otherwise use the outermost
  // standalone numeric folder beneath the selected root. This avoids
  // accidentally using a nested numeric visit/period folder as the patient ID.
  const matches = [];
  for (const folder of folders) {
    const explicit = /^reg(?:istration)?(?:\s*(?:no|number|#))?[\s:._-]+(\d{5,6})(?:\s*[-–]\s*(.+))?$/i.exec(folder);
    const bare = /^(\d{5,6})(?:\s*[-–]\s*(.+))?$/.exec(folder);
    // Typical hospital directories: FAMILY_GIVEN_123456. Parse the *last*
    // segment as registration, never a number in a PDF filename.
    const nameFirst = /^([\p{L}][\p{L}'-]*(?:[ _'-]+[\p{L}][\p{L}'-]*){1,5})[_ -]+(\d{5,6})$/u.exec(folder);
    const match = explicit || bare;
    if (!match && !nameFirst) continue;
    const registration = nameFirst ? nameFirst[2] : match[1];
    // A numeric YYYYMM date folder is not a registration folder.
    if (!explicit && !nameFirst && /^(19|20)\d{2}(0[1-9]|1[0-2])$/.test(registration)) continue;
    const sourceName = nameFirst ? nameFirst[1].replace(/_/g, ' ') : String(match[2] || '');
    const suffix = sourceName.trim();
    const name = /^[\p{L}][\p{L}\s'-]{4,100}$/u.test(suffix) &&
      suffix.trim().split(/\s+/).length >= 2 ? suffix : null;
    matches.push({ registration, name, source: 'patient-folder',
      explicitlyLabeled: Boolean(explicit || nameFirst) });
  }
  const selected = matches.find(m => m.explicitlyLabeled) || matches[0];
  return selected ? { registration: selected.registration, name: selected.name,
    source: selected.source } : null;
}
function normName(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\b(?:mr|mrs|ms|miss)\b/g, '')
    .replace(/[^a-z\s'-]/g, ' ').replace(/[-']/g, ' ')
    .replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
}
function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const old = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1,
        diagonal + Number(a[i - 1] !== b[j - 1]));
      diagonal = old;
    }
  }
  return row[b.length];
}
function namesCompatible(a, b) {
  const x = normName(a), y = normName(b);
  if (x.length < 2 || y.length < 2) return false;
  // Middle names/initials are optional; first and last must be close.
  const close = (l, r) => Math.abs(l.length - r.length) <= 1 && distance(l, r) <= 1;
  const forward = close(x[0], y[0]) && close(x[x.length - 1], y[y.length - 1]);
  // Hospital folder naming is sometimes SURNAME_GIVEN and patient fields may
  // be GIVEN SURNAME; check both orders, still with a tight OCR edit budget.
  const reversed = close(x[0], y[y.length - 1]) && close(x[x.length - 1], y[0]);
  return forward || reversed;
}
function strongLabel(kind, evidence) {
  const text = String(evidence || '');
  if (/\b(?:doctor|dr\.?|physician|nurse|staff|next.of.kin|contact|signator|date|birth|dob|admission|discharge|phone|invoice)\b/i.test(text)) return false;
  return kind === 'registration'
    ? /\b(?:hospital\s*(?:number|no|#)|patient\s*(?:id|number|no|#)|reg(?:istration)?\s*(?:no|number|#))\b/i.test(text)
    : /\b(?:patient\s*name|patient\s*field|name\s*(?:field|label)|labeled\s*name)\b/i.test(text);
}
function evaluateRecordAssociation(sourcePath, root, mentions = [], options = {}) {
  const trusted = folderIdentity(sourcePath, root);
  const base = {
    status: trusted ? 'unconfirmed' : 'not-configured',
    basis: trusted ? 'authoritative-folder' : 'no-authoritative-folder',
    expectedRegistration: trusted?.registration || null,
    expectedName: trusted?.name || null,
    flags: [], observations: [], matchedRegistrationPages: [],
    evaluatedPages: 0
  };
  if (!trusted) return base;
  const pdfPageCount = Number.isSafeInteger(options.totalPages) && options.totalPages > 0
    ? options.totalPages : null;
  const numeric = new Map(), names = new Map();
  const seen = new Set();
  for (const m of Array.isArray(mentions) ? mentions : []) {
    if (!m || !Number.isSafeInteger(m.pageNumber) || m.pageNumber < 1 || m.confidence !== 'high') continue;
    const kind = m.kind;
    const value = String(m.value || '').trim();
    if (kind !== 'registration' && kind !== 'name') continue;
    if (kind === 'registration' && !/^\d{5,6}$/.test(value)) continue;
    if (!strongLabel(kind, m.evidence)) continue;
    const key = [m.pageNumber,kind,value.toLowerCase()].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    const collection = kind === 'registration' ? numeric : names;
    if (!collection.has(value)) collection.set(value,new Set());
    collection.get(value).add(m.pageNumber);
  }
  const ref = trusted.registration;
  const exact = numeric.get(ref);
  base.matchedRegistrationPages = exact ? [...exact].sort((a,b)=>a-b) : [];
  base.evaluatedPages = new Set([...numeric.values()].flatMap(p => [...p])).size;
  for (const [number, pagesSet] of numeric) {
    if (number === ref) continue;
    const pages = [...pagesSet].sort((a,b)=>a-b);
    const differences = number.length === ref.length
      ? [...number].filter((ch,i)=>ch!==ref[i]).length : 99;
    // Evaluate competing numbers across the whole PDF. A few one-digit OCR
    // variations should not outweigh the expected registration repeatedly
    // observed elsewhere. An alternative that is the only recurring labeled
    // registration, or strongly dominates the expected value, requires review.
    const matchedCount = base.matchedRegistrationPages.length;
    const oneDigitConflict = differences === 1;
    const corroboratedOneDigitConflict = oneDigitConflict && (
      (matchedCount === 0 && pages.length >= 2) ||
      (matchedCount > 0 && pages.length >= 4 && pages.length >= 2 * matchedCount)
    );
    const seriousDifferentNumber = differences >= 2 && (pages.length >= 2 || pdfPageCount === 1);
    const warrantsReview = seriousDifferentNumber || corroboratedOneDigitConflict;
    const detail = { code:'REGISTRATION_DISCREPANCY', pages, observedRegistration:number,
      confidence: warrantsReview ? 'high' : 'low',
      reason: corroboratedOneDigitConflict
        ? 'A one-digit alternate registration consistently predominates across labeled pages; verify against the folder.'
        : differences <= 1
          ? 'Isolated or minority one-digit variation; likely OCR uncertainty unless other identity evidence disagrees.'
          : pdfPageCount === 1
            ? 'The single-page PDF contains a clearly labeled registration materially different from its patient folder.'
            : pages.length < 2 ? 'Isolated different registration number; could refer to another record or OCR.'
              : 'A different labeled patient registration appears on multiple PDF pages.' };
    (detail.confidence === 'high' ? base.flags : base.observations).push(detail);
  }
  // Evaluate patient-name evidence over the *whole PDF*, merging close OCR
  // variants such as Greg/Grug or an omitted middle name. A single different
  // label is too weak; distinct names repeated on independent pages matter.
  const clusters = [];
  for (const [name, pagesSet] of names) {
    const group = clusters.find(c => namesCompatible(c.name, name));
    if (group) for (const p of pagesSet) group.pages.add(p);
    else clusters.push({ name, pages: new Set(pagesSet) });
  }
  const strongNameGroups = clusters.filter(c => c.pages.size >= 2);
  if (!trusted.name && strongNameGroups.length >= 2) {
    base.flags.push({
      code: 'CONFLICTING_PATIENT_NAMES',
      pages: [...new Set(strongNameGroups.flatMap(c => [...c.pages]))].sort((a,b) => a-b),
      confidence: 'high',
      reason: 'Two or more different labeled patient names each recur on multiple pages. Investigate possible mixed records.'
    });
  }
  if (trusted.name) {
    for (const [name, pagesSet] of names) {
      if (namesCompatible(name,trusted.name)) continue;
      const pages = [...pagesSet].sort((a,b)=>a-b);
      const entry = { code:'PATIENT_NAME_DISCREPANCY', pages, observedName:name,
        confidence: pages.length >= 2 ? 'high' : 'low',
        reason: pages.length >= 2 ? 'Different labeled patient name repeated across pages.'
          : 'Isolated different patient-name candidate; may be OCR or another named person.' };
      (entry.confidence === 'high' ? base.flags : base.observations).push(entry);
    }
  }
  // A truly unmatched folder-name candidate may need review even when the
  // registration appears correct; name evidence must still recur on pages.
  base.status = base.flags.length ? 'needs-review'
    : base.matchedRegistrationPages.length ? 'matched'
      : base.observations.length ? 'uncertain' : 'unconfirmed';
  return base;
}
function applyRecordAssociation(result, sourcePath, root) {
  if (!result?.analysis || result.analysis.qaAssessment?.status === 'analysis-failed') return result;
  result.analysis.recordAssociation = evaluateRecordAssociation(
    sourcePath, root, result.analysis.identifierMentions || [],
    { totalPages: result.analysis.fileInformation?.totalPages });
  return result;
}
module.exports = { folderIdentity, namesCompatible, strongLabel, evaluateRecordAssociation, applyRecordAssociation };
