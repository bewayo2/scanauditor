const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectFiles: () => ipcRenderer.invoke('select-files'),
  getBackendStatus: () => ipcRenderer.invoke('get-backend-status'),
  getPathForFile: file => webUtils.getPathForFile(file),
  analyzeFiles: filePaths => ipcRenderer.invoke('analyze-files', filePaths),
  exportToExcel: analysisResults => ipcRenderer.invoke('export-to-excel', analysisResults),
  setOpenAIKey: key => ipcRenderer.invoke('set-openai-key', key),
  clearOpenAIKey: () => ipcRenderer.invoke('clear-openai-key'),
  getOpenAIKeyStatus: () => ipcRenderer.invoke('get-openai-key-status'),
  getCostDashboard: mode => ipcRenderer.invoke('get-cost-dashboard', mode),
  saveCostPlan: plan => ipcRenderer.invoke('save-cost-plan', plan)
});
