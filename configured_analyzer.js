'use strict';

const ResilientScanFidelityAnalyzer = require('./resilient_analyzer');
const { getConfiguredModels } = require('./model_config');

class ConfiguredAnalyzer extends ResilientScanFidelityAnalyzer {
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

  log(event, details = {}) {
    const safeDetails = { ...details };
    delete safeDetails.fileName;
    console.log(`[ScanAuditor] ${event}`, safeDetails);
  }
}

module.exports = ConfiguredAnalyzer;
