'use strict';

function integerSetting(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) return fallback;
  if (parsed < minimum || parsed > maximum) return fallback;
  return parsed;
}

function numberSetting(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < minimum || parsed > maximum) return fallback;
  return parsed;
}

const AUDIT_CONFIG = Object.freeze({
  dpi: integerSetting(process.env.SCANAUDITOR_DPI, 300, 150, 600),
  imageBatchSize: integerSetting(process.env.SCANAUDITOR_IMAGE_BATCH_SIZE, 2, 1, 4),
  nearDuplicateHammingDistance: integerSetting(
    process.env.SCANAUDITOR_DUPLICATE_HAMMING_DISTANCE,
    4,
    0,
    16
  ),
  nearDuplicateTextSimilarity: numberSetting(
    process.env.SCANAUDITOR_DUPLICATE_TEXT_SIMILARITY,
    0.92,
    0,
    1
  ),
  minimumDuplicateTextCharacters: integerSetting(
    process.env.SCANAUDITOR_DUPLICATE_MIN_TEXT,
    50,
    20,
    500
  )
});

module.exports = { AUDIT_CONFIG, integerSetting, numberSetting };
