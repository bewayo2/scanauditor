'use strict';

const fs = require('fs-extra');
const path = require('path');

async function appendAuditRecord(userDataPath, result, appVersion) {
  const analysis = result?.analysis || {};
  const metadata = analysis.analysisMetadata || {};
  const qa = analysis.qaAssessment || {};
  const auditDir = path.join(userDataPath, 'audit');
  const auditPath = path.join(auditDir, 'scan-audit.jsonl');

  const record = {
    timestamp: metadata.analysisDate || result?.timestamp || new Date().toISOString(),
    fileSha256: metadata.fileSha256 || null,
    totalPages: analysis.fileInformation?.totalPages || 0,
    qaStatus: qa.status || 'analysis-failed',
    findingCodes: Array.isArray(qa.findings)
      ? [...new Set(qa.findings.map(item => String(item?.code || '')).filter(Boolean))]
      : [],
    models: metadata.models || {},
    dpi: metadata.dpi || null,
    durationMs: Number.isFinite(metadata.durationMs) ? metadata.durationMs : null,
    appVersion: appVersion || metadata.appVersion || null
  };

  await fs.ensureDir(auditDir);
  await fs.appendFile(auditPath, `${JSON.stringify(record)}\n`, 'utf8');
  return auditPath;
}

module.exports = { appendAuditRecord };
