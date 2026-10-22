'use strict';

const crypto = require('crypto');
const fs = require('fs-extra');
const ConfiguredAnalyzer = require('./configured_analyzer');
const { OpenAIClient, QUALITY_FIELDS, needsSecondPass } = require('./openai_inference');

class CloudScanAnalyzer extends ConfiguredAnalyzer {
  constructor({ apiKey, mode = 'tiered', onUsage = async () => {}, client, ...options } = {}) {
    if (!['tiered', 'astra'].includes(mode)) throw new Error('Unknown OpenAI analysis mode.');
    super(options);
    this.mode = mode;
    this.primaryModel = mode === 'astra' ? 'gpt-6-astra' : 'gpt-6-luna';
    this.fallbackModel = mode === 'tiered' ? 'gpt-6.1-sol' : null;
    this.ocrModel = this.primaryModel;
    this.textModel = this.primaryModel;
    this.imageModel = this.primaryModel;
    this.client = client || new OpenAIClient({ apiKey, onUsage });
    this.pageCache = new Map();
    this.runId = crypto.randomBytes(12).toString('hex');
    this.cloudUsagePages = 0;
    this.fileSequence = 0;
  }

  async extractTextWithOCR(imagePath, pageNumber) {
    const pageKey = this.runId + ':' + pageNumber;
    let first;
    let best;
    let firstError;
    try {
      first = await this.client.analyzeImage({ imagePath, model: this.primaryModel, pageKey });
      best = first;
    } catch (error) {
      firstError = error;
      if (error.response?.status === 401 || error.response?.status === 403) {
        this.setStage(pageNumber, 'ocr', { status: 'failed', attempts: 1, failureCategory: 'authentication' });
        throw error;
      }
    }
    let fallbackAttempted = false;
    if (this.fallbackModel && (!best || needsSecondPass(best))) {
      fallbackAttempted = true;
      try {
        const upgraded = await this.client.analyzeImage({ imagePath, model: this.fallbackModel, pageKey });
        // Sol is authoritative if it produced usable page text; otherwise retain Luna's output.
        if (upgraded?.ocrText?.trim() || !best) best = upgraded;
      } catch (error) {
        if (!best) {
          this.setStage(pageNumber, 'ocr', {
            status: 'failed', attempts: 2, failureCategory: this.classifyInferenceError(error)
          });
          throw error;
        }
        this.log('openai_fallback_failed', { pageNumber, failureCategory: this.classifyInferenceError(error) });
      }
    }
    if (!best || !String(best.ocrText || '').trim()) {
      const error = firstError || new Error('Cloud OCR returned no text');
      this.setStage(pageNumber, 'ocr', { status: 'failed', attempts: fallbackAttempted ? 2 : 1, failureCategory: 'empty-output' });
      throw error;
    }
    this.pageCache.set(pageNumber, best);
    this.setStage(pageNumber, 'cloudModels', {
      provider: 'openai',
      firstPassModel: this.primaryModel,
      fallbackModel: fallbackAttempted ? this.fallbackModel : null,
      selectedModel: best === first ? this.primaryModel : this.fallbackModel,
      fallbackUsed: fallbackAttempted,
      qualityObservationCount: Array.isArray(best.qualityObservations) ? best.qualityObservations.length : 0
    });
    this.setStage(pageNumber, 'ocr', {
      status: 'passed',
      attempts: fallbackAttempted ? 2 : 1,
      characters: best.ocrText.length,
      provider: 'openai',
      model: best === first ? this.primaryModel : this.fallbackModel
    });
    return best.ocrText;
  }

  async performStructuredPageAnalysis(text, fileName, pageNumber) {
    const result = this.pageCache.get(pageNumber);
    if (!result) return this.failedPage(pageNumber, 'cloud-extraction-missing');
    const nameCandidates = this.cleanPatientNameCandidates(result.patientNames);
    const hospitalCandidates = this.cleanHospitalNumberCandidates(result.hospitalNumbers);
    const dates = this.cleanDateCandidates(result.dates);
    const names = nameCandidates.filter(x => x.confidence === 'high').map(x => x.value);
    const hospitalNumbers = hospitalCandidates.filter(x => x.confidence === 'high' && x.formatValid).map(x => x.value);
    const uncertainFindings = [
      ...nameCandidates.filter(x => x.confidence !== 'high').map(x => ({ type: 'patient-name', value: x.value, confidence: x.confidence })),
      ...hospitalCandidates.filter(x => x.confidence !== 'high' || !x.formatValid).map(x => ({
        type: 'hospital-number', value: x.value, confidence: x.confidence, formatValid: x.formatValid
      }))
    ];
    return {
      pageNumber,
      success: true,
      failureReason: null,
      patientIdentifiers: { names: [...new Set(names)], hospitalNumbers: [...new Set(hospitalNumbers)] },
      identifierCandidates: { names: nameCandidates, hospitalNumbers: hospitalCandidates },
      uncertainFindings, dates,
      warnings: Array.isArray(result.warnings) ? result.warnings.map(String) : []
    };
  }

  async generateStructured({ prompt, schema }) {
    // Called only for ambiguous continuation pages. Deterministic page-numbering
    // classification still happens first. No local Ollama call in OpenAI mode.
    return this.client.classifyText({ prompt, schema, model: this.primaryModel });
  }

  async analyzeImagesWithVision(imagePaths) {
    const combined = {
      complete: true, failedBatches: [],
      blurryPages: [], darkPages: [], lightPages: [], unreadablePages: [],
      cutoffPages: [], incompletePages: [], upsideDownPages: [], sidewaysPages: [],
      misalignedPages: [], visionDuplicateGroups: [], exactDuplicateGroups: [],
      possibleDuplicateGroups: [], qualityEvidence: [], contentAssessments: []
    };
    const flags = {
      blurry: 'blurryPages', dark: 'darkPages', light: 'lightPages',
      unreadable: 'unreadablePages', cutoff: 'cutoffPages',
      incomplete: 'incompletePages', upsideDown: 'upsideDownPages',
      sideways: 'sidewaysPages', misaligned: 'misalignedPages'
    };
    for (let i = 0; i < imagePaths.length; i += 1) {
      const page = i + 1;
      const result = this.pageCache.get(page);
      if (!result || !result.quality) {
        combined.complete = false;
        combined.failedBatches.push([page]);
        continue;
      }
      for (const field of QUALITY_FIELDS) {
        if (result.quality[field] === true) combined[flags[field]].push(page);
      }
      // Only controlled, non-PHI categories leave the page cache.
      if (result.contentFeatures && typeof result.contentFeatures === 'object') {
        const states = new Set(['legible', 'uncertain', 'potentially-clipped', 'not-observed']);
        const bounded = { pageNumber: page };
        for (const field of ['printedText', 'handwriting', 'signatures', 'stamps', 'marginalNotes']) {
          bounded[field] = states.has(result.contentFeatures[field]) ? result.contentFeatures[field] : 'not-observed';
        }
        bounded.documentEdges = ['visible', 'possible-clipping', 'unknown'].includes(result.contentFeatures.documentEdges)
          ? result.contentFeatures.documentEdges : 'unknown';
        combined.contentAssessments.push(bounded);
      }
      // These are controlled categories only; never persist free-form OCR or PHI.
      for (const observation of Array.isArray(result.qualityObservations) ? result.qualityObservations : []) {
        if (!QUALITY_FIELDS.includes(observation?.type) || result.quality[observation.type] !== true) continue;
        const region = ['top', 'middle', 'bottom', 'left', 'right', 'whole-page', 'unknown'].includes(observation.region) ? observation.region : 'unknown';
        const reason = ['clipped-content', 'missing-image-region', 'illegible-printed-text', 'incorrect-rotation',
          'low-contrast-print', 'blurred-print', 'original-handwriting', 'faint-original', 'other', 'none'].includes(observation.reason)
          ? observation.reason : 'other';
        combined.qualityEvidence.push({
          pageNumber: page, type: observation.type,
          confidence: ['high', 'medium', 'low'].includes(observation.confidence) ? observation.confidence : 'low',
          region, reason, materialLoss: observation.materialLoss === true
        });
      }
    }
    combined.exactDuplicateGroups = await this.findExactDuplicateImages(imagePaths);
    return combined;
  }

  async analyzeFile(file) {
    this.pageCache.clear();
    // Stable non-PHI page keys prevent repeated audits from inflating project progress.
    const source = await fs.readFile(file.path);
    // Different selected files, even identical PDFs, contribute separate
    // page calls to this run's cost estimate.
    this.fileSequence += 1;
    this.runId = crypto.createHash('sha256').update(source).digest('hex') + ':' + this.fileSequence;
    try {
      const result = await super.analyzeFile(file);
      if (result?.analysis?.analysisMetadata) {
        result.analysis.analysisMetadata.provider = 'openai';
        result.analysis.analysisMetadata.mode = this.mode;
        result.analysis.analysisMetadata.models = {
          ocr: this.primaryModel, text: this.primaryModel, image: this.primaryModel,
          fallback: this.fallbackModel
        };
      }
      return result;
    } finally {
      // Avoid retaining OCR text/patient data across records.
      this.pageCache.clear();
    }
  }
}
module.exports = CloudScanAnalyzer;
