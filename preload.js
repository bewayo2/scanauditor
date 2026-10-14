const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectFiles: () => ipcRenderer.invoke('select-files'),
  getBackendStatus: () => ipcRenderer.invoke('get-backend-status'),
  getPathForFile: file => webUtils.getPathForFile(file),
  analyzeFiles: filePaths => ipcRenderer.invoke('analyze-files', filePaths),
  exportToExcel: analysisResults => ipcRenderer.invoke('export-to-excel', analysisResults)
});
