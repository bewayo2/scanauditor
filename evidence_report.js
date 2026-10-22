'use strict';

const crypto = require('crypto');

const HASH = /^[a-f0-9]{64}$/i;
function safeCode(code) {
  return typeof code === 'string' && /^[A-Z0-9_-]{1,72}$/.test(code) ? code : 'UNCLASSIFIED';
}
function pagesOf(finding) {
  return Array.isArray(finding?.pages) ?
    [...new Set(finding.pages.filter(x => Number.isInteger(x) && x > 0))].sort((a,b)=>a-b) : [];
}
function evidenceReport(result) {
  const analysis = result?.analysis || {};
  const metadata = analysis.analysisMetadata || {};
  const quality = analysis.imageAnalysis || {};
  const qa = analysis.qaAssessment || {};
  const completeness = analysis.internalCompleteness || {};
  const preservation = analysis.contentPreservation || {};
  const inputHash = HASH.test(metadata.fileSha256 || '') ? metadata.fileSha256.toLowerCase() : null;
  const pageStates = Array.isArray(analysis.processingDiagnostics) ? analysis.processingDiagnostics.map(x => ({
    pageNumber: Number(x.pageNumber) || 0,
    ocrStatus: x.ocr?.status || 'unknown',
    ocrAttempts: Number(x.ocr?.attempts) || 0,
    continuationMethod: x.continuation?.method || 'unknown',
    selectedModel: typeof x.cloudModels?.selectedModel === 'string' ? x.cloudModels.selectedModel.slice(0,80) : null,
    fallbackUsed: Boolean(x.cloudModels?.fallbackUsed)
  })) : [];
  const payload = {
    schemaVersion: 1,
    generatedAt: String(metadata.analysisDate || analysis.fileInformation?.analysisDate || ''),
    inputSha256: inputHash,
    pageCount: Number(analysis.fileInformation?.totalPages) || 0,
    appVersion: String(metadata.appVersion || ''),
    models: Object.fromEntries(Object.entries(metadata.models || {}).map(([key, value]) =>
      [key, String(value || '').slice(0,80)])),
    auditSettings: {
      dpi: Number(metadata.dpi) || 0,
      ...(metadata.auditSettings && typeof metadata.auditSettings === 'object' ? metadata.auditSettings : {})
    },
    qa: {
      status: ['passed', 'review-required', 'analysis-failed'].includes(qa.status) ? qa.status : 'analysis-failed',
      findings: (qa.findings || []).map(x => ({ code: safeCode(x.code), pages: pagesOf(x) })),
      informational: (qa.informationalFindings || []).map(x => ({ code: safeCode(x.code), pages: pagesOf(x) }))
    },
    internalCompleteness: {
      status: completeness.status || 'not-assessed',
      paperCompletenessVerified: false,
      numberedPages: Number(completeness.numberedPages) || 0,
      issues: (completeness.issues || []).map(x => ({
        code: safeCode(x.code), pages: pagesOf(x),
        missingSequencePages: Array.isArray(x.missingSequencePages) ?
          x.missingSequencePages.filter(y => Number.isInteger(y) && y > 0) : []
      }))
    },
    contentPreservation: {
      status: preservation.status || 'not-assessed',
      paperContentVerified: false,
      pages: (preservation.pages || []).map(x => ({
        pageNumber: x.pageNumber, assessed: Boolean(x.assessed),
        features: x.features || {},
        documentEdges: x.documentEdges || 'unknown',
        potentiallyBlank: Boolean(x.potentiallyBlank),
        materialLossSuspected: Boolean(x.materialLossSuspected)
      }))
    },
    pageDiagnostics: pageStates,
    // Only numeric/categorical quality evidence; no excerpts or identifiers.
    qualityEvidence: (quality.qualityEvidence || []).map(x => ({
      pageNumber: x.pageNumber, type: x.type, confidence: x.confidence,
      region: x.region, reason: x.reason, materialLoss: Boolean(x.materialLoss)
    })),
    limitation: 'Automated scan-fidelity evidence only; not proof that all source-paper pages were digitized or that disposal is authorized.'
  };
  // SHA-256 checks envelope integrity; it is not a trusted timestamp, signature
  // or independent attestation by a hospital authority.
  return {
    ...payload,
    evidenceSha256: crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')
  };
}
module.exports = { evidenceReport };
