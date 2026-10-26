'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const fs = require('fs-extra');
const axios = require('axios');
const XLSX = require('xlsx');
const ConfiguredAnalyzer = require('./configured_analyzer');
const CloudScanAnalyzer = require('./cloud_analyzer');
const costTracker = require('./cost_tracker');
const { ACTIVE_MODELS, isModelInstalled } = require('./model_config');
const { AUDIT_CONFIG } = require('./audit_config');
const { appendAuditRecord } = require('./audit_logger');
const reviewDispositions = require('./review_dispositions');
const { evidenceReport } = require('./evidence_report');
const { runBulkAudit, inspectBulkFolder } = require('./bulk_audit');
const { AuditStore } = require('./audit_store');

let mainWindow;
// In-memory only. Never save or log the hospital's API key.
let sessionOpenAIKey = null;
let selectedBulkRoot = null;
let activeBulk = null;
let activeBulkPreview = null;
let bulkInventory = null;
let activeAnalysis = false;
let costResetPending = false;
let workspaceStore = null;
async function getWorkspace() {
  if (!workspaceStore) workspaceStore = new AuditStore(app.getPath('userData'));
  await workspaceStore.start();
  return workspaceStore;
}


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
    const names = (response.data.models || []).flatMap(model => [model.name, model.model]).filter(Boolean);
    return {
      status: 'running',
      ollama: 'connected',
      models: {
        ocr: isModelInstalled(names, ACTIVE_MODELS.ocr),
        analysis: isModelInstalled(names, ACTIVE_MODELS.text)
      },
      configuredModels: { vision: ACTIVE_MODELS.vision, text: ACTIVE_MODELS.text }
    };
  } catch (_) {
    return {
      status: 'running',
      ollama: 'disconnected',
      models: { ocr: false, analysis: false },
      configuredModels: { vision: ACTIVE_MODELS.vision, text: ACTIVE_MODELS.text }
    };
  }
}

function failureResult(filePath, error) {
  const fileName = path.basename(filePath || 'Unknown.pdf');
  const analysisDate = new Date().toISOString();
  const finding = {
    code: 'ANALYSIS_FAILED',
    message: 'Automated QA could not complete this document. Resolve the analysis error and run the audit again.',
    pages: []
  };
  return {
    filename: fileName,
    analysis: {
      fileInformation: { fileName, analysisDate, totalPages: 0 },
      summaryTable: [{ issueType: 'ANALYSIS FAILED', count: 1, pagesAffected: 'Document', description: error.message }],
      patientIdentifiers: { names: [], hospitalNumbers: [] },
      identifierCoverage: {
        totalPages: 0,
        pagesProcessedSuccessfully: 0,
        pagesFailed: 0,
        pagesWithIdentifiers: 0,
        pagesWithoutIdentifiers: 0,
        coveragePercentage: 0,
        complete: false
      },
      pageLinkage: {
        totalPages: 0,
        identifiedPages: [],
        continuationPages: [],
        unresolvedPages: [],
        failedPages: [],
        resolvedPages: 0,
        resolvedPercentage: 0
      },
      imageAnalysis: {
        complete: false,
        exactDuplicateGroups: [],
        possibleDuplicateGroups: []
      },
      recommendations: {
        manualReview: ['Resolve the analysis error and run the automated QA again.'],
        compareWithSource: [],
        rescanning: []
      },
      qaAssessment: {
        status: 'analysis-failed',
        reason: 'Automated QA could not complete this document.',
        findings: [finding]
      },
      analysisMetadata: {
        analysisDate,
        dpi: AUDIT_CONFIG.dpi,
        models: { ocr: ACTIVE_MODELS.ocr, text: ACTIVE_MODELS.text, image: ACTIVE_MODELS.image },
        fileSha256: null,
        durationMs: null,
        appVersion: app.getVersion()
      },
      priorityIssues: [finding.message]
    },
    timestamp: analysisDate
  };
}

function excelSafe(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(excelSafe).join('; ');
  const text = String(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function formatGroups(groups) {
  if (!Array.isArray(groups)) return '';
  return groups.map(group => Array.isArray(group) ? group.join(' and ') : '').filter(Boolean).join('; ');
}

function exportToExcel(analysisResults) {
  const rows = analysisResults.map(result => {
    const analysis = result.analysis || {};
    const coverage = analysis.identifierCoverage || {};
    const linkage = analysis.pageLinkage || {};
    const qa = analysis.qaAssessment || {};
    const images = analysis.imageAnalysis || {};
    return {
      'File Name': excelSafe(analysis.fileInformation?.fileName || result.filename || 'Unknown'),
      'Analysis Date': excelSafe(analysis.fileInformation?.analysisDate || analysis.analysisMetadata?.analysisDate || ''),
      'Total Pages': analysis.fileInformation?.totalPages || 0,
      'Automated QA Status': excelSafe(qa.status || 'analysis-failed'),
      'QA Reason': excelSafe(qa.reason || ''),
      'Identifier Coverage': Number.isFinite(coverage.coveragePercentage) ? `${coverage.coveragePercentage.toFixed(1)}%` : '0.0%',
      'Continuation Pages': excelSafe(linkage.continuationPages || []),
      'Unresolved Pages': excelSafe(linkage.unresolvedPages || []),
      'Pages Failed': coverage.pagesFailed || 0,
      'Patient Names': excelSafe(analysis.patientIdentifiers?.names || []),
      'Hospital Numbers': excelSafe(analysis.patientIdentifiers?.hospitalNumbers || []),
      'Finding Codes': excelSafe((qa.findings || []).map(item => item.code)),
      'Informational Observations': excelSafe((qa.informationalFindings || []).map(item => item.code)),
      'Manual Disposition': excelSafe(analysis.manualDisposition?.outcome || ''),
      'Disposition Basis': excelSafe(analysis.manualDisposition?.comparisonBasis || ''),
      'Primary Model': excelSafe(analysis.analysisMetadata?.models?.ocr || ''),
      'Fallback Model': excelSafe(analysis.analysisMetadata?.models?.fallback || ''),
      'Issue Types': excelSafe((analysis.summaryTable || []).map(issue => issue.issueType)),
      'Pages Affected': excelSafe((analysis.summaryTable || []).map(issue => issue.pagesAffected)),
      'Exact Duplicate Groups': excelSafe(formatGroups(images.exactDuplicateGroups)),
      'Possible Duplicate Groups': excelSafe(formatGroups(images.possibleDuplicateGroups))
    };
  });

  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet['!cols'] = Object.keys(rows[0] || {}).map(key => ({ wch: Math.max(15, Math.min(45, key.length + 8)) }));
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Automated QA Results');
  return workbook;
}

async function writeAuditRecord(result) {
  try {
    await appendAuditRecord(app.getPath('userData'), result, app.getVersion());
  } catch (error) {
    console.error('[ScanAuditor] audit_log_failed', { message: error.message });
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => { workspaceStore?.close().catch(() => {}); });

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
ipcMain.handle('get-review-disposition', async (_event, fileSha256, documentId = null) => {
  if (Number.isSafeInteger(documentId) && documentId > 0) {
    const record = await (await getWorkspace()).getDocument(documentId);
    if (!record || !record.review_outcome) return null;
    return { outcome: record.review_outcome, comparisonBasis: record.comparison_basis,
      timestamp: record.reviewed_at };
  }
  return reviewDispositions.getDisposition(app.getPath('userData'), fileSha256);
});
ipcMain.handle('save-review-disposition', async (_event, payload) => {
  if (Number.isSafeInteger(payload?.documentId) && payload.documentId > 0) {
    return (await getWorkspace()).reviewDocument(payload.documentId, payload.outcome,
      payload.reviewerLabel || '');
  }
  return reviewDispositions.saveDisposition(app.getPath('userData'), payload);
});

// All workspace database access remains in the Electron main process. The
// renderer receives only a paginated case list and selected record details.
ipcMain.handle('audit-list-projects', async () => (await getWorkspace()).listProjects());
ipcMain.handle('audit-list-documents', async (_event, args) =>
  (await getWorkspace()).listDocuments(args || {}));
ipcMain.handle('audit-list-finding-types', async (_event, projectId) =>
  (await getWorkspace()).listFindingTypes(projectId));
ipcMain.handle('audit-summary', async (_event, projectId) =>
  (await getWorkspace()).summary(projectId));
ipcMain.handle('audit-get-document', async (_event, documentId) =>
  (await getWorkspace()).getDocument(documentId));
ipcMain.handle('audit-review-document', async (_event, args) =>
  (await getWorkspace()).reviewDocument(args?.documentId, args?.outcome,
    args?.reviewerLabel || ''));
ipcMain.handle('audit-create-action', async (_event, args) =>
  (await getWorkspace()).createAction(args?.documentId, args?.kind, args?.reviewerLabel || ''));
ipcMain.handle('audit-update-action', async (_event, args) =>
  (await getWorkspace()).updateAction(args?.actionId, args?.status, args?.reviewerLabel || ''));
ipcMain.handle('audit-reanalyze-document', async (_event, request) => {
  if (activeBulk || activeAnalysis || activeBulkPreview || costResetPending) {
    throw new Error('Stop other scan activity before reanalyzing.');
  }
  const documentId = request?.documentId;
  const workspace = await getWorkspace();
  const record = await workspace.getDocument(documentId);
  if (!record) throw new Error('Audit record not found');
  const projects = await workspace.listProjects();
  const project = projects.find(item => item.id === record.project_id);
  if (!project) throw new Error('Audit project unavailable');
  const mode = project.mode;
  if (mode !== 'local' && (!sessionOpenAIKey || request?.hospitalApproved !== true)) {
    throw new Error('Hospital authorization and a project API key are required for cloud reanalysis.');
  }
  activeAnalysis = true;
  try {
    const source = await fs.realpath(record.source_path);
    if (path.extname(source).toLowerCase() !== '.pdf' || !(await fs.stat(source)).isFile()) {
      throw new Error('Source PDF is unavailable');
    }
    const runId = crypto.randomUUID();
    const analyzer = mode === 'local' ? new ConfiguredAnalyzer() :
      new CloudScanAnalyzer({
        mode, apiKey: sessionOpenAIKey,
        onUsage: entry => costTracker.recordUsage(app.getPath('userData'), { ...entry, runId })
      });
    let result;
    try {
      result = await analyzer.analyzeFile({ path: source, originalname: path.basename(source) });
    } catch (_) {
      result = failureResult(source, new Error('Analysis failed; see the QA result.'));
    }
    const saved = await workspace.saveDocument(record.project_id, source, result, runId);
    await writeAuditRecord(result);
    await costTracker.recordRun(app.getPath('userData'), {
      runId, mode, fileCount: 1, totalPages: Number(result?.analysis?.fileInformation?.totalPages) || 0,
      pagesUnknown: Number(result?.analysis?.fileInformation?.totalPages) > 0 ? 0 : 1
    });
    return { documentId: saved.id, qaStatus: saved.qaStatus, revision: saved.revision };
  } finally {
    activeAnalysis = false;
  }
});
ipcMain.handle('audit-export-summary', async (_event, projectId) => {
  const projects = await (await getWorkspace()).listProjects();
  if (!projects.some(item => item.id === projectId)) throw new Error('Audit project unavailable');
  const confirmation = await dialog.showMessageBox(mainWindow, {
    type: 'warning', buttons: ['Cancel', 'Export Local CSV'],
    defaultId: 0, cancelId: 0, noLink: true,
    message: 'Export filenames and review results?',
    detail: 'The CSV can contain patient-identifying filenames. Save only to hospital-approved secure storage.'
  });
  if (confirmation.response !== 1) return { canceled: true };
  const chosen = await dialog.showSaveDialog(mainWindow, {
    title: 'Export audit summary (contains source filenames)',
    defaultPath: 'ScanAuditor_Project_Review_Summary.csv',
    filters: [{ name: 'CSV summary', extensions: ['csv'] }]
  });
  if (chosen.canceled || !chosen.filePath) return { canceled: true };
  return (await getWorkspace()).exportQueue(projectId, chosen.filePath);
});
ipcMain.handle('audit-backup-database', async () => {
  if (activeBulk || activeAnalysis || activeBulkPreview) throw new Error('Stop scans before backing up.');
  const confirmation = await dialog.showMessageBox(mainWindow, {
    type: 'warning', buttons: ['Cancel', 'Save Database Backup'],
    defaultId: 0, cancelId: 0, noLink: true,
    message: 'Create a sensitive audit database backup?',
    detail: 'The SQLite backup contains detailed hospital audit results, local file paths, and possibly patient identifiers. Choose hospital-approved encrypted storage.'
  });
  if (confirmation.response !== 1) return { canceled: true };
  const chosen = await dialog.showSaveDialog(mainWindow, {
    title: 'Save private SQLite audit database',
    defaultPath: 'ScanAuditor_Workspace_Backup.sqlite3',
    filters: [{ name: 'SQLite Database', extensions: ['sqlite3'] }]
  });
  if (chosen.canceled || !chosen.filePath) return { canceled: true };
  return (await getWorkspace()).backupDatabase(chosen.filePath);
});
ipcMain.handle('audit-export-record-excel', async (_event, documentId) => {
  const record = await (await getWorkspace()).getDocument(documentId);
  if (!record) throw new Error('Audit record not found');
  const confirmation = await dialog.showMessageBox(mainWindow, {
    type: 'warning', buttons: ['Cancel', 'Export Detailed Excel'],
    defaultId: 0, cancelId: 0, noLink: true,
    message: 'Export detailed record findings?',
    detail: 'The Excel report may contain patient names, hospital numbers and clinical context. Save it only to hospital-approved secure storage.'
  });
  if (confirmation.response !== 1) return { canceled: true };
  const chosen = await dialog.showSaveDialog(mainWindow, {
    title: 'Export detailed scan QA report',
    defaultPath: 'ScanAuditor_Record_Review.xlsx',
    filters: [{ name: 'Excel Files', extensions: ['xlsx'] }]
  });
  if (chosen.canceled || !chosen.filePath) return { canceled: true };
  if (record.review_outcome) {
    record.analysis.manualDisposition = {
      outcome: record.review_outcome, comparisonBasis: record.comparison_basis
    };
  }
  const workbook = exportToExcel([{ analysis: record.analysis }]);
  XLSX.writeFile(workbook, chosen.filePath);
  return { saved: true };
});
ipcMain.handle('audit-export-evidence', async (_event, documentId) => {
  const record = await (await getWorkspace()).getDocument(documentId);
  if (!record) throw new Error('Audit record not found');
  const chosen = await dialog.showSaveDialog(mainWindow, {
    title: 'Export PHI-minimized audit evidence for this record',
    defaultPath: 'ScanAuditor_Record_Evidence.json',
    filters: [{ name: 'QA evidence JSON', extensions: ['json'] }]
  });
  if (chosen.canceled || !chosen.filePath) return { canceled: true };
  await fs.writeJson(chosen.filePath, record.evidence, { spaces: 2 });
  return { saved: true };
});
ipcMain.handle('audit-open-pdf', async (_event, documentId) => {
  const record = await (await getWorkspace()).getDocument(documentId);
  if (!record) throw new Error('Audit record not found');
  const original = await fs.realpath(record.source_path);
  if (path.extname(original).toLowerCase() !== '.pdf' || !(await fs.stat(original)).isFile()) {
    throw new Error('Original PDF unavailable');
  }
  // Open with the hospital workstation's registered PDF app, never an
  // external URL. The filesystem path comes only from indexed scan results.
  const error = await shell.openPath(original);
  if (error) throw new Error('The original PDF could not be opened');
  return { opened: true };
});
ipcMain.handle('set-openai-key', (_event, value) => {
  if (typeof value !== 'string' || value.trim().length < 10 || value.length > 300) {
    throw new Error('Enter a valid OpenAI API key.');
  }
  sessionOpenAIKey = value.trim();
  return { configured: true };
});
ipcMain.handle('clear-openai-key', () => {
  sessionOpenAIKey = null;
  return { configured: false };
});
ipcMain.handle('get-openai-key-status', () => ({ configured: Boolean(sessionOpenAIKey) }));
ipcMain.handle('get-cost-dashboard', (_event, mode) => {
  return costTracker.getDashboard(app.getPath('userData'), ['local', 'tiered', 'astra'].includes(mode) ? mode : 'tiered');
});
ipcMain.handle('save-cost-plan', async (_event, plan) => {
  if (costResetPending) throw new Error('Cost history reset in progress.');
  await costTracker.savePlan(app.getPath('userData'), plan);
  return costTracker.getDashboard(app.getPath('userData'), 'tiered');
});

ipcMain.handle('reset-cost-history', async () => {
  if (activeAnalysis || activeBulk || costResetPending) {
    throw new Error('Stop active analyses before resetting cost history.');
  }
  costResetPending = true;
  try {
    const confirmation = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['Cancel', 'Delete All Local Cost History'],
      defaultId: 0, cancelId: 0, noLink: true,
      title: 'Reset All ScanAuditor Costs',
      message: 'Delete all locally tracked API cost history?',
      detail: 'This permanently removes local usage records, run-cost history, and saved forecast assumptions. ' +
        'It does not erase hospital/provider invoices, QA audit evidence, patient PDFs, or folder-audit checkpoints.'
    });
    if (confirmation.response !== 1) return { cleared: false, canceled: true };
    await costTracker.resetCostHistory(app.getPath('userData'));
    return { cleared: true };
  } finally {
    costResetPending = false;
  }
});
ipcMain.handle('analyze-files', async (_event, request) => {
  if (activeBulk || activeAnalysis || costResetPending) {
    throw new Error('Another scan or cost-history reset is active.');
  }
  const filePaths = Array.isArray(request) ? request : request?.filePaths;
  const mode = Array.isArray(request) ? 'local' : request?.mode || 'local';
  if (!Array.isArray(filePaths) || filePaths.length === 0) throw new Error('No files selected.');
  if (filePaths.length > 25) throw new Error('Analyze no more than 25 files at one time.');
  if (!['local', 'tiered', 'astra'].includes(mode)) throw new Error('Unsupported analysis mode.');
  if (mode !== 'local' && (!sessionOpenAIKey || request?.hospitalApproved !== true)) {
    throw new Error('Hospital authorization and a hospital-owned API key are required for cloud processing.');
  }
  activeAnalysis = true;
  try {
  const workspace = await getWorkspace();
  const individualProject = await workspace.upsertProject(
    path.join(app.getPath('userData'), 'individual-audits'), mode, 'individual');
  const runId = crypto.randomUUID();
  const analyzer = mode === 'local'
    ? new ConfiguredAnalyzer()
    : new CloudScanAnalyzer({
      apiKey: sessionOpenAIKey,
      mode,
      onUsage: entry => costTracker.recordUsage(app.getPath('userData'), { ...entry, runId })
    });
  const results = [];

  for (const requestedPath of filePaths) {
    let result;
    try {
      if (typeof requestedPath !== 'string' || path.extname(requestedPath).toLowerCase() !== '.pdf') {
        throw new Error('Only PDF files are supported.');
      }
      const realPath = await fs.realpath(requestedPath);
      const stat = await fs.stat(realPath);
      if (!stat.isFile()) throw new Error('Selected path is not a file.');
      result = await analyzer.analyzeFile({ path: realPath, originalname: path.basename(realPath) });
    } catch (error) {
      console.error('[ScanAuditor] analysis_failed', { message: error.message });
      result = failureResult(requestedPath, error);
    }
    // Individual and folder results use the same indexed case record format.
    if (typeof requestedPath === 'string' && path.extname(requestedPath).toLowerCase() === '.pdf') {
      const saved = await workspace.saveDocument(individualProject.id, requestedPath, result, runId);
      if (result?.analysis) result.analysis.workspaceDocumentId = saved.id;
    }
    results.push(result);
    await writeAuditRecord(result);
  }

  // Record only page counts and the run identifier; never store filenames or PHI.
  const totalPages = results.reduce((sum, result) => sum + (Number(result?.analysis?.fileInformation?.totalPages) || 0), 0);
  const pagesUnknown = results.filter(result => !(Number(result?.analysis?.fileInformation?.totalPages) > 0)).length;
  try {
    await costTracker.recordRun(app.getPath('userData'), {
      runId, mode, fileCount: results.length, totalPages, pagesUnknown
    });
  } catch (_) {
    console.error('[ScanAuditor] cost_run_record_failed');
  }
  return { results, runId };
  } finally {
    activeAnalysis = false;
  }
});

ipcMain.handle('select-bulk-folder', async () => {
  if (activeBulk || activeBulkPreview) throw new Error('Stop the current folder operation before selecting another folder.');
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose folder containing PDF records',
    properties: ['openDirectory']
  });
  if (result.canceled || !result.filePaths.length) return { selected: false };
  selectedBulkRoot = result.filePaths[0];
  bulkInventory = null;
  // The folder path is shown ONLY inside this user's local Electron window.
  // It never enters the persisted batch checkpoint, cost log, or cloud call.
  return { selected: true, path: selectedBulkRoot };
});
ipcMain.handle('inspect-bulk-folder', async () => {
  if (!selectedBulkRoot) throw new Error('Choose a PDF folder first.');
  if (activeBulk || activeBulkPreview) throw new Error('Another folder operation is in progress.');
  const cancellation = { requested: false };
  const root = selectedBulkRoot;
  activeBulkPreview = cancellation;
  try {
    const inventory = await inspectBulkFolder({
      root, cancellation,
      onProgress: progress => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('bulk-progress', progress);
        }
      }
    });
    if (!inventory.canceled && root === selectedBulkRoot) bulkInventory = inventory;
    return inventory;
  } finally {
    activeBulkPreview = null;
  }
});
ipcMain.handle('stop-bulk-audit', () => {
  if (activeBulk) activeBulk.requested = true;
  if (activeBulkPreview) activeBulkPreview.requested = true;
  return { stopping: Boolean(activeBulk || activeBulkPreview) };
});
ipcMain.handle('run-bulk-audit', async (_event, request) => {
  if (activeBulk || activeBulkPreview || activeAnalysis || costResetPending) throw new Error('A scan, inventory or reset is already running.');
  if (!selectedBulkRoot) throw new Error('Choose a folder of PDFs first.');
  const mode = request?.mode || 'local';
  if (!['local', 'tiered', 'astra'].includes(mode)) throw new Error('Unsupported mode.');
  if (mode !== 'local' && (!sessionOpenAIKey || request?.hospitalApproved !== true)) {
    throw new Error('Hospital approval and a hospital project key are required for cloud processing.');
  }
  const cancellation = { requested: false };
  activeBulk = cancellation;
  try {
    return await runBulkAudit({
      root: selectedBulkRoot,
      userData: app.getPath('userData'),
      mode, apiKey: sessionOpenAIKey,
      hospitalApproved: request?.hospitalApproved === true,
      retryFailed: request?.retryFailed === true,
      maxFiles: Number.isSafeInteger(request?.maxFiles) && request.maxFiles > 0 && request.maxFiles <= 1000000
        ? request.maxFiles : 100,
      maxUsd: Number.isFinite(request?.maxUsd) && request.maxUsd >= 0.01 && request.maxUsd <= 100000
        ? request.maxUsd : 5,
      cancellation,
      inventory: bulkInventory,
      store: await getWorkspace(),
      onProgress: progress => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('bulk-progress', progress);
        }
      }
    });
  } finally {
    activeBulk = null;
  }
});
ipcMain.handle('export-qa-evidence', async (_event, results) => {
  if (!Array.isArray(results) || results.length === 0 || results.length > 25) {
    throw new Error('First analyze up to 25 selected PDF files.');
  }
  const selection = await dialog.showSaveDialog(mainWindow, {
    title: 'Save PHI-minimized scan-fidelity evidence',
    defaultPath: 'ScanAuditor_Evidence.json',
    filters: [{ name: 'JSON evidence', extensions: ['json'] }]
  });
  if (selection.canceled || !selection.filePath) return { success: false, canceled: true };
  await fs.writeJson(selection.filePath, {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    reports: results.map(evidenceReport)
  }, { spaces: 2 });
  return { success: true };
});

ipcMain.handle('export-to-excel', async (_event, analysisResults) => {
  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save Automated QA Results',
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
