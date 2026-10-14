'use strict';

const ScanFidelityAnalyzer = require('./scan_fidelity_analyzer');
const { getConfiguredModels } = require('./model_config');

class ConfiguredAnalyzer extends ScanFidelityAnalyzer {
  constructor(options = {}) {
    const { env = process.env, ...rest } = options;
    const models = getConfiguredModels(env);
    super({
      ...rest,
      ocrModel: rest.ocrModel || models.ocr,
      textModel: rest.textModel || models.text,
      imageModel: rest.imageModel || models.image
    });
  }
}

module.exports = ConfiguredAnalyzer;
