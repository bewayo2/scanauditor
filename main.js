const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const fs = require('fs-extra');
const axios = require('axios');
const XLSX = require('xlsx');
const ConfiguredAnalyzer = require('./configured_analyzer');
const { ACTIVE_MODELS, isModelInstalled } = require('./model_config');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'ScanAuditor - Medical Records Analysis',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const allowedUrl = pathToFileURL(path.join(__dirname, 'index.html')).href;
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== allowedUrl) event.preventDefault();
  });

  mainWindow.loadFile('index.html');
  if (process.argv.includes('--dev')) mainWindow.webContents.openDevTools();
}

async function getOllamaStatus() {
  try {
    const response = await axios.get('http://127.0.0.1:11434/api/tags', { timeout: 2500 });
    const names = (response.data.models || [])
      .flatMap(model => [model.name, model.model])
      .filter(Boolean);
    return {
      status: 'running',
      ollama: 'connected',
      models: {
        ocr: isModelInstalled(names, ACTIVE_MODELS.ocr),
        analysis: isModelInstalled(names, ACTIVE_MODELS.text)
      },
      configuredModels: {
        vision: ACTIVE_MODELS.vision,
        text: ACTIVE_MODELS.text
      }
    };
  } catch (error) {
    return {
      status: 'running',
      ollama: 'disconnected',
      models: { ocr: false, analysis: false },
      configuredModels: {
        vision: ACTIVE_MODELS.vision,
        text: ACTIVE_MODELS.text
      }
    };
  }
}

function failureResult(filePath, error) {
  const fileName = path.basename(filePath || 'Unknown.pdf');
  return {
    filename: fileName,
    analysis: {
      fileInformation: {
        fileName,
        scanDate: new Date().toISOString().split('T')[0],
        totalPages: 0
      },
      summaryTable: [{
        issueType: 'Analysis Failed',
        count: 1,
        pagesAffected: 'Unknown',
        description: error.message
      }],
      detailedFindings: {},
      patientIdentifiers: { names: [], hospitalNumbers: [] },
      identifierCoverage: {
        totalPages: 0,
        pagesProcessedSuccessfully: 0,
        pagesFailed: 0,
        pagesWithIdentifiers: 0,
        pagesWithoutIdentifiers: 0,
        coveragePercentage: 0,
        complete: false,
        isUnsafe: true
      },
      recommendations: {
        manualReview: ['Resolve the analysis error and run the audit again.'],
        rescanning: [],
        verification: [],
        corrections: []
      },
      safetyAssessment: {
        safeForUse: false,
        reason: 'Analysis failed. The document has not been cleared for use.',
        riskLevel: 'high',
        immediateActions: ['Manual review required.']
      },
      complianceStatus: 'needs-review',
      priorityIssues: ['Analysis failed.']
    },
    timestamp: new Date().toISOString()
  };
}

function excelSafe(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(excelSafe).join('; ');
  const text = String(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function exportToExcel(analysisResults) {
  const rows = analysisResults.map(result => {
    const analysis = result.analysis || {};
    const coverage = analysis.identifierCoverage || {};
    return {
      'File Name': excelSafe(analysis.fileInformation?.fileName || result.filename || 'Unknown'),
      'Scan Date': excelSafe(analysis.fileInformation?.scanDate || ''),
      'Total Pages': analysis.fileInformation?.totalPages || 0,
      'Safe for Use': analysis.safetyAssessment?.safeForUse ? 'Yes' : 'No',
      'Risk Level': excelSafe(analysis.safetyAssessment?.riskLevel || 'Unknown'),
      'Compliance Status': excelSafe(analysis.complianceStatus || 'Unknown'),
      'Reason': excelSafe(analysis.safetyAssessment?.reason || ''),
      'Identifier Coverage': Number.isFinite(coverage.coveragePercentage) ? `${coverage.coveragePercentage.toFixed(1)}%` : '0.0%',
      'Pages Failed': coverage.pagesFailed || 0,
      'Patient Names': excelSafe(analysis.patientIdentifiers?.names || []),
      'Hospital Numbers': excelSafe(analysis.patientIdentifiers?.hospitalNumbers || []),
      'Priority Issues': excelSafe(analysis.priorityIssues || []),
      'Immediate Actions': excelSafe(analysis.safetyAssessment?.immediateActions || []),
      'Issue Types': excelSafe((analysis.summaryTable || []).map(issue => issue.issueType)),
      'Pages Affected': excelSafe((analysis.summaryTable || []).map(issue => issue.pagesAffected))
    };
  });

  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet['!cols'] = Object.keys(rows[0] || {}).map(key => ({ wch: Math.max(15, Math.min(45, key.length + 8)) }));
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Analysis Results');
  return workbook;
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('select-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'PDF Files', extensions: ['pdf'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  if (result.canceled) return [];

  const files = [];
  for (const filePath of result.filePaths) {
    if (path.extname(filePath).toLowerCase() !== '.pdf') continue;
    try {
      const stat = await fs.stat(filePath);
      if (stat.isFile()) files.push({ path: filePath, name: path.basename(filePath), size: stat.size });
    } catch (_) {
      // Ignore entries that disappear between selection and stat.
    }
  }
  return files;
});

ipcMain.handle('get-backend-status', getOllamaStatus);

ipcMain.handle('analyze-files', async (_event, filePaths) => {
  if (!Array.isArray(filePaths) || filePaths.length === 0) throw new Error('No files selected.');
  if (filePaths.length > 25) throw new Error('Analyze no more than 25 files at one time.');

  const analyzer = new ConfiguredAnalyzer();
  const results = [];

  for (const requestedPath of filePaths) {
    try {
      if (typeof requestedPath !== 'string' || path.extname(requestedPath).toLowerCase() !== '.pdf') {
        throw new Error('Only PDF files are supported.');
      }
      const realPath = await fs.realpath(requestedPath);
      const stat = await fs.stat(realPath);
      if (!stat.isFile()) throw new Error('Selected path is not a file.');
      results.push(await analyzer.analyzeFile({ path: realPath, originalname: path.basename(realPath) }));
    } catch (error) {
      console.error('[ScanAuditor] analysis_failed', { file: path.basename(String(requestedPath || 'Unknown')), message: error.message });
      results.push(failureResult(requestedPath, error));
    }
  }

  return { results };
});

ipcMain.handle('export-to-excel', async (_event, analysisResults) => {
  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save Analysis Results',
      defaultPath: `ScanAuditor_Results_${new Date().toISOString().split('T')[0]}.xlsx`,
      filters: [{ name: 'Excel Files', extensions: ['xlsx'] }]
    });
    if (result.canceled || !result.filePath) return { success: false, canceled: true };

    const workbook = exportToExcel(Array.isArray(analysisResults) ? analysisResults : []);
    XLSX.writeFile(workbook, result.filePath);
    return { success: true, filePath: result.filePath };
  } catch (error) {
    console.error('[ScanAuditor] export_failed', { message: error.message });
    return { success: false, error: error.message };
  }
});
