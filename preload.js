const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectFiles: () => ipcRenderer.invoke('select-files'),
  getBackendStatus: () => ipcRenderer.invoke('get-backend-status'),
  // Electron 28 exposes File.path; Electron 29+ exposes webUtils.
  // Keep either version able to accept dropped PDFs without changing the UI.
  getPathForFile: file => {
    if (webUtils && typeof webUtils.getPathForFile === 'function') {
      return webUtils.getPathForFile(file);
    }
    if (file && typeof file.path === 'string' && file.path) return file.path;
    throw new Error('Dropped file path unavailable. Use Browse Files.');
  },
  analyzeFiles: filePaths => ipcRenderer.invoke('analyze-files', filePaths),
  exportToExcel: analysisResults => ipcRenderer.invoke('export-to-excel', analysisResults),
  exportQaEvidence: results => ipcRenderer.invoke('export-qa-evidence', results),
  selectBulkFolder: () => ipcRenderer.invoke('select-bulk-folder'),
  inspectBulkFolder: () => ipcRenderer.invoke('inspect-bulk-folder'),
  runBulkAudit: options => ipcRenderer.invoke('run-bulk-audit', options),
  stopBulkAudit: () => ipcRenderer.invoke('stop-bulk-audit'),
  onBulkProgress: callback => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('bulk-progress', listener);
    return () => ipcRenderer.removeListener('bulk-progress', listener);
  },
  setOpenAIKey: key => ipcRenderer.invoke('set-openai-key', key),
  clearOpenAIKey: () => ipcRenderer.invoke('clear-openai-key'),
  getOpenAIKeyStatus: () => ipcRenderer.invoke('get-openai-key-status'),
  getReviewDisposition: hash => ipcRenderer.invoke('get-review-disposition', hash),
  saveReviewDisposition: payload => ipcRenderer.invoke('save-review-disposition', payload),
  getCostDashboard: mode => ipcRenderer.invoke('get-cost-dashboard', mode),
  saveCostPlan: plan => ipcRenderer.invoke('save-cost-plan', plan),
  resetCostHistory: () => ipcRenderer.invoke('reset-cost-history'),
  auditListProjects: () => ipcRenderer.invoke('audit-list-projects'),
  auditListDocuments: filters => ipcRenderer.invoke('audit-list-documents', filters),
  auditListFindingTypes: projectId => ipcRenderer.invoke('audit-list-finding-types', projectId),
  auditSummary: projectId => ipcRenderer.invoke('audit-summary', projectId),
  auditGetDocument: id => ipcRenderer.invoke('audit-get-document', id),
  auditReviewDocument: request => ipcRenderer.invoke('audit-review-document', request),
  auditCreateAction: request => ipcRenderer.invoke('audit-create-action', request),
  auditUpdateAction: request => ipcRenderer.invoke('audit-update-action', request),
  auditOpenPdf: id => ipcRenderer.invoke('audit-open-pdf', id),
  auditReanalyzeDocument: request => ipcRenderer.invoke('audit-reanalyze-document', request),
  auditExportSummary: projectId => ipcRenderer.invoke('audit-export-summary', projectId),
  auditExportEvidence: documentId => ipcRenderer.invoke('audit-export-evidence', documentId),
  auditExportRecordExcel: documentId => ipcRenderer.invoke('audit-export-record-excel', documentId),
  auditBackupDatabase: () => ipcRenderer.invoke('audit-backup-database')
});
