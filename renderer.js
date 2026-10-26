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
    refreshAuditProjects().catch(() => {});
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
  if (!analysis.workspaceDocumentId && !/^[0-9a-f]{64}$/i.test(String(hash || ''))) {
    section.appendChild(el('p', 'small-note', 'No indexed case ID or file hash is available for saving this review.'));
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
  const reviewer = el('input', 'review-outcome-select');
  reviewer.type = 'text';
  reviewer.maxLength = 120;
  reviewer.placeholder = 'Reviewer name or staff ID (not authenticated)';
  reviewer.setAttribute('aria-label', 'Reviewer name or staff ID (not authenticated)');
  const save = el('button', 'btn btn-secondary', 'Save Review Outcome');
  save.type = 'button';
  const feedback = el('p', 'small-note', 'No human review outcome recorded for this file.');
  save.addEventListener('click', async () => {
    if (!selector.value) {
      showNotification('Select an outcome first.', 'warning');
      return;
    }
    try {
      const saved = await window.electronAPI.saveReviewDisposition({
        fileSha256: hash, documentId: analysis.workspaceDocumentId || null,
        outcome: selector.value, reviewerLabel: reviewer.value.trim()
      });
      analysis.manualDisposition = saved;
      feedback.textContent = 'Saved: ' + options.find(([key]) => key === saved.outcome)[1] + ' (' + saved.comparisonBasis + ').';
      showNotification('Review outcome saved locally.', 'success');
      refreshAuditQueue().catch(() => {});
    } catch (_) {
      showNotification('Could not save the review outcome.', 'error');
    }
  });
  window.electronAPI.getReviewDisposition(hash, analysis.workspaceDocumentId || null).then(existing => {
    if (!existing) return;
    selector.value = existing.outcome;
    analysis.manualDisposition = existing;
    feedback.textContent = 'Previously recorded: ' +
      (options.find(([key]) => key === existing.outcome)?.[1] || existing.outcome) +
      ' (' + existing.comparisonBasis + ').';
  }).catch(() => {});
  section.append(selector, reviewer, save, feedback);
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
let bulkPreviewing = false;
let bulkRunning = false;
let bulkInventory = null;

function showBulkEstimate(info) {
  const files = Number(info.filesTotal);
  if (Number.isSafeInteger(files) && files >= 0) {
    byId('bulk-files-total').textContent = files.toLocaleString('en-US');
  }
  if (info.estimatedPages === null || !Number.isSafeInteger(info.estimatedPages)) {
    byId('bulk-pages-expected').textContent = 'Unknown';
  } else {
    byId('bulk-pages-expected').textContent =
      (info.estimateKind === 'exact-metadata' ? '' : '≈ ') +
      Number(info.estimatedPages).toLocaleString('en-US');
  }
  if (info.phase === 'ready' || info.phase === 'running' ||
      info.phase === 'processing' || info.phase === 'completed' || info.phase === 'stopped') {
    byId('bulk-estimate-note').textContent = info.estimatedPages === null
      ? 'Page-count estimate unavailable: PDF metadata in the sample could not be read. File scanning can still proceed.'
      : info.estimateKind === 'exact-metadata'
        ? 'Page total obtained from readable PDF metadata for all ' +
          Number(info.sampledFiles).toLocaleString('en-US') + ' file(s). This is not a guarantee of successful scan QA.'
        : 'Anticipated folder pages are approximate, based on ' +
          Number(info.sampledFiles || 0).toLocaleString('en-US') +
          ' sampled PDF(s)' + (info.sampleFailed ? ', ' + info.sampleFailed + ' unreadable sample(s)' : '') +
          '. Individual PDFs may differ greatly; actual page counts update as files finish.';
  }
}

function renderBulkProgress(progress) {
  if (!progress || typeof progress !== 'object') return;
  const phase = progress.phase || 'running';
  const meter = byId('bulk-progress-bar');
  const text = byId('bulk-progress-percentage');
  const current = byId('bulk-current');
  const note = byId('bulk-progress-note');
  showBulkEstimate(progress);
  const fmt = value => Number(value || 0).toLocaleString('en-US');

  if (phase === 'inventory') {
    byId('bulk-phase').textContent = 'Counting PDF files…';
    meter.removeAttribute('value');
    text.textContent = fmt(progress.filesTotal) + ' PDFs found so far';
    current.textContent = 'Searching selected folder and subfolders. No images are being analyzed.';
    return;
  }
  if (phase === 'sampling') {
    byId('bulk-phase').textContent = 'Estimating page count…';
    meter.removeAttribute('value');
    text.textContent = fmt((progress.sampledFiles || 0) + (progress.sampleFailed || 0)) +
      ' / ' + fmt(progress.sampleTarget) + ' sampled PDFs checked';
    current.textContent = 'Reading a small random sample of PDF page counts. This does not send files to AI.';
    return;
  }
  if (phase === 'canceled') {
    byId('bulk-phase').textContent = 'Inventory canceled';
    meter.value = 0;
    text.textContent = 'Stopped';
    current.textContent = 'Select the folder again to retry the inventory.';
    return;
  }
  if (phase === 'ready') {
    byId('bulk-phase').textContent = 'Folder inventoried — ready to scan';
    meter.value = 0;
    text.textContent = '0% of this batch';
    current.textContent = 'Found ' + fmt(progress.filesTotal) +
      ' PDFs. Review the anticipated page total and click Start / Resume Folder Audit.';
    return;
  }

  const processed = Number(progress.processed || 0);
  const target = Number(progress.sessionTarget || 0);
  const isComplete = phase === 'completed';
  const fraction = isComplete ? 100 : target > 0 ? Math.min(100, Math.round(100 * processed / target)) : 0;
  meter.value = fraction;
  text.textContent = fraction + '% of batch · ' + fmt(processed) +
    ' / ' + fmt(target) + ' new PDF(s)';
  byId('bulk-processed').textContent = fmt(processed);
  byId('bulk-skipped').textContent = fmt(progress.skippedFromCheckpoint);
  byId('bulk-review').textContent = fmt(progress.reviewRequired);
  byId('bulk-failed').textContent = fmt(progress.analysisFailed);
  byId('bulk-pages-done').textContent = fmt(progress.pagesProcessed);

  const descriptions = {
    running: 'Scanning PDFs',
    processing: 'Analyzing current PDF…',
    stopped: 'Stopped safely — resume available',
    completed: 'Folder audit completed'
  };
  byId('bulk-phase').textContent = descriptions[phase] || 'Scanning PDFs';
  current.textContent = phase === 'processing'
    ? 'Processing PDF ' + fmt(progress.currentFileNumber) + ' of ' +
      fmt(progress.filesTotal) + ' in this folder; page count updates when this PDF finishes.'
    : phase === 'stopped'
      ? 'Stopped after the current PDF or session limit. Re-select Start / Resume to continue.'
      : phase === 'completed'
        ? 'Reached the end of the folder. Files in checkpoints were not reprocessed.'
        : 'Checked ' + fmt(progress.filesSeen) + ' / ' +
          fmt(progress.filesTotal) + ' folder PDFs, including previously checkpointed files.';
  note.textContent = 'Actual pages processed this session: ' + fmt(progress.pagesProcessed) +
    ' · API usage in this session: ' + dollar(progress.meteredSpendUSD || 0, 4) +
    ' · ' + fmt(progress.skippedFromCheckpoint) + ' previously checkpointed PDF(s) skipped.';
}

async function selectBulkFolder() {
  if (bulkRunning || bulkPreviewing) return;
  try {
    const result = await window.electronAPI.selectBulkFolder();
    if (!result?.selected) return;
    bulkSelected = true;
    bulkInventory = null;
    // Show the requested full path only on this local screen, not in logs.
    byId('bulk-folder-label').textContent = result.path;
    byId('bulk-folder-label').title = result.path;
    byId('bulk-files-total').textContent = '—';
    byId('bulk-pages-expected').textContent = '—';
    byId('bulk-pages-done').textContent = '0';
    byId('bulk-processed').textContent = '0';
    byId('bulk-skipped').textContent = '0';
    byId('bulk-review').textContent = '0';
    byId('bulk-failed').textContent = '0';
    bulkPreviewing = true;
    byId('bulk-start').disabled = true;
    byId('bulk-folder').disabled = true;
    byId('bulk-stop').disabled = false;
    byId('bulk-phase').textContent = 'Counting PDF files…';
    byId('bulk-progress-note').textContent = 'Inventory in progress; this does not analyze pages or send PDF images externally.';
    const inventory = await window.electronAPI.inspectBulkFolder();
    bulkInventory = inventory.canceled ? null : inventory;
    if (inventory.canceled) {
      bulkSelected = false;
    } else if (inventory.filesTotal === 0) {
      byId('bulk-phase').textContent = 'No PDF files found';
      showNotification('The selected folder contains no PDF files.', 'warning');
    }
  } catch (_) {
    bulkSelected = false;
    byId('bulk-phase').textContent = 'Could not inventory folder';
    byId('bulk-current').textContent = 'Check folder access and select it again.';
    showNotification('Could not read the selected folder.', 'error');
  } finally {
    bulkPreviewing = false;
    byId('bulk-folder').disabled = false;
    byId('bulk-stop').disabled = true;
    byId('bulk-start').disabled = !bulkSelected || !bulkInventory || bulkInventory.filesTotal === 0;
  }
}
async function startBulkAudit() {
  if (!bulkSelected || bulkPreviewing || bulkRunning || !bulkInventory) return;
  const mode = analysisMode.value;
  if (mode !== 'local' && !hospitalApproved.checked) {
    showNotification('Confirm hospital authorization before cloud batch processing.', 'warning');
    return;
  }
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
  bulkRunning = true;
  byId('bulk-start').disabled = true;
  byId('bulk-folder').disabled = true;
  byId('bulk-stop').disabled = false;
  analyzeFilesBtn.disabled = true;
  analysisMode.disabled = true;
  renderBulkProgress({
    ...bulkInventory, phase: 'running', processed: 0, pagesProcessed: 0,
    skippedFromCheckpoint: 0, reviewRequired: 0, analysisFailed: 0,
    filesSeen: 0, sessionTarget: Math.min(maxFiles, bulkInventory.filesTotal)
  });
  try {
    const result = await window.electronAPI.runBulkAudit({
      mode, hospitalApproved: hospitalApproved.checked,
      retryFailed: byId('bulk-retry-failed').checked,
      maxFiles, maxUsd
    });
    renderBulkProgress(result);
    await refreshAuditProjects(result.projectId);
    showNotification(result.stopped ? 'Folder audit paused. You can resume it.' : 'Folder audit completed.', 'success');
  } catch (_) {
    byId('bulk-phase').textContent = 'Folder audit stopped unexpectedly';
    byId('bulk-current').textContent = 'Check local configuration or source-folder permissions, then resume.';
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
  byId('bulk-current').textContent = bulkPreviewing
    ? 'Canceling folder inventory after the current metadata check…'
    : 'Stop requested; current PDF will finish before the checkpoint is saved.';
}

// SQLite-backed workspace: bounded 50-row pages instead of loading an entire
// hospital archive into the renderer. Only the selected case is hydrated.
const auditQueueState = { page: 1, total: 0, limit: 50, detailId: null };
const queueFormat = x => Number(x || 0).toLocaleString('en-US');
function queueCell(row, text) {
  const cell = document.createElement('td');
  cell.textContent = String(text ?? '');
  row.appendChild(cell);
  return cell;
}
async function refreshAuditProjects(preferredId = null) {
  const projects = await window.electronAPI.auditListProjects();
  const selector = byId('audit-project');
  const previous = preferredId || selector.value;
  selector.replaceChildren();
  if (!projects.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No scans indexed yet';
    selector.appendChild(option);
    byId('audit-case-total').textContent = 'No audit records yet';
    byId('audit-queue-stats').textContent = 'Start a folder audit to create an indexed review project.';
    byId('audit-queue-rows').replaceChildren();
    return;
  }
  for (const project of projects) {
    const option = document.createElement('option');
    option.value = project.id;
    option.textContent = project.label + ' · ' + project.mode + ' · ' +
      queueFormat(project.document_count) + ' records';
    selector.appendChild(option);
  }
  selector.value = projects.some(p => p.id === previous) ? previous : projects[0].id;
  if (preferredId) {
    auditQueueState.page = 1;
    byId('audit-status-filter').value = 'review-required';
    byId('audit-review-filter').value = 'pending';
  }
  await refreshAuditQueue();
}
async function refreshAuditQueue() {
  const projectId = byId('audit-project').value;
  if (!projectId) return;
  const params = {
    projectId, page: auditQueueState.page, limit: auditQueueState.limit,
    status: byId('audit-status-filter').value,
    review: byId('audit-review-filter').value,
    search: byId('audit-search').value.trim(),
    findingCode: byId('audit-finding').value.trim().toUpperCase()
  };
  const [data, summary] = await Promise.all([
    window.electronAPI.auditListDocuments(params),
    window.electronAPI.auditSummary(projectId)
  ]);
  auditQueueState.total = data.total;
  const tbody = byId('audit-queue-rows');
  tbody.replaceChildren();
  if (!data.rows.length) {
    const tr = document.createElement('tr');
    const cell = queueCell(tr, 'No documents match the selected filters.');
    cell.colSpan = 7;
    tbody.appendChild(tr);
  }
  for (const item of data.rows) {
    const tr = document.createElement('tr');
    queueCell(tr, item.display_name);
    queueCell(tr, item.page_count);
    queueCell(tr, qaLabel(item.qa_status));
    queueCell(tr, item.finding_codes || '—');
    queueCell(tr, item.review_outcome
      ? item.review_outcome + ' (' + item.comparison_basis + ')' : 'Awaiting human review');
    queueCell(tr, item.open_actions);
    const cell = document.createElement('td');
    const button = el('button', 'btn btn-secondary', 'Inspect');
    button.type = 'button';
    button.addEventListener('click', () => openAuditDocument(item.id).catch(() =>
      showNotification('Could not open record details.', 'error')));
    cell.appendChild(button);
    tr.appendChild(cell);
    tbody.appendChild(tr);
  }
  byId('audit-case-total').textContent =
    queueFormat(summary.documents) + ' records · ' + queueFormat(summary.pages) +
    ' pages · ' + queueFormat(summary.pending_review) + ' awaiting review';
  byId('audit-queue-stats').textContent = queueFormat(summary.passed) +
    ' passed automated QA · ' + queueFormat(summary.review_required) +
    ' review-required · ' + queueFormat(summary.analysis_failed) +
    ' analysis failed · ' + queueFormat(summary.reviewed) + ' manual reviews recorded';
  const pages = Math.max(1, Math.ceil(data.total / data.limit));
  byId('audit-page-label').textContent = 'Page ' + data.page + ' of ' + pages +
    ' · ' + queueFormat(data.total) + ' matching records';
  byId('audit-previous').disabled = data.page <= 1;
  byId('audit-next').disabled = data.page >= pages;
}
function renderAuditHistory(record) {
  const box = byId('audit-record-history');
  box.replaceChildren();
  const header = el('h4', '', 'Human Review History');
  box.appendChild(header);
  if (!record.reviews?.length) {
    box.appendChild(el('p', 'small-note', 'No manual review has been recorded for this document.'));
  } else {
    const list = document.createElement('ul');
    for (const review of record.reviews) {
      const label = [review.timestamp, review.outcome, review.comparison_basis,
        review.reviewer_label ? 'Reviewer label: ' + review.reviewer_label : null]
        .filter(Boolean).join(' · ');
      list.appendChild(el('li', '', label));
    }
    box.appendChild(list);
  }
  if (record.actionHistory?.length) {
    box.appendChild(el('h4', '', 'Corrective Action History'));
    const events = document.createElement('ul');
    for (const event of record.actionHistory) {
      events.appendChild(el('li', '', event.timestamp + ' · ' + event.kind + ' · ' + event.status));
    }
    box.appendChild(events);
  }
  box.appendChild(el('h4', '', 'Corrective Actions'));
  const actions = byId('audit-record-actions');
  actions.replaceChildren();
  if (!record.actions?.length) {
    actions.appendChild(el('p', 'small-note', 'No corrective actions recorded.'));
  }
  for (const action of record.actions || []) {
    const line = el('div', 'audit-action-line');
    line.append(el('span', '', action.kind + ' · ' + action.status + ' · ' + action.created_at));
    if (action.status === 'open') {
      for (const [status, label] of [['completed', 'Complete'], ['canceled', 'Cancel']]) {
        const button = el('button', 'btn btn-secondary', label);
        button.type = 'button';
        button.addEventListener('click', async () => {
          try {
            await window.electronAPI.auditUpdateAction({ actionId: action.id, status });
            await openAuditDocument(record.id);
          } catch (_) { showNotification('Could not update the corrective action.', 'error'); }
        });
        line.appendChild(button);
      }
    }
    actions.appendChild(line);
  }
}
async function openAuditDocument(documentId) {
  const record = await window.electronAPI.auditGetDocument(documentId);
  if (!record) throw new Error('Document unavailable');
  auditQueueState.detailId = record.id;
  const detail = byId('audit-record-detail');
  detail.hidden = false;
  byId('audit-detail-heading').textContent =
    'Review: ' + record.display_name + ' (' + record.page_count + ' pages)';
  const analysis = record.analysis || {};
  analysis.workspaceDocumentId = record.id;
  analysis.manualDisposition = record.review_outcome
    ? { outcome: record.review_outcome, comparisonBasis: record.comparison_basis } : null;
  byId('audit-record-content').replaceChildren(createResultCard({ analysis }));
  renderAuditHistory(record);
  detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
async function auditAction(kind) {
  if (!auditQueueState.detailId) return;
  try {
    await window.electronAPI.auditCreateAction({ documentId: auditQueueState.detailId, kind });
    await openAuditDocument(auditQueueState.detailId);
    await refreshAuditQueue();
    showNotification('Corrective action added to this case.', 'success');
  } catch (_) {
    showNotification('Could not create corrective action.', 'error');
  }
}
async function reanalyzeSelectedCase() {
  const id = auditQueueState.detailId;
  if (!id) return;
  if (!window.confirm('Reanalyze this PDF? The result and API spend may change. Earlier evidence and review events remain on record.')) return;
  try {
    byId('audit-reanalyze').disabled = true;
    await window.electronAPI.auditReanalyzeDocument({
      documentId: id, hospitalApproved: hospitalApproved.checked
    });
    await openAuditDocument(id);
    await refreshAuditQueue();
    refreshCostDashboard().catch(() => {});
    showNotification('Document reanalysis completed; current results updated.', 'success');
  } catch (_) {
    showNotification('Could not reanalyze the record. Check local source and authorization.', 'error');
  } finally {
    byId('audit-reanalyze').disabled = false;
  }
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
  byId('cost-run-summary').textContent = !run
    ? 'No scans recorded yet'
    : Number(run.totalPages).toLocaleString('en-US') + ' pages (' +
      Number(run.fileCount).toLocaleString('en-US') + ' PDF file(s)) · ' +
      dollar(run.recordedSpendUSD, 6) + ' (' + run.mode + ')';
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
    option.textContent = date + ' — ' + Number(item.totalPages).toLocaleString('en-US') +
      ' pages (' + Number(item.fileCount).toLocaleString('en-US') + ' file(s)), ' +
      dollar(item.recordedSpendUSD, 6) +
      (mode !== 'local' && !item.meteredPages ? ' (no metered page usage)' : '');
    selector.appendChild(option);
  }
  selector.value = dashboard.plan.selectedRunId || '';
  if (selector.selectedIndex === -1) selector.value = '';
  syncCostRunSelector();
  const forecastSources = {
    'latest-run': 'the latest matching scan',
    'selected-run': 'only the selected scan run',
    'selected-run-unavailable': 'no matching metered run selected',
    'historical': 'the page-weighted historical average',
    'historical-fallback': 'the page-weighted historical average (latest run lacked usage)',
    'planning-assumption': 'token-based planning assumptions (no metered page sample)',
    'local': 'local processing (no OpenAI API charges)'
  };
  const amount = byId('cost-page-estimate');
  const description = byId('cost-target-projection');
  if (dashboard.targetPages === null) {
    amount.textContent = '—';
    description.textContent = 'Enter the total number of scanned pages, then click Estimate Cost.';
  } else if (dashboard.targetProjectionUSD === null) {
    amount.textContent = 'Estimate unavailable';
    description.textContent = 'No usable metered page data for the selected run. Choose another scan in Advanced Options or collect a new sample. Calculating never incurs an API charge.';
  } else {
    const source = forecastSources[dashboard.targetForecastSource] || 'available sample data';
    const count = Number(dashboard.targetPages).toLocaleString('en-US');
    const perPage = dollar(dashboard.targetForecastPerPageUSD, 8);
    let sample = '';
    if (['latest-run', 'selected-run'].includes(dashboard.targetForecastSource) &&
        dashboard.forecastFileSample) {
      const reference = dashboard.forecastFileSample;
      sample = ' Reference: ' + Number(reference.meteredPages).toLocaleString('en-US') +
        ' metered pages in a ' + Number(reference.totalPages).toLocaleString('en-US') +
        '-page scan run.';
    } else if (['historical', 'historical-fallback'].includes(dashboard.targetForecastSource)) {
      sample = ' Historical sample: ' + Number(dashboard.historicalMeteredPages).toLocaleString('en-US') +
        ' metered page-runs across ' + Number(dashboard.historicalMeteredRuns).toLocaleString('en-US') +
        ' runs.';
    }
    amount.textContent = dollar(dashboard.targetProjectionUSD);
    description.textContent = count + ' pages × ' + perPage + ' per page, based on ' +
      source + '.' + sample + ' This is a forecast, not an API charge.';
  }
  return dashboard;
}
function syncCostRunSelector() {
  const basis = byId('forecast-basis').value;
  byId('cost-run-selector').hidden = basis !== 'selected-run';
}
function setPlanInputs(plan) {
  for (const [key, input] of Object.entries(costFields)) {
    input.value = plan[key] === null ? '' : plan[key];
  }
  syncCostRunSelector();
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
  const pageInput = byId('forecast-target-pages');
  if (!pageInput.value || !Number.isSafeInteger(Number(pageInput.value)) ||
      Number(pageInput.value) < 1 || Number(pageInput.value) > 100000000) {
    showNotification('Enter a whole number of pages between 1 and 100,000,000.', 'warning');
    pageInput.focus();
    return;
  }
  const plan = {};
  for (const [key, input] of Object.entries(costFields)) {
    plan[key] = key === 'forecastBasis' || key === 'selectedRunId' ? input.value
      : input.value === '' ? null : Number(input.value);
  }
  // Migration from older file-based forecasts: keep the cost ledger, but
  // clear any outdated file-count target whenever new page settings are saved.
  plan.targetFiles = null;
  try {
    await window.electronAPI.saveCostPlan(plan);
    const dashboard = await refreshCostDashboard();
    setPlanInputs(dashboard.plan);
    showNotification('Estimate updated. Forecast settings saved on this computer.', 'success');
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
byId('forecast-basis').addEventListener('change', syncCostRunSelector);
byId('forecast-target-pages').addEventListener('keydown', event => {
  if (event.key === 'Enter') saveCostSettings();
});
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
byId('audit-refresh').addEventListener('click', () => refreshAuditProjects().catch(() =>
  showNotification('Could not refresh audit cases.', 'error')));
byId('audit-search-button').addEventListener('click', () => {
  auditQueueState.page = 1;
  refreshAuditQueue().catch(() => showNotification('Could not filter cases.', 'error'));
});
byId('audit-project').addEventListener('change', () => {
  auditQueueState.page = 1;
  refreshAuditQueue().catch(() => {});
});
for (const id of ['audit-status-filter', 'audit-review-filter']) {
  byId(id).addEventListener('change', () => {
    auditQueueState.page = 1;
    refreshAuditQueue().catch(() => {});
  });
}
for (const id of ['audit-search', 'audit-finding']) {
  byId(id).addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      auditQueueState.page = 1;
      refreshAuditQueue().catch(() => {});
    }
  });
}
byId('audit-next').addEventListener('click', () => {
  auditQueueState.page += 1;
  refreshAuditQueue().catch(() => { auditQueueState.page -= 1; });
});
byId('audit-previous').addEventListener('click', () => {
  auditQueueState.page = Math.max(1, auditQueueState.page - 1);
  refreshAuditQueue().catch(() => {});
});
byId('audit-export-summary').addEventListener('click', async () => {
  const projectId = byId('audit-project').value;
  if (!projectId) return;
  try {
    const result = await window.electronAPI.auditExportSummary(projectId);
    if (!result.canceled) showNotification('Exported ' + queueFormat(result.rows) + ' indexed records.', 'success');
  } catch (_) { showNotification('Could not export the audit project.', 'error'); }
});
byId('audit-backup').addEventListener('click', async () => {
  try {
    const result = await window.electronAPI.auditBackupDatabase();
    if (!result.canceled) showNotification('Private SQLite audit backup saved to the selected location.', 'success');
  } catch (_) { showNotification('Could not back up the audit database.', 'error'); }
});
byId('audit-export-evidence').addEventListener('click', async () => {
  if (!auditQueueState.detailId) return;
  try {
    const result = await window.electronAPI.auditExportEvidence(auditQueueState.detailId);
    if (result.saved) showNotification('QA evidence exported for the selected record.', 'success');
  } catch (_) { showNotification('Could not export the selected record.', 'error'); }
});
byId('audit-close-detail').addEventListener('click', () => {
  byId('audit-record-detail').hidden = true;
  auditQueueState.detailId = null;
  byId('audit-workspace').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
byId('audit-open-pdf').addEventListener('click', async () => {
  try { await window.electronAPI.auditOpenPdf(auditQueueState.detailId); }
  catch (_) { showNotification('Original PDF is unavailable or could not be opened.', 'error'); }
});
byId('audit-rescan-task').addEventListener('click', () => auditAction('rescan'));
byId('audit-paper-task').addEventListener('click', () => auditAction('paper-comparison'));
byId('audit-reanalyze').addEventListener('click', reanalyzeSelectedCase);
byId('bulk-review-queue').addEventListener('click', async () => {
  try { await refreshAuditProjects(); byId('audit-workspace').scrollIntoView({ behavior: 'smooth' }); }
  catch (_) { showNotification('Could not load the review queue.', 'error'); }
});
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
  refreshAuditProjects().catch(() => { byId('audit-case-total').textContent = 'Workspace unavailable; verify Python installation.'; });
  refreshCostDashboard().then(data => setPlanInputs(data.plan)).catch(() => {
    byId('cost-basis').textContent = 'Could not load cost records.';
  });
  updateStatusIndicators();
  setInterval(updateStatusIndicators, 10000);
});
