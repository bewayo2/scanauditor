// Global state
let selectedFiles = [];
let analysisResults = [];

// DOM elements
const selectFilesBtn = document.getElementById('select-files-btn');
const clearFilesBtn = document.getElementById('clear-files-btn');
const analyzeFilesBtn = document.getElementById('analyze-files-btn');
const fileUploadArea = document.getElementById('file-upload-area');
const selectedFilesDiv = document.getElementById('selected-files');
const fileList = document.getElementById('file-list');
const resultsSection = document.getElementById('results-section');
const resultsSummary = document.getElementById('results-summary');
const resultsDetails = document.getElementById('results-details');
const loadingOverlay = document.getElementById('loading-overlay');
const backendStatus = document.getElementById('backend-status');
const ollamaStatus = document.getElementById('ollama-status');

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
    setupEventListeners();
    startStatusPolling();
});

// Initialize the application
const initializeApp = () => {
    console.log('ScanAuditor initialized');
    updateStatusIndicators();
};

// Setup event listeners
const setupEventListeners = () => {
    selectFilesBtn.addEventListener('click', handleFileSelection);
    clearFilesBtn.addEventListener('click', clearSelectedFiles);
    analyzeFilesBtn.addEventListener('click', analyzeSelectedFiles);
    
    // Drag and drop functionality
    fileUploadArea.addEventListener('dragover', handleDragOver);
    fileUploadArea.addEventListener('drop', handleFileDrop);
    fileUploadArea.addEventListener('dragenter', handleDragEnter);
    fileUploadArea.addEventListener('dragleave', handleDragLeave);
};

// File selection handler
const handleFileSelection = async () => {
    try {
        const filePaths = await window.electronAPI.selectFiles();
        if (filePaths && filePaths.length > 0) {
            addFilesToSelection(filePaths);
        }
    } catch (error) {
        console.error('Error selecting files:', error);
        showNotification('Error selecting files', 'error');
    }
};

// Add files to selection
const addFilesToSelection = (filePaths) => {
    filePaths.forEach(filePath => {
        const fileName = filePath.split(/[\\/]/).pop();
        const file = {
            path: filePath,
            name: fileName,
            size: 0 // We'll get this from the file object later
        };
        
        if (!selectedFiles.find(f => f.path === filePath)) {
            selectedFiles.push(file);
        }
    });
    
    updateFileList();
    showSelectedFiles();
};

// Update file list display
const updateFileList = () => {
    fileList.innerHTML = '';
    
    selectedFiles.forEach((file, index) => {
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';
        
        fileItem.innerHTML = `
            <div class="file-info">
                <i class="fas fa-file-alt file-icon"></i>
                <div>
                    <div class="file-name">${file.name}</div>
                    <div class="file-size">${formatFileSize(file.size)}</div>
                </div>
            </div>
            <button class="btn btn-secondary" onclick="removeFile(${index})">
                <i class="fas fa-times"></i>
            </button>
        `;
        
        fileList.appendChild(fileItem);
    });
};

// Remove file from selection
const removeFile = (index) => {
    selectedFiles.splice(index, 1);
    updateFileList();
    
    if (selectedFiles.length === 0) {
        hideSelectedFiles();
    }
};

// Clear all selected files
const clearSelectedFiles = () => {
    selectedFiles = [];
    updateFileList();
    hideSelectedFiles();
};

// Show selected files section
const showSelectedFiles = () => {
    selectedFilesDiv.style.display = 'block';
    fileUploadArea.style.display = 'none';
};

// Hide selected files section
const hideSelectedFiles = () => {
    selectedFilesDiv.style.display = 'none';
    fileUploadArea.style.display = 'block';
};

// Analyze selected files
const analyzeSelectedFiles = async () => {
    if (selectedFiles.length === 0) {
        showNotification('No files selected for analysis', 'warning');
        return;
    }
    
    try {
        showLoading(true);
        
        // Convert file paths to File objects
        const files = await Promise.all(
            selectedFiles.map(async (fileInfo) => {
                const response = await fetch(`file://${fileInfo.path}`);
                const blob = await response.blob();
                return new File([blob], fileInfo.name, { type: blob.type });
            })
        );
        
        // Send files for analysis
        const response = await window.electronAPI.analyzeFiles(files);
        
        if (response.results) {
            analysisResults = response.results;
            displayResults();
            showNotification(`Analysis completed for ${selectedFiles.length} files`, 'success');
        } else {
            throw new Error('No results received from analysis');
        }
        
    } catch (error) {
        console.error('Analysis error:', error);
        showNotification('Error during analysis: ' + error.message, 'error');
    } finally {
        showLoading(false);
    }
};

// Display analysis results
const displayResults = () => {
    displayResultsSummary();
    displayResultsDetails();
    resultsSection.style.display = 'block';
    
    // Scroll to results
    resultsSection.scrollIntoView({ behavior: 'smooth' });
};

// Display results summary
const displayResultsSummary = () => {
    const totalFiles = analysisResults.length;
    const singlePatientFiles = analysisResults.filter(r => 
        !r.analysis.multiplePatients
    ).length;
    const multiplePatientFiles = totalFiles - singlePatientFiles;
    const totalHospitalNumbers = analysisResults.reduce((sum, r) => 
        sum + (r.analysis.uniqueHospitalNumbers ? r.analysis.uniqueHospitalNumbers.length : 0), 0);
    
    resultsSummary.innerHTML = `
        <div class="summary-stats">
            <div class="stat-card">
                <div class="stat-number">${totalFiles}</div>
                <div class="stat-label">Total Files</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${singlePatientFiles}</div>
                <div class="stat-label">Single Patient</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${multiplePatientFiles}</div>
                <div class="stat-label">Multiple Patients</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${totalHospitalNumbers}</div>
                <div class="stat-label">Total Hospital Numbers</div>
            </div>
        </div>
    `;
};

// Display results details
const displayResultsDetails = () => {
    resultsDetails.innerHTML = '';
    
    analysisResults.forEach((result, index) => {
        const resultCard = document.createElement('div');
        resultCard.className = 'result-card';
        
        const analysis = result.analysis;
        
        // Handle new format with pagesWithHospitalNumbers
        if (analysis.pagesWithHospitalNumbers !== undefined) {
            // New format - page-by-page hospital number analysis
            const hasMultiplePatients = analysis.multiplePatients || false;
            const hasIssues = analysis.issues && analysis.issues.length > 0;
            const statusClass = hasMultiplePatients ? 'fail' : 'pass';
            const statusText = hasMultiplePatients ? 'Multiple Patients Detected' : 'Single Patient';
            
            // Build pages with hospital numbers display - grouped by hospital number
            let pagesDisplay = '';
            if (analysis.pagesWithHospitalNumbers && analysis.pagesWithHospitalNumbers.length > 0) {
                // Group pages by hospital number
                const hospitalNumberPages = {};
                analysis.pagesWithHospitalNumbers.forEach(page => {
                    page.hospitalNumbers.forEach(hn => {
                        if (!hospitalNumberPages[hn]) {
                            hospitalNumberPages[hn] = [];
                        }
                        hospitalNumberPages[hn].push(page.pageNumber);
                    });
                });
                
                // Sort pages for each hospital number
                Object.keys(hospitalNumberPages).forEach(hn => {
                    hospitalNumberPages[hn].sort((a, b) => a - b);
                });
                
                // Create display
                pagesDisplay = Object.entries(hospitalNumberPages).map(([hospitalNumber, pages]) => 
                    `<div class="page-item"><strong>Hospital #${hospitalNumber}</strong>: Pages ${pages.join(', ')}</div>`
                ).join('');
            } else {
                pagesDisplay = '<div class="page-item">No hospital numbers found</div>';
            }
            
            resultCard.innerHTML = `
                <div class="result-header">
                    <div class="result-filename">${result.filename}</div>
                    <div class="result-status ${statusClass}">${statusText}</div>
                </div>
                <div class="result-details">
                    <div class="detail-item">
                        <div class="detail-label">Total Pages Analyzed</div>
                        <div class="detail-value">${analysis.totalPagesAnalyzed || 'Unknown'}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">Unique Hospital Numbers</div>
                        <div class="detail-value">${analysis.uniqueHospitalNumbers ? analysis.uniqueHospitalNumbers.join(', ') : 'None'}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">Multiple Patients</div>
                        <div class="detail-value ${hasMultiplePatients ? 'true' : 'false'}">
                            ${hasMultiplePatients ? 'Yes' : 'No'}
                        </div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">Total Hospital Numbers Found</div>
                        <div class="detail-value">${analysis.uniqueHospitalNumbers ? analysis.uniqueHospitalNumbers.length : 0}</div>
                    </div>
                </div>
                <div class="pages-list">
                    <h4>Pages with Hospital Numbers</h4>
                    ${pagesDisplay}
                </div>
                ${hasIssues ? `
                    <div class="issues-list">
                        <h4>Issues Found</h4>
                        ${analysis.issues.map(issue => `
                            <div class="issue-item">${issue}</div>
                        `).join('')}
                    </div>
                ` : ''}
            `;
        } else {
            // Old format - backward compatibility
            const hasIssues = analysis.issues && analysis.issues.length > 0;
            const isPass = analysis.filenameMatch && analysis.singlePatient && analysis.onePatientOnly;
            const statusClass = isPass ? 'pass' : hasIssues ? 'fail' : 'warning';
            const statusText = isPass ? 'Pass' : hasIssues ? 'Fail' : 'Warning';
            
            resultCard.innerHTML = `
                <div class="result-header">
                    <div class="result-filename">${result.filename}</div>
                    <div class="result-status ${statusClass}">${statusText}</div>
                </div>
                <div class="result-details">
                    <div class="detail-item">
                        <div class="detail-label">Patient Name</div>
                        <div class="detail-value">${analysis.patientName || 'Not found'}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">Filename Match</div>
                        <div class="detail-value ${analysis.filenameMatch ? 'true' : 'false'}">
                            ${analysis.filenameMatch ? 'Yes' : 'No'}
                        </div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">Single Patient</div>
                        <div class="detail-value ${analysis.singlePatient ? 'true' : 'false'}">
                            ${analysis.singlePatient ? 'Yes' : 'No'}
                        </div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">One Patient Only</div>
                        <div class="detail-value ${analysis.onePatientOnly ? 'true' : 'false'}">
                            ${analysis.onePatientOnly ? 'Yes' : 'No'}
                        </div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">Confidence</div>
                        <div class="detail-value">${((analysis.confidence || 0) * 100).toFixed(1)}%</div>
                    </div>
                </div>
                ${hasIssues ? `
                    <div class="issues-list">
                        <h4>Issues Found</h4>
                        ${analysis.issues.map(issue => `
                            <div class="issue-item">${issue}</div>
                        `).join('')}
                    </div>
                ` : ''}
            `;
        }
        
        resultsDetails.appendChild(resultCard);
    });
};

// Drag and drop handlers
const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    fileUploadArea.classList.add('drag-over');
};

const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    fileUploadArea.classList.add('drag-over');
};

const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    fileUploadArea.classList.remove('drag-over');
};

const handleFileDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    fileUploadArea.classList.remove('drag-over');
    
    const files = Array.from(e.dataTransfer.files);
    const filePaths = files.map(file => file.path);
    
    if (filePaths.length > 0) {
        addFilesToSelection(filePaths);
    }
};

// Status polling
const startStatusPolling = () => {
    setInterval(updateStatusIndicators, 5000); // Poll every 5 seconds
};

// Update status indicators
const updateStatusIndicators = async () => {
    try {
        const status = await window.electronAPI.getBackendStatus();
        
        // Update backend status
        backendStatus.textContent = status.status === 'running' ? 'Connected' : 'Disconnected';
        backendStatus.className = `status-badge ${status.status === 'running' ? 'connected' : 'disconnected'}`;
        
        // Update Ollama status
        ollamaStatus.textContent = status.ollama === 'connected' ? 'Connected' : 'Disconnected';
        ollamaStatus.className = `status-badge ${status.ollama === 'connected' ? 'connected' : 'disconnected'}`;
        
    } catch (error) {
        console.error('Status update error:', error);
        backendStatus.textContent = 'Error';
        backendStatus.className = 'status-badge disconnected';
        ollamaStatus.textContent = 'Error';
        ollamaStatus.className = 'status-badge disconnected';
    }
};

// Loading overlay
const showLoading = (show) => {
    loadingOverlay.style.display = show ? 'flex' : 'none';
};

// Utility functions
const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// Notification system
const showNotification = (message, type = 'info') => {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <div class="notification-content">
            <i class="fas fa-${getNotificationIcon(type)}"></i>
            <span>${message}</span>
        </div>
    `;
    
    // Add styles
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${getNotificationColor(type)};
        color: white;
        padding: 1rem 1.5rem;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        z-index: 1001;
        transform: translateX(100%);
        transition: transform 0.3s ease;
        max-width: 400px;
    `;
    
    document.body.appendChild(notification);
    
    // Animate in
    setTimeout(() => {
        notification.style.transform = 'translateX(0)';
    }, 100);
    
    // Remove after 5 seconds
    setTimeout(() => {
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => {
            document.body.removeChild(notification);
        }, 300);
    }, 5000);
};

const getNotificationIcon = (type) => {
    switch (type) {
        case 'success': return 'check-circle';
        case 'error': return 'exclamation-circle';
        case 'warning': return 'exclamation-triangle';
        default: return 'info-circle';
    }
};

const getNotificationColor = (type) => {
    switch (type) {
        case 'success': return '#38a169';
        case 'error': return '#e53e3e';
        case 'warning': return '#d69e2e';
        default: return '#3182ce';
    }
}; 