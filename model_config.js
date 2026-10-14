'use strict';

const DEFAULT_MODELS = Object.freeze({
  vision: 'qwen3-vl:8b-instruct',
  text: 'qwen3:14b'
});

function cleanModelName(value, fallback) {
  const text = String(value || '').trim();
  return text || fallback;
}

function getConfiguredModels(env = process.env) {
  const vision = cleanModelName(env.SCANAUDITOR_VISION_MODEL, DEFAULT_MODELS.vision);
  const text = cleanModelName(env.SCANAUDITOR_TEXT_MODEL, DEFAULT_MODELS.text);
  return Object.freeze({
    vision,
    text,
    ocr: vision,
    image: vision
  });
}

function isModelInstalled(installedNames, requestedModel) {
  const requested = String(requestedModel || '').trim();
  if (!requested) return false;
  return (installedNames || []).some(name => String(name || '').trim() === requested);
}

const ACTIVE_MODELS = getConfiguredModels();

module.exports = {
  DEFAULT_MODELS,
  ACTIVE_MODELS,
  getConfiguredModels,
  isModelInstalled
};
