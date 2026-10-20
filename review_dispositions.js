'use strict';

const fs = require('fs-extra');
const path = require('path');
const readline = require('readline');

const OUTCOMES = Object.freeze({
  'no-defect-digital': { label: 'No digitization defect seen (digital inspection)', basis: 'digital-only' },
  'model-false-positive': { label: 'Suspected model false positive (digital inspection)', basis: 'digital-only' },
  'source-issue-confirmed': { label: 'Source-paper limitation confirmed (paper compared)', basis: 'paper-compared' },
  'scan-defect-confirmed': { label: 'Digitization defect confirmed (paper compared)', basis: 'paper-compared' },
  inconclusive: { label: 'Inconclusive — further review needed', basis: 'undetermined' }
});
const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
const feedbackPath = userData => path.join(userData, 'review-feedback', 'dispositions.jsonl');

async function saveDisposition(userData, { fileSha256, outcome }) {
  if (!isHash(fileSha256) || !Object.hasOwn(OUTCOMES, outcome)) throw new Error('Invalid review disposition.');
  const safe = {
    timestamp: new Date().toISOString(),
    fileSha256: fileSha256.toLowerCase(),
    outcome,
    comparisonBasis: OUTCOMES[outcome].basis
  };
  const file = feedbackPath(userData);
  await fs.ensureDir(path.dirname(file));
  await fs.appendFile(file, JSON.stringify(safe) + '\n', 'utf8');
  return safe;
}
async function getDisposition(userData, fileSha256) {
  if (!isHash(fileSha256)) return null;
  const file = feedbackPath(userData);
  if (!(await fs.pathExists(file))) return null;
  const lines = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  let latest = null;
  for await (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry?.fileSha256 === fileSha256.toLowerCase() && Object.hasOwn(OUTCOMES, entry.outcome)) latest = entry;
    } catch (_) { /* Ignore interrupted trailing write. */ }
  }
  return latest;
}
module.exports = { OUTCOMES, saveDisposition, getDisposition };
