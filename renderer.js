'use strict';

let selectedFiles = [];
let analysisResults = [];

const byId = id => document.getElementById(id);
const selectFilesBtn = byId('select-files-btn');
const clearFilesBtn = byId('clear-files-btn');
const analyzeFilesBtn = byId('analyze-files-btn');
const fileUploadArea = byId('file-upload-area');
const selectedFilesDiv = byId('selected-files');
const fileList = byId('file-list');
const resultsSection = byId('results-section');
const resultsSummary = byId('results-summary');
const resultsDetails = byId('results-details');
const loadingOverlay = byId('loading-overlay');
const backendStatus = byId('backend-status');
const ollamaStatus = byId('ollama-status');
const exportButton = byId('export-excel-btn');
const analysisMode = byId('analysis-mode');
const cloudSettings = byId('cloud-settings');
const apiKeyField = byId('openai-api-key');
const apiKeyStatus = byId('openai-key-status');
const hospitalApproved = byId('hospital-approved');
const costFields = {
  targetPages: byId('forecast-target-pages'),
  targetFiles: byId('forecast-target-files'),
  forecastBasis: byId('forecast-basis'),
  selectedRunId: byId('forecast-selected-run'),
  estimatedInputTokensPerPage: byId('planning-input-tokens'),
  estimatedOutputTokensPerPage: byId('planning-output-tokens'),
  fallbackPercent: byId('fallback-percent')
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'Size unavailable';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function showNotification(message, type = 'info') {
  const existing = document.querySelector('.notification');
  if (existing) existing.remove();
  const notification = el('div', `notification ${type}`, message);
  document.body.appendChild(notification);
  setTimeout(() => notification.remove(), 4500);
}

function showLoading(show) {
  loadingOverlay.style.display = show ? 'flex' : 'none';
  analyzeFilesBtn.disabled = show;
  selectFilesBtn.disabled = show;
  clearFilesBtn.disabled = show;
}

function addFiles(files) {
  let added = 0;
  for (const file of files) {
    if (!file || !file.path || !file.name) continue;
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      showNotification(`${file.name} was skipped. Only PDF files are supported.`, 'warning');
      continue;
    }
    if (!selectedFiles.some(existing => existing.path === file.path)) {
      selectedFiles.push(file);
      added += 1;
    }
  }
  updateFileList();
  if (selectedFiles.length) {
    selectedFilesDiv.style.display = 'block';
    fileUploadArea.style.display = 'none';
  }
  if (added) showNotification(`Added ${added} PDF file(s).`, 'success');
}

function updateFileList() {
  fileList.replaceChildren();
  selectedFiles.forEach((file, index) => {
    const item = el('div', 'file-item');
    const info = el('div', 'file-info');
    const textWrap = el('div');
    textWrap.append(el('div', 'file-name', file.name), el('div', 'file-size', formatFileSize(file.size)));
    info.appendChild(textWrap);

    const remove = el('button', 'btn btn-secondary', 'Remove');
    remove.type = 'button';
    remove.addEventListener('click', () => {
      selectedFiles.splice(index, 1);
      updateFileList();
      if (!selectedFiles.length) {
        selectedFilesDiv.style.display = 'none';
        fileUploadArea.style.display = 'block';
      }
    });
    item.append(info, remove);
    fileList.appendChild(item);
  });
}

async function handleFileSelection() {
  try {
    const files = await window.electronAPI.selectFiles();
    addFiles(files || []);
  } catch (error) {
    showNotification(`Could not select files: ${error.message}`, 'error');
  }
}

async function handleDrop(event) {
  event.preventDefault();
  fileUploadArea.classList.remove('dragover');
  const dropped = [];
  for (const file of Array.from(event.dataTransfer.files || [])) {
    try {
      const filePath = window.electronAPI.getPathForFile(file);
      dropped.push({ path: filePath, name: file.name, size: file.size });
    } catch (_) {
      showNotification(`Could not access ${file.name}. Use Browse Files instead.`, 'warning');
    }
  }
  addFiles(dropped);
}

async function analyzeSelectedFiles() {
  if (!selectedFiles.length) {
    showNotification('Select at least one PDF file.', 'warning');
    return;
  }

  const mode = analysisMode.value;
  if (mode !== 'local' && !hospitalApproved.checked) {
    showNotification('Confirm hospital authorization before uploading medical records to OpenAI.', 'warning');
    return;
  }
  showLoading(true);
  try {
    const response = await window.electronAPI.analyzeFiles({
      filePaths: selectedFiles.map(file => file.path),
      mode,
      hospitalApproved: hospitalApproved.checked
    });
    analysisResults = Array.isArray(response?.results) ? response.results : [];
    displayResults();
    showNotification(`Automated QA completed for ${analysisResults.length} file(s).`, 'success');
  } catch (error) {
    showNotification(`Automated QA failed: ${error.message}`, 'error');
  } finally {
    showLoading(false);
    refreshCostDashboard().catch(() => {});
  }
}

function createStat(label, value) {
  const card = el('div', 'stat-card');
  card.append(el('div', 'stat-number', value), el('div', 'stat-label', label));
  return card;
}

function qaLabel(status) {
  if (status === 'passed') return 'Automated QA Passed';
  if (status === 'review-required') return 'Review Required';
  return 'Analysis Failed';
}

function qaClass(status) {
  if (status === 'passed') return 'pass';
  if (status === 'review-required') return 'warning';
  return 'fail';
}

function displayResults() {
  resultsSummary.replaceChildren();
  resultsDetails.replaceChildren();

  const passed = analysisResults.filter(result => result.analysis?.qaAssessment?.status === 'passed').length;
  const review = analysisResults.filter(result => result.analysis?.qaAssessment?.status === 'review-required').length;
  const failed = analysisResults.filter(result => result.analysis?.qaAssessment?.status === 'analysis-failed').length;
  const summary = el('div', 'summary-stats');
  summary.append(
    createStat('Total Files', analysisResults.length),
    createStat('Automated QA Passed', passed),
    createStat('Review Required', review),
    createStat('Analysis Failed', failed)
  );
  resultsSummary.appendChild(summary);

  analysisResults.forEach(result => resultsDetails.appendChild(createResultCard(result)));
  resultsSection.style.display = 'block';
  resultsSection.scrollIntoView({ behavior: 'smooth' });
}

function createDetail(label, value, extraClass = '') {
  const item = el('div', 'detail-item');
  item.append(el('div', 'detail-label', label), el('div', `detail-value ${extraClass}`.trim(), value));
  return item;
}

function createMaskedFinding(label, value, masked) {
  const row = el('div', 'finding-item positive privacy-protected');
  const labelNode = el('span', 'finding-label', `${label}: `);
  const valueNode = el('span', 'privacy-mask', masked);
  const button = el('button', 'privacy-toggle', 'Show');
  button.type = 'button';
  let revealed = false;
  button.addEventListener('click', () => {
    revealed = !revealed;
    valueNode.textContent = revealed ? value : masked;
    button.textContent = revealed ? 'Hide' : 'Show';
  });
  row.append(labelNode, valueNode, button);
  return row;
}

function createIssuesTable(issues) {
  const section = el('div', 'summary-table');
  section.appendChild(el('h4', '', 'Automated QA Findings'));
  const table = el('table');
  const head = el('thead');
  const headRow = el('tr');
  ['Finding', 'Count', 'Pages Affected', 'Description'].forEach(title => headRow.appendChild(el('th', '', title)));
  head.appendChild(headRow);
  table.appendChild(head);

  const body = el('tbody');
  for (const issue of issues) {
    const row = el('tr');
    row.append(
      el('td', '', issue.issueType || ''),
      el('td', '', issue.count ?? ''),
      el('td', '', issue.pagesAffected || ''),
      el('td', '', issue.description || '')
    );
    body.appendChild(row);
  }
  table.appendChild(body);
  section.appendChild(table);
  return section;
}

function createInformationalTable(items) {
  const section = createIssuesTable(items);
  const heading = section.querySelector('h4');
  if (heading) heading.textContent = 'Informational Observations (not automatic review findings)';
  return section;
}

function createModelDiagnostics(analysis) {
  const rows = Array.isArray(analysis.processingDiagnostics) ? analysis.processingDiagnostics : [];
  if (!rows.length) return null;
  const wrap = el('div', 'summary-table');
  wrap.appendChild(el('h4', '', 'Page Processing Diagnostics'));
  const table = el('table');
  const thead = el('thead');
  const header = el('tr');
  ['Page', 'Model selected', 'Sol fallback', 'Continuation', 'OCR status'].forEach(label => header.appendChild(el('th', '', label)));
  thead.appendChild(header);
  table.appendChild(thead);
  const tbody = el('tbody');
  for (const row of rows) {
    const tr = el('tr');
    const cloud = row.cloudModels || {};
    tr.append(
      el('td', '', row.pageNumber || ''),
      el('td', '', cloud.selectedModel || analysis.analysisMetadata?.models?.ocr || 'Local model'),
      el('td', '', cloud.fallbackUsed === true ? 'Yes' : cloud.fallbackUsed === false ? 'No' : 'N/A'),
      el('td', '', row.continuation?.method || '—'),
      el('td', '', row.ocr?.status || '—')
    );
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function createQualityEvidence(analysis) {
  const evidence = Array.isArray(analysis.imageAnalysis?.qualityEvidence) ? analysis.imageAnalysis.qualityEvidence : [];
  if (!evidence.length) return null;
  const section = el('div', 'summary-table');
  section.appendChild(el('h4', '', 'Model Quality Observations and Evidence'));
  const table = el('table');
  const head = el('thead');
  const labels = ['Page', 'Observation', 'Confidence', 'Region', 'Reason', 'Material content loss?'];
  const headRow = el('tr');
  labels.forEach(label => headRow.appendChild(el('th', '', label)));
  head.appendChild(headRow);
  table.appendChild(head);
  const body = el('tbody');
  for (const item of evidence) {
    const tr = el('tr');
    tr.append(
      el('td', '', item.pageNumber),
      el('td', '', item.type),
      el('td', '', item.confidence),
      el('td', '', item.region),
      el('td', '', item.reason),
      el('td', '', item.materialLoss ? 'Suspected' : 'Not established')
    );
    body.appendChild(tr);
  }
  table.appendChild(body);
  section.appendChild(table);
  return section;
}

function createPreservationSummary(analysis) {
  const completeness = analysis.internalCompleteness;
  const preservation = analysis.contentPreservation;
  if (!completeness && !preservation) return null;
  const box = el('div', 'finding-section');
  box.appendChild(el('h4', '', 'Document Completeness & Content Preservation'));
  box.appendChild(el('p', 'small-note',
    'Internal checks assess only the PDF. They cannot establish that all sheets, signatures, or annotations on the paper original were digitized.'));
  if (completeness) {
    const count = completeness.numberedPages ?? 0;
    const unnumbered = (completeness.unnumberedPages || []).length;
    const groups = completeness.sequenceGroups || [];
    box.appendChild(el('div', 'finding-item',
      'Numbered pages: ' + count + ' of ' + completeness.pdfPages +
      '; unnumbered pages: ' + unnumbered +
      '; identified numbered sections: ' + groups.length +
      '. Internal status: ' + completeness.status +
      '. Numbering can restart for each form or visit and is not required on continuation sheets.'));
    for (const group of groups) {
      box.appendChild(el('div', 'finding-item',
        'Numbered section on PDF pages ' + group.firstPdfPage + '–' + group.lastPdfPage +
        ': printed ' + group.sequenceFirst + ' through ' + group.sequenceLast +
        ' of ' + group.declaredTotal +
        (group.internallyComplete ? ' (internally consistent)' : ' (not fully verifiable)')));
    }
    for (const issue of completeness.issues || []) {
      box.appendChild(el('div', 'finding-item',
        issue.code.replaceAll('_', ' ') + ' — PDF page(s) ' + issue.pages.join(', ') +
        (issue.missingSequencePages?.length ? ', printed number(s) possibly missing: ' + issue.missingSequencePages.join(', ') : '')));
    }
  }
  if (preservation) {
    const assessed = (preservation.pages || []).filter(page => page.assessed).length;
    box.appendChild(el('div', 'finding-item',
      'Content-feature observations available: ' + assessed + '/' + (preservation.pages || []).length +
      ' pages; original paper not independently verified.'));
    for (const page of preservation.pages || []) {
      if (!page.assessed && !page.potentiallyBlank) continue;
      const features = Object.entries(page.features || {})
        .filter(([, value]) => value !== 'not-observed')
        .map(([type, value]) => type + ': ' + value).join('; ');
      box.appendChild(el('div', 'finding-item',
        'Page ' + page.pageNumber + ': ' + (features || 'no content feature reported') +
        '; edges ' + page.documentEdges +
        (page.potentiallyBlank ? '; potentially blank page' : '')));
    }
  }
  return box;
}

function createReviewFeedback(analysis) {
  const hash = analysis.analysisMetadata?.fileSha256;
  const section = el('div', 'review-feedback');
  section.appendChild(el('h4', '', 'Human Review Outcome'));
  section.appendChild(el('p', 'small-note', 'Your assessment is stored separately from the automated QA status. Paper-confirmed outcomes require an actual comparison with the paper source.'));
  if (!/^[0-9a-f]{64}$/i.test(String(hash || ''))) {
    section.appendChild(el('p', 'small-note', 'A file hash was not available; this result cannot be saved to the review log.'));
    return section;
  }
  const selector = el('select', 'review-outcome-select');
  const options = [
    ['', 'Select a review outcome'],
    ['no-defect-digital', 'No digitization defect seen — digital inspection'],
    ['model-false-positive', 'Suspected model false positive — digital inspection'],
    ['source-issue-confirmed', 'Source-paper issue confirmed — paper compared'],
    ['scan-defect-confirmed', 'Scanning defect confirmed — paper compared'],
    ['inconclusive', 'Inconclusive — further review needed']
  ];
  for (const [value, label] of options) {
    const option = el('option', '', label);
    option.value = value;
    selector.appendChild(option);
  }
  const save = el('button', 'btn btn-secondary', 'Save Review Outcome');
  save.type = 'button';
  const feedback = el('p', 'small-note', 'No human review outcome recorded for this file.');
  save.addEventListener('click', async () => {
    if (!selector.value) {
      showNotification('Select an outcome first.', 'warning');
      return;
    }
    try {
      const saved = await window.electronAPI.saveReviewDisposition({ fileSha256: hash, outcome: selector.value });
      analysis.manualDisposition = saved;
      feedback.textContent = 'Saved: ' + options.find(([key]) => key === saved.outcome)[1] + ' (' + saved.comparisonBasis + ').';
      showNotification('Review outcome saved locally.', 'success');
    } catch (_) {
      showNotification('Could not save the review outcome.', 'error');
    }
  });
  window.electronAPI.getReviewDisposition(hash).then(existing => {
    if (!existing) return;
    selector.value = existing.outcome;
    analysis.manualDisposition = existing;
    feedback.textContent = 'Previously recorded: ' +
      (options.find(([key]) => key === existing.outcome)?.[1] || existing.outcome) +
      ' (' + existing.comparisonBasis + ').';
  }).catch(() => {});
  section.append(selector, save, feedback);
  return section;
}

function createRecommendations(analysis) {
  const recommendations = analysis.recommendations || {};
  const groups = [
    ['Manual review', recommendations.manualReview],
    ['Compare with source', recommendations.compareWithSource],
    ['Rescan if needed', recommendations.rescanning]
  ];
  const populated = groups.filter(([, items]) => Array.isArray(items) && items.length);
  if (!populated.length) return null;

  const section = el('div', 'recommendations-section');
  section.appendChild(el('h4', '', 'Recommendations'));
  for (const [label, items] of populated) {
    for (const item of items) section.appendChild(el('div', 'recommendation-item', `${label}: ${item}`));
  }
  return section;
}

function createResultCard(result) {
  const analysis = result.analysis || {};
  const qa = analysis.qaAssessment || { status: 'analysis-failed', reason: 'No QA result available.' };
  const coverage = analysis.identifierCoverage || {};
  const linkage = analysis.pageLinkage || {};
  const card = el('div', 'result-card');

  const header = el('div', 'result-header');
  header.append(
    el('div', 'result-filename', analysis.fileInformation?.fileName || result.filename || 'Unknown'),
    el('div', `result-status ${qaClass(qa.status)}`, qaLabel(qa.status))
  );
  card.appendChild(header);

  const details = el('div', 'result-details');
  details.append(
    createDetail('Total Pages', analysis.fileInformation?.totalPages ?? 0),
    createDetail('Internal PDF Pagination', analysis.internalCompleteness?.status || 'Not assessed'),
    createDetail('Content Preservation', analysis.contentPreservation?.status || 'Not assessed'),
    createDetail('Identifier Coverage', Number.isFinite(coverage.coveragePercentage) ? `${coverage.coveragePercentage.toFixed(1)}%` : '0.0%'),
    createDetail('Continuation Pages', Array.isArray(linkage.continuationPages) ? linkage.continuationPages.length : 0),
    createDetail('Document Start Pages', Array.isArray(linkage.documentStartPages) ? linkage.documentStartPages.length : 0),
    createDetail('Unresolved Pages', Array.isArray(linkage.unresolvedPages) ? linkage.unresolvedPages.length : 0),
    createDetail('Pages Failed', coverage.pagesFailed ?? 0),
    createDetail('QA Status', qaLabel(qa.status))
  );
  card.appendChild(details);

  const reason = el('div', 'finding-section');
  reason.append(el('h5', '', 'Automated QA Assessment'), el('div', 'finding-item', qa.reason || 'No assessment reason available.'));
  card.appendChild(reason);

  const preservationSummary = createPreservationSummary(analysis);
  if (preservationSummary) card.appendChild(preservationSummary);

  const identifiers = el('div', 'finding-section');
  identifiers.appendChild(el('h5', '', 'Confirmed Patient Identifiers'));
  const names = analysis.patientIdentifiers?.names || [];
  const hospitalNumbers = analysis.patientIdentifiers?.hospitalNumbers || [];
  if (!names.length && !hospitalNumbers.length) identifiers.appendChild(el('div', 'finding-item', 'No high-confidence patient identifiers were extracted.'));
  names.forEach((name, index) => identifiers.appendChild(createMaskedFinding(`Patient name${names.length > 1 ? ` ${index + 1}` : ''}`, name, '••••••••••')));
  hospitalNumbers.forEach((id, index) => identifiers.appendChild(createMaskedFinding(`Hospital ID${hospitalNumbers.length > 1 ? ` ${index + 1}` : ''}`, id, '••••••')));
  card.appendChild(identifiers);

  const issues = analysis.summaryTable || [];
  if (issues.length) card.appendChild(createIssuesTable(issues));
  else card.appendChild(el('div', 'finding-item positive', 'No configured automated QA finding requires manual review.'));

  const informational = analysis.informationalTable || [];
  if (informational.length) card.appendChild(createInformationalTable(informational));

  const diagnostics = createModelDiagnostics(analysis);
  if (diagnostics) card.appendChild(diagnostics);
  const qualityEvidence = createQualityEvidence(analysis);
  if (qualityEvidence) card.appendChild(qualityEvidence);

  const recommendations = createRecommendations(analysis);
  if (recommendations) card.appendChild(recommendations);
  card.appendChild(createReviewFeedback(analysis));
  return card;
}

async function exportQaEvidence() {
  if (!analysisResults.length) {
    showNotification('Analyze PDF files first to generate evidence.', 'warning');
    return;
  }
  try {
    const response = await window.electronAPI.exportQaEvidence(analysisResults);
    if (response.success) showNotification('PHI-minimized QA evidence saved.', 'success');
  } catch (_) {
    showNotification('Could not export QA evidence.', 'error');
  }
}

let bulkSelected = false;
let bulkRunning = false;
function renderBulkProgress(p) {
  byId('bulk-processed').textContent = Number(p.processed || 0).toLocaleString('en-US');
  byId('bulk-skipped').textContent = Number(p.skippedFromCheckpoint || 0).toLocaleString('en-US');
  byId('bulk-review').textContent = Number(p.reviewRequired || 0).toLocaleString('en-US');
  byId('bulk-failed').textContent = Number(p.analysisFailed || 0).toLocaleString('en-US');
  byId('bulk-progress-note').textContent = 'PDFs discovered this session: ' + Number(p.filesSeen || 0).toLocaleString('en-US') +
    '. Pages processed: ' + Number(p.pagesProcessed || 0).toLocaleString('en-US') +
    '. Metered API usage this session: ' + dollar(p.meteredSpendUSD || 0, 4) +
    '. ' + (p.stopped ? 'Stopped after current file or configured limit. Select Start / Resume to continue.' : 'Checkpoint updated after each file.');
}
async function selectBulkFolder() {
  try {
    const result = await window.electronAPI.selectBulkFolder();
    if (!result?.selected) return;
    bulkSelected = true;
    byId('bulk-folder-label').textContent = 'PDF folder selected; source path is not stored in the batch checkpoint.';
    byId('bulk-start').disabled = false;
  } catch (_) {
    showNotification('Could not select a PDF folder.', 'error');
  }
}
async function startBulkAudit() {
  if (!bulkSelected || bulkRunning) return;
  const mode = analysisMode.value;
  if (mode !== 'local' && !hospitalApproved.checked) {
    showNotification('Confirm hospital authorization before cloud batch processing.', 'warning');
    return;
  }
  bulkRunning = true;
  byId('bulk-start').disabled = true;
  byId('bulk-folder').disabled = true;
  byId('bulk-stop').disabled = false;
  analyzeFilesBtn.disabled = true;
  analysisMode.disabled = true;
  byId('bulk-progress-note').textContent = 'Scanning the selected folder. Work is checkpointed after each PDF.';
  try {
    const maxFiles = Number(byId('bulk-max-files').value);
    const maxUsd = Number(byId('bulk-max-usd').value);
    if (!Number.isSafeInteger(maxFiles) || maxFiles < 1 || maxFiles > 1000000) {
      showNotification('Enter a valid per-session file limit.', 'warning');
      return;
    }
    if (mode !== 'local' && (!Number.isFinite(maxUsd) || maxUsd < 0.01 || maxUsd > 100000)) {
      showNotification('Enter a positive cloud API spending limit.', 'warning');
      return;
    }
    const result = await window.electronAPI.runBulkAudit({
      mode, hospitalApproved: hospitalApproved.checked,
      retryFailed: byId('bulk-retry-failed').checked,
      maxFiles, maxUsd
    });
    renderBulkProgress(result);
    showNotification(result.stopped ? 'Folder audit paused. You can resume it.' : 'Folder audit completed.', 'success');
  } catch (_) {
    showNotification('Folder audit stopped with an error. You can resume after resolving the issue.', 'error');
  } finally {
    bulkRunning = false;
    byId('bulk-start').disabled = false;
    byId('bulk-folder').disabled = false;
    byId('bulk-stop').disabled = true;
    analyzeFilesBtn.disabled = false;
    analysisMode.disabled = false;
    refreshCostDashboard().catch(() => {});
  }
}
async function stopBulkAudit() {
  byId('bulk-stop').disabled = true;
  await window.electronAPI.stopBulkAudit();
  byId('bulk-progress-note').textContent = 'Stop requested; current PDF will finish before the checkpoint is saved.';
}

async function exportToExcel() {
  if (!analysisResults.length) {
    showNotification('There are no results to export.', 'warning');
    return;
  }
  const confirmed = window.confirm('Excel export includes patient names and hospital numbers in clear text. Continue?');
  if (!confirmed) return;

  try {
    const result = await window.electronAPI.exportToExcel(analysisResults);
    if (result.success) showNotification('Excel export completed.', 'success');
    else if (!result.canceled) showNotification(`Export failed: ${result.error || 'Unknown error'}`, 'error');
  } catch (error) {
    showNotification(`Export failed: ${error.message}`, 'error');
  }
}

function setStatus(node, text, state) {
  node.textContent = text;
  node.className = `status-badge ${state}`;
}

async function updateStatusIndicators() {
  try {
    const status = await window.electronAPI.getBackendStatus();
    setStatus(backendStatus, status.status === 'running' ? 'Ready' : 'Error', status.status === 'running' ? 'connected' : 'error');
    if (analysisMode.value !== 'local') {
      const keyStatus = await window.electronAPI.getOpenAIKeyStatus();
      setStatus(ollamaStatus, keyStatus?.configured ? 'Cloud Key Set' : 'Cloud Key Missing',
        keyStatus?.configured ? 'connected' : 'warning');
    } else if (status.ollama !== 'connected') setStatus(ollamaStatus, 'Disconnected', 'error');
    else if (!status.models?.ocr || !status.models?.analysis) setStatus(ollamaStatus, 'Models Missing', 'warning');
    else setStatus(ollamaStatus, 'Connected', 'connected');
  } catch (_) {
    setStatus(backendStatus, 'Error', 'error');
    setStatus(ollamaStatus, 'Disconnected', 'error');
  }
}


function showCloudControls() {
  cloudSettings.hidden = analysisMode.value === 'local';
  refreshCostDashboard().catch(() => {});
}

function dollar(value, precision = 2) {
  const amount = Number(value);
  return String.fromCharCode(36) + (Number.isFinite(amount) ? amount : 0).toLocaleString('en-US', {
    minimumFractionDigits: precision, maximumFractionDigits: precision
  });
}
async function refreshCostDashboard() {
  const mode = analysisMode.value;
  const dashboard = await window.electronAPI.getCostDashboard(mode);
  const run = dashboard.run;
  byId('cost-spent').textContent = dollar(dashboard.recordedSpendUSD,
    dashboard.recordedSpendUSD < 0.01 ? 6 : 2);
  byId('cost-run-pages').textContent = run ? Number(run.totalPages).toLocaleString('en-US') : '—';
  byId('cost-run-spent').textContent = run ? dollar(run.recordedSpendUSD, 6) : '—';
  byId('cost-page').textContent = run ? dollar(run.forecastPerPageUSD, 6) : '—';
  byId('cost-total').textContent = run ? dollar(run.projectedTotalUSD, 6) : '—';
  byId('cost-basis').textContent = !run
    ? 'No run recorded yet. Analyze a PDF to calculate its page-based costs.'
    : 'Last run: ' + run.fileCount + ' file(s), ' + run.meteredPages + '/' + run.totalPages +
      ' pages with reported usage. ' +
      (run.pagesUnknown ? run.pagesUnknown + ' file(s) had unknown page count. ' : '') +
      (run.costBasis === 'observed-api-usage' ? 'Per-page estimate uses reported API usage. ' : 'Per-page estimate uses planning assumptions. ') +
      'Mode: ' + run.mode + '.';
  const selector = byId('forecast-selected-run');
  selector.replaceChildren();
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Choose a run (mode: ' + mode + ')';
  selector.appendChild(placeholder);
  for (const item of dashboard.runs || []) {
    if (item.mode !== mode) continue;
    const option = document.createElement('option');
    option.value = item.runId;
    const date = item.timestamp ? item.timestamp.slice(0, 16).replace('T', ' ') : 'Undated';
    option.textContent = date + ' — ' + Number(item.fileCount).toLocaleString('en-US') +
      ' file(s), ' + Number(item.totalPages).toLocaleString('en-US') +
      ' pages, ' + dollar(item.recordedSpendUSD, 6) +
      (item.fileRateAvailable ? '' : ' (insufficient metered data)');
    selector.appendChild(option);
  }
  selector.value = dashboard.plan.selectedRunId || '';
  if (selector.selectedIndex === -1) selector.value = '';
  const forecastSources = {
    'latest-run': 'latest recorded run in this model mode',
    'selected-run': 'only the chosen run; older runs excluded',
    'selected-run-unavailable': 'selected-run data unavailable; no historical fallback',
    'historical': 'historical average across matching runs',
    'historical-fallback': 'historical average because no comparable latest run exists',
    'planning-assumption': 'token-based assumptions (no comparable paid page data)',
    'local': 'local processing (no OpenAI API charges)'
  };
  const sourceText = forecastSources[dashboard.targetForecastSource] || 'available samples';
  byId('cost-target-projection').textContent = dashboard.targetPages === null
    ? 'Future-page forecast: none entered.'
    : dashboard.targetProjectionUSD === null
      ? 'For ' + Number(dashboard.targetPages).toLocaleString('en-US') +
        ' pages: unavailable. Choose a matching run with measured page usage.'
      : 'Optional ' + Number(dashboard.targetPages).toLocaleString('en-US') +
        '-page forecast (' + mode + '): ' + dollar(dashboard.targetProjectionUSD) +
        ' at ' + dollar(dashboard.targetForecastPerPageUSD, 8) + '/page using ' +
        sourceText + '.';
  const basis = dashboard.plan.forecastBasis;
  const fileSource = basis === 'historical'
    ? Number(dashboard.historicalFileCount || 0).toLocaleString('en-US') +
      ' fully metered files across comparable runs'
    : dashboard.forecastFileSample
      ? dashboard.forecastFileSample.fileCount + ' file(s), ' +
        dashboard.forecastFileSample.meteredPages + '/' +
        dashboard.forecastFileSample.totalPages + ' pages metered in the reference run'
      : 'no compatible reference run';
  byId('cost-target-files-projection').textContent = dashboard.targetFiles === null
    ? 'Future-file forecast: none entered. Enter a number of files to project.'
    : dashboard.targetFilesProjectionUSD === null
      ? 'For ' + Number(dashboard.targetFiles).toLocaleString('en-US') +
        ' files: cost unavailable. A recorded, matching run with usable file and page counts is needed; ' +
        'a page-only token estimate cannot establish pages per file.'
      : 'Optional ' + Number(dashboard.targetFiles).toLocaleString('en-US') +
        '-file forecast (' + mode + '): ' + dollar(dashboard.targetFilesProjectionUSD) +
        ' at ' + dollar(dashboard.targetForecastPerFileUSD, 8) + '/file based on ' +
        fileSource + '. ' +
        (dashboard.forecastFileSample?.estimatedUnmeteredPages
          ? 'Unmetered pages were estimated; verify results before budgeting. ' : '') +
        'This is not cumulative recorded spending.';
  return dashboard;
}
function setPlanInputs(plan) {
  for (const [key, input] of Object.entries(costFields)) {
    input.value = plan[key] === null ? '' : plan[key];
  }
}
async function configureApiKey() {
  const key = apiKeyField.value;
  try {
    await window.electronAPI.setOpenAIKey(key);
    apiKeyField.value = '';
    apiKeyStatus.textContent = 'API key configured for this session. Not saved to disk.';
    showNotification('OpenAI API key configured for this session.', 'success');
  } catch (_) {
    showNotification('Could not configure API key. Check the entered value.', 'error');
  }
}
async function clearApiKey() {
  await window.electronAPI.clearOpenAIKey();
  apiKeyField.value = '';
  apiKeyStatus.textContent = 'No API key configured. The key is not saved to disk.';
}
async function saveCostSettings() {
  const plan = {};
  for (const [key, input] of Object.entries(costFields)) {
    plan[key] = key === 'forecastBasis' || key === 'selectedRunId' ? input.value
      : input.value === '' ? null : Number(input.value);
  }
  try {
    await window.electronAPI.saveCostPlan(plan);
    const dashboard = await refreshCostDashboard();
    setPlanInputs(dashboard.plan);
    showNotification('Cost assumptions saved on this computer.', 'success');
  } catch (_) {
    showNotification('Could not save cost settings.', 'error');
  }
}
async function resetCostHistory() {
  try {
    const response = await window.electronAPI.resetCostHistory();
    if (!response?.cleared) return;
    const dashboard = await refreshCostDashboard();
    setPlanInputs(dashboard.plan);
    showNotification('Local cost history and forecast assumptions reset. Provider charges are unchanged.', 'success');
  } catch (_) {
    showNotification('Could not reset costs. Stop active scans before trying again.', 'error');
  }
}
analysisMode.addEventListener('change', showCloudControls);
byId('save-openai-key').addEventListener('click', configureApiKey);
byId('clear-openai-key').addEventListener('click', clearApiKey);
byId('save-cost-plan').addEventListener('click', saveCostSettings);
byId('reset-cost-history').addEventListener('click', resetCostHistory);
selectFilesBtn.addEventListener('click', handleFileSelection);
clearFilesBtn.addEventListener('click', () => {
  selectedFiles = [];
  updateFileList();
  selectedFilesDiv.style.display = 'none';
  fileUploadArea.style.display = 'block';
});
analyzeFilesBtn.addEventListener('click', analyzeSelectedFiles);
exportButton.addEventListener('click', exportToExcel);
byId('export-qa-evidence').addEventListener('click', exportQaEvidence);
byId('bulk-folder').addEventListener('click', selectBulkFolder);
byId('bulk-start').addEventListener('click', startBulkAudit);
byId('bulk-stop').addEventListener('click', stopBulkAudit);
window.electronAPI.onBulkProgress(renderBulkProgress);
fileUploadArea.addEventListener('dragover', event => {
  event.preventDefault();
  fileUploadArea.classList.add('dragover');
});
fileUploadArea.addEventListener('dragleave', () => fileUploadArea.classList.remove('dragover'));
fileUploadArea.addEventListener('drop', handleDrop);
fileUploadArea.addEventListener('click', event => {
  if (event.target === fileUploadArea) handleFileSelection();
});

document.addEventListener('DOMContentLoaded', () => {
  showLoading(false);
  selectedFilesDiv.style.display = 'none';
  resultsSection.style.display = 'none';
  showCloudControls();
  window.electronAPI.getOpenAIKeyStatus().then(status => {
    if (status?.configured) apiKeyStatus.textContent = 'API key configured for this session.';
  }).catch(() => {});
  refreshCostDashboard().then(data => setPlanInputs(data.plan)).catch(() => {
    byId('cost-basis').textContent = 'Could not load cost records.';
  });
  updateStatusIndicators();
  setInterval(updateStatusIndicators, 10000);
});
