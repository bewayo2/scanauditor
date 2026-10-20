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
  totalRecords: byId('project-records'),
  averagePagesPerRecord: byId('average-pages'),
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
    createDetail('Identifier Coverage', Number.isFinite(coverage.coveragePercentage) ? `${coverage.coveragePercentage.toFixed(1)}%` : '0.0%'),
    createDetail('Continuation Pages', Array.isArray(linkage.continuationPages) ? linkage.continuationPages.length : 0),
    createDetail('Unresolved Pages', Array.isArray(linkage.unresolvedPages) ? linkage.unresolvedPages.length : 0),
    createDetail('Pages Failed', coverage.pagesFailed ?? 0),
    createDetail('QA Status', qaLabel(qa.status))
  );
  card.appendChild(details);

  const reason = el('div', 'finding-section');
  reason.append(el('h5', '', 'Automated QA Assessment'), el('div', 'finding-item', qa.reason || 'No assessment reason available.'));
  card.appendChild(reason);

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

  const recommendations = createRecommendations(analysis);
  if (recommendations) card.appendChild(recommendations);
  return card;
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
    if (status.ollama !== 'connected') setStatus(ollamaStatus, 'Disconnected', 'error');
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
  const mode = analysisMode.value === 'astra' ? 'astra' : 'tiered';
  const dashboard = await window.electronAPI.getCostDashboard(mode);
  byId('cost-spent').textContent = dollar(dashboard.recordedSpendUSD, dashboard.recordedSpendUSD < 0.01 ? 6 : 2);
  byId('cost-page').textContent = dollar(dashboard.forecastPerPageUSD, 6);
  byId('cost-total').textContent = dollar(dashboard.projectedTotalUSD);
  byId('cost-pages').textContent = Number(dashboard.processedPages).toLocaleString('en-US') +
    ' / ' + Number(dashboard.plannedPages).toLocaleString('en-US');
  byId('cost-basis').textContent = (dashboard.costBasis === 'observed-api-usage'
    ? 'Forecast uses metered API token usage. '
    : 'Forecast uses planning token assumptions. ') +
    'Remaining projected: ' + dollar(dashboard.projectedRemainingUSD) +
    '. Recorded usage is not a reconciled invoice.';
  return dashboard;
}
function setPlanInputs(plan) {
  for (const [key, input] of Object.entries(costFields)) input.value = plan[key];
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
  for (const [key, input] of Object.entries(costFields)) plan[key] = Number(input.value);
  try {
    await window.electronAPI.saveCostPlan(plan);
    const dashboard = await refreshCostDashboard();
    setPlanInputs(dashboard.plan);
    showNotification('Project cost assumptions saved on this computer.', 'success');
  } catch (_) {
    showNotification('Could not save cost settings.', 'error');
  }
}
analysisMode.addEventListener('change', showCloudControls);
byId('save-openai-key').addEventListener('click', configureApiKey);
byId('clear-openai-key').addEventListener('click', clearApiKey);
byId('save-cost-plan').addEventListener('click', saveCostSettings);
selectFilesBtn.addEventListener('click', handleFileSelection);
clearFilesBtn.addEventListener('click', () => {
  selectedFiles = [];
  updateFileList();
  selectedFilesDiv.style.display = 'none';
  fileUploadArea.style.display = 'block';
});
analyzeFilesBtn.addEventListener('click', analyzeSelectedFiles);
exportButton.addEventListener('click', exportToExcel);
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
 + (Number.isFinite(amount) ? amount : 0).toLocaleString('en-US', {
    minimumFractionDigits: precision, maximumFractionDigits: precision
  });
}
async function refreshCostDashboard() {
  const mode = analysisMode.value === 'astra' ? 'astra' : 'tiered';
  const dashboard = await window.electronAPI.getCostDashboard(mode);
  byId('cost-spent').textContent = dollar(dashboard.recordedSpendUSD, dashboard.recordedSpendUSD < 0.01 ? 6 : 2);
  byId('cost-page').textContent = dollar(dashboard.forecastPerPageUSD, 6);
  byId('cost-total').textContent = dollar(dashboard.projectedTotalUSD);
  byId('cost-pages').textContent = Number(dashboard.processedPages).toLocaleString('en-US') +
    ' / ' + Number(dashboard.plannedPages).toLocaleString('en-US');
  byId('cost-basis').textContent = (dashboard.costBasis === 'observed-api-usage'
    ? 'Forecast uses metered API token usage (including fallback and benchmark calls). '
    : 'Forecast uses planning token assumptions. ') +
    'Remaining projected: ' + dollar(dashboard.projectedRemainingUSD) +
    '. Recorded usage is not a reconciled invoice.';
  return dashboard;
}
function setPlanInputs(plan) {
  for (const [key, input] of Object.entries(costFields)) {
    input.value = plan[key];
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
  for (const [key, input] of Object.entries(costFields)) plan[key] = Number(input.value);
  try {
    await window.electronAPI.saveCostPlan(plan);
    const dashboard = await refreshCostDashboard();
    setPlanInputs(dashboard.plan);
    showNotification('Project cost assumptions saved on this computer.', 'success');
  } catch (_) {
    showNotification('Could not save cost settings.', 'error');
  }
}
analysisMode.addEventListener('change', showCloudControls);
byId('save-openai-key').addEventListener('click', configureApiKey);
byId('clear-openai-key').addEventListener('click', clearApiKey);
byId('save-cost-plan').addEventListener('click', saveCostSettings);

selectFilesBtn.addEventListener('click', handleFileSelection);
clearFilesBtn.addEventListener('click', () => {
  selectedFiles = [];
  updateFileList();
  selectedFilesDiv.style.display = 'none';
  fileUploadArea.style.display = 'block';
});
analyzeFilesBtn.addEventListener('click', analyzeSelectedFiles);
exportButton.addEventListener('click', exportToExcel);
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
  updateStatusIndicators();
  setInterval(updateStatusIndicators, 10000);
});
