const test = require('node:test');
const assert = require('node:assert/strict');
const ConfiguredAnalyzer = require('../configured_analyzer');
const {
  DEFAULT_MODELS,
  getConfiguredModels,
  isModelInstalled
} = require('../model_config');

test('balanced defaults use Qwen3 vision and Qwen3 14B text models', () => {
  assert.equal(DEFAULT_MODELS.vision, 'qwen3-vl:8b-instruct');
  assert.equal(DEFAULT_MODELS.text, 'qwen3:14b');

  const models = getConfiguredModels({});
  assert.equal(models.ocr, 'qwen3-vl:8b-instruct');
  assert.equal(models.image, 'qwen3-vl:8b-instruct');
  assert.equal(models.text, 'qwen3:14b');
});

test('model environment overrides apply consistently', () => {
  const models = getConfiguredModels({
    SCANAUDITOR_VISION_MODEL: 'qwen3-vl:30b-a3b-instruct',
    SCANAUDITOR_TEXT_MODEL: 'qwen3:30b'
  });
  assert.equal(models.ocr, 'qwen3-vl:30b-a3b-instruct');
  assert.equal(models.image, 'qwen3-vl:30b-a3b-instruct');
  assert.equal(models.text, 'qwen3:30b');
});

test('configured analyzer receives the centralized model selection', () => {
  const analyzer = new ConfiguredAnalyzer({
    env: {
      SCANAUDITOR_VISION_MODEL: 'vision-test-model',
      SCANAUDITOR_TEXT_MODEL: 'text-test-model'
    }
  });
  assert.equal(analyzer.ocrModel, 'vision-test-model');
  assert.equal(analyzer.imageModel, 'vision-test-model');
  assert.equal(analyzer.textModel, 'text-test-model');
});

test('installed model matching is exact', () => {
  assert.equal(isModelInstalled(['qwen3-vl:8b-instruct', 'qwen3:14b'], 'qwen3:14b'), true);
  assert.equal(isModelInstalled(['qwen3:14b'], 'qwen3:14'), false);
});
