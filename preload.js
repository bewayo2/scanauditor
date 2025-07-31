const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  selectFiles: () => ipcRenderer.invoke('select-files'),
  getBackendStatus: () => ipcRenderer.invoke('get-backend-status'),
  analyzeFiles: async (files) => {
    const formData = new FormData();
    for (const file of files) {
      formData.append('files', file);
    }
    
    const response = await fetch('http://localhost:3001/api/analyze', {
      method: 'POST',
      body: formData
    });
    
    return response.json();
  }
}); 