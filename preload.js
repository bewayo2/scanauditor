const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectFiles: () => ipcRenderer.invoke('select-files'),
  getBackendStatus: () => ipcRenderer.invoke('get-backend-status'),
  getPathForFile: file => webUtils.getPathForFile(file),
  analyzeFiles: filePaths => ipcRenderer.invoke('analyze-files', filePaths),
  exportToExcel: analysisResults => ipcRenderer.invoke('export-to-excel', analysisResults),
  exportQaEvidence: results => ipcRenderer.invoke('export-qa-evidence', results),
  selectBulkFolder: () => ipcRenderer.invoke('select-bulk-folder'),
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
  saveCostPlan: plan => ipcRenderer.invoke('save-cost-plan', plan)
});
