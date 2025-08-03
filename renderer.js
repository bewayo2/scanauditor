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
        console.log('Opening file selection dialog...');
        const filePaths = await window.electronAPI.selectFiles();
        console.log('Selected files:', filePaths);
        
        if (filePaths && filePaths.length > 0) {
            addFilesToSelection(filePaths);
            showNotification(`Selected ${filePaths.length} file(s)`, 'success');
        } else {
            showNotification('No files selected', 'info');
        }
    } catch (error) {
        console.error('Error selecting files:', error);
        showNotification('Error selecting files: ' + error.message, 'error');
    }
};

// Add files to selection
const addFilesToSelection = (filePaths) => {
    console.log('Adding files to selection:', filePaths);
    
    let addedCount = 0;
    filePaths.forEach(filePath => {
        const fileName = filePath.split(/[\\/]/).pop();
        const file = {
            path: filePath,
            name: fileName,
            size: 0 // We'll get this from the file object later
        };
        
        if (!selectedFiles.find(f => f.path === filePath)) {
            selectedFiles.push(file);
            addedCount++;
            console.log('Added file:', fileName);
        } else {
            console.log('File already selected:', fileName);
        }
    });
    
    console.log(`Added ${addedCount} new files. Total selected: ${selectedFiles.length}`);
    updateFileList();
    showSelectedFiles();
};

// Add dropped files to selection (for drag and drop)
const addDroppedFilesToSelection = (files) => {
    console.log('Adding dropped files to selection:', files);
    
    let addedCount = 0;
    files.forEach(file => {
        const fileInfo = {
            path: file.name, // Use name as path for dropped files
            name: file.name,
            size: file.size,
            file: file // Store the actual file object
        };
        
        if (!selectedFiles.find(f => f.name === file.name)) {
            selectedFiles.push(fileInfo);
            addedCount++;
            console.log('Added dropped file:', file.name);
        } else {
            console.log('Dropped file already selected:', file.name);
        }
    });
    
    console.log(`Added ${addedCount} new dropped files. Total selected: ${selectedFiles.length}`);
    updateFileList();
    showSelectedFiles();
};

// Add more files function
const addMoreFiles = () => {
    handleFileSelection();
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
    
    // Add "Add More Files" button
    const addMoreButton = document.createElement('div');
    addMoreButton.className = 'add-more-files';
    addMoreButton.innerHTML = `
        <button class="btn btn-primary" onclick="addMoreFiles()">
            <i class="fas fa-plus"></i> Add More Files
        </button>
    `;
    fileList.appendChild(addMoreButton);
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
                if (fileInfo.file) {
                    // This is a dropped file, use the stored File object
                    return fileInfo.file;
                } else {
                    // This is a selected file path, convert to File object
                    const response = await fetch(`file://${fileInfo.path}`);
                    const blob = await response.blob();
                    return new File([blob], fileInfo.name, { type: blob.type });
                }
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
    const safeFiles = analysisResults.filter(r => 
        r.analysis.safetyAssessment && r.analysis.safetyAssessment.safeForUse
    ).length;
    const unsafeFiles = totalFiles - safeFiles;
    const totalIssues = analysisResults.reduce((sum, r) => 
        sum + (r.analysis.summaryTable ? r.analysis.summaryTable.length : 0), 0);
    
    resultsSummary.innerHTML = `
        <div class="summary-stats">
            <div class="stat-card">
                <div class="stat-number">${totalFiles}</div>
                <div class="stat-label">Total Files</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${safeFiles}</div>
                <div class="stat-label">Safe for Use</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${unsafeFiles}</div>
                <div class="stat-label">Needs Review</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${totalIssues}</div>
                <div class="stat-label">Total Issues</div>
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
        
        // Handle comprehensive analysis format
        if (analysis.fileInformation) {
            // New comprehensive format
            const isSafe = analysis.safetyAssessment && analysis.safetyAssessment.safeForUse;
            const statusClass = isSafe ? 'pass' : 'fail';
            const statusText = isSafe ? 'Safe for Use' : 'Needs Review';
            const riskLevel = analysis.safetyAssessment ? analysis.safetyAssessment.riskLevel : 'unknown';
            
            // Build summary table
            let summaryTableHtml = '';
            if (analysis.summaryTable && analysis.summaryTable.length > 0) {
                summaryTableHtml = `
                    <div class="summary-table">
                        <h4>Summary of Issues</h4>
                        <table>
                            <thead>
                                <tr>
                                    <th>Issue Type</th>
                                    <th>Count</th>
                                    <th>Pages Affected</th>
                                    <th>Description</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${analysis.summaryTable.map(issue => `
                                    <tr>
                                        <td>${issue.issueType}</td>
                                        <td>${issue.count}</td>
                                        <td>${issue.pagesAffected}</td>
                                        <td>${issue.description || ''}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                `;
            }
            
            // Build detailed findings
            let detailedFindingsHtml = '';
            if (analysis.detailedFindings) {
                const findings = analysis.detailedFindings;
                
                // Collect all positive findings
                const allPositiveFindings = [];
                
                // Image quality findings
                if (findings.imageQualityIssues && findings.imageQualityIssues.positiveFindings) {
                    allPositiveFindings.push(...findings.imageQualityIssues.positiveFindings);
                }
                
                // Page sequence findings
                if (findings.pageSequence && findings.pageSequence.positiveFindings) {
                    allPositiveFindings.push(...findings.pageSequence.positiveFindings);
                }
                
                // Data extraction findings
                if (findings.dataExtraction && findings.dataExtraction.positiveFindings) {
                    allPositiveFindings.push(...findings.dataExtraction.positiveFindings);
                }
                
                // Display positive findings
                if (allPositiveFindings.length > 0) {
                    const positiveFindingsHtml = allPositiveFindings.map(finding => {
                        // Handle both string and object formats
                        if (typeof finding === 'string') {
                            return `<div class="finding-item positive">${finding}</div>`;
                        } else if (finding.type && (finding.type === 'patient_name' || finding.type === 'hospital_id')) {
                            // Handle privacy-protected findings
                            return `
                                <div class="finding-item positive privacy-protected" data-type="${finding.type}" data-value="${finding.value}">
                                    <span class="finding-label">${finding.label}:</span>
                                    <span class="privacy-mask">${finding.masked}</span>
                                    <button class="privacy-toggle" onclick="togglePrivacy(this, '${finding.type}')">
                                        <i class="fas fa-eye"></i>
                                    </button>
                                </div>
                            `;
                        } else {
                            return `<div class="finding-item positive">${finding}</div>`;
                        }
                    }).join('');
                    
                    detailedFindingsHtml = `
                        <div class="finding-section">
                            <h5>Detailed Findings</h5>
                            ${positiveFindingsHtml}
                        </div>
                    `;
                }
                
                // Image quality issues (only if there are actual issues)
                let imageQualityHtml = '';
                if (findings.imageQualityIssues) {
                    const iq = findings.imageQualityIssues;
                    const imageIssues = [];
                    if (iq.blurryPages && iq.blurryPages.length > 0) imageIssues.push(`Blurry: ${iq.blurryPages.join(', ')}`);
                    if (iq.darkPages && iq.darkPages.length > 0) imageIssues.push(`Dark: ${iq.darkPages.join(', ')}`);
                    if (iq.lightPages && iq.lightPages.length > 0) imageIssues.push(`Light: ${iq.lightPages.join(', ')}`);
                    if (iq.unreadablePages && iq.unreadablePages.length > 0) imageIssues.push(`Unreadable: ${iq.unreadablePages.join(', ')}`);
                    
                    if (imageIssues.length > 0) {
                        imageQualityHtml = `
                            <div class="finding-section">
                                <h5>Image Quality Issues</h5>
                                ${imageIssues.map(issue => `<div class="issue-item">${issue}</div>`).join('')}
                            </div>
                        `;
                    }
                }
                
                // Page sequence issues (only if there are actual issues)
                let pageSequenceHtml = '';
                if (findings.pageSequence) {
                    const ps = findings.pageSequence;
                    const sequenceIssues = [];
                    if (ps.cutoffPages && ps.cutoffPages.length > 0) sequenceIssues.push(`Cut-off: ${ps.cutoffPages.join(', ')}`);
                    if (ps.incompletePages && ps.incompletePages.length > 0) sequenceIssues.push(`Incomplete: ${ps.incompletePages.join(', ')}`);
                    if (ps.duplicatePages && ps.duplicatePages.length > 0) {
                        ps.duplicatePages.forEach(dup => {
                            sequenceIssues.push(`Duplicates: ${dup.pages.join(' and ')}`);
                        });
                    }
                    if (ps.orientationIssues) {
                        const oi = ps.orientationIssues;
                        if (oi.upsideDown && oi.upsideDown.length > 0) sequenceIssues.push(`Upside down: ${oi.upsideDown.join(', ')}`);
                        if (oi.sideways && oi.sideways.length > 0) sequenceIssues.push(`Sideways: ${oi.sideways.join(', ')}`);
                        if (oi.misaligned && oi.misaligned.length > 0) sequenceIssues.push(`Misaligned: ${oi.misaligned.join(', ')}`);
                    }
                    
                    if (sequenceIssues.length > 0) {
                        pageSequenceHtml = `
                            <div class="finding-section">
                                <h5>Page Sequence Issues</h5>
                                ${sequenceIssues.map(issue => `<div class="issue-item">${issue}</div>`).join('')}
                            </div>
                        `;
                    }
                }
                
                // Data extraction issues (only if there are actual issues)
                let dataExtractionHtml = '';
                if (findings.dataExtraction) {
                    const de = findings.dataExtraction;
                    const dataIssues = [];
                    if (de.pagesWithoutIdentifiers && de.pagesWithoutIdentifiers.length > 0) {
                        dataIssues.push(`No identifiers: ${de.pagesWithoutIdentifiers.join(', ')}`);
                    }
                    if (de.multiplePatients && de.multiplePatients.detected) {
                        dataIssues.push(`Multiple patients: ${de.multiplePatients.evidence}`);
                    }
                    if (de.dateMismatches && de.dateMismatches.length > 0) {
                        de.dateMismatches.forEach(mismatch => {
                            dataIssues.push(`Date issue: ${mismatch.description}`);
                        });
                    }
                    
                    // Add chronological issues
                    if (de.chronologicalIssues && !de.chronologicalIssues.isChronological) {
                        de.chronologicalIssues.issues.forEach(issue => {
                            dataIssues.push(`Chronological issue: ${issue}`);
                        });
                    }
                    
                    if (dataIssues.length > 0) {
                        dataExtractionHtml = `
                            <div class="finding-section">
                                <h5>Data Extraction Issues</h5>
                                ${dataIssues.map(issue => `<div class="issue-item">${issue}</div>`).join('')}
                            </div>
                        `;
                    }
                }
                
                detailedFindingsHtml += imageQualityHtml + pageSequenceHtml + dataExtractionHtml;
            }
            

            
            // Build recommendations
            let recommendationsHtml = '';
            if (analysis.recommendations) {
                const rec = analysis.recommendations;
                const recommendations = [];
                if (rec.manualReview && rec.manualReview.length > 0) recommendations.push(`Manual review: ${rec.manualReview.join(', ')}`);
                if (rec.rescanning && rec.rescanning.length > 0) recommendations.push(`Rescan: ${rec.rescanning.join(', ')}`);
                if (rec.verification && rec.verification.length > 0) recommendations.push(`Verify: ${rec.verification.join(', ')}`);
                if (rec.corrections && rec.corrections.length > 0) recommendations.push(`Correct: ${rec.corrections.join(', ')}`);
                
                if (recommendations.length > 0) {
                    recommendationsHtml = `
                        <div class="recommendations-section">
                            <h4>Recommendations</h4>
                            ${recommendations.map(rec => `<div class="recommendation-item">${rec}</div>`).join('')}
                        </div>
                    `;
                }
            }
            
            resultCard.innerHTML = `
                <div class="result-header">
                    <div class="result-filename">${analysis.fileInformation.fileName}</div>
                    <div class="result-status ${statusClass}">${statusText}</div>
                </div>
                <div class="result-details">
                    <div class="detail-item">
                        <div class="detail-label">Scan Date</div>
                        <div class="detail-value">${analysis.fileInformation.scanDate}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">Total Pages</div>
                        <div class="detail-value">${analysis.fileInformation.totalPages}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">Risk Level</div>
                        <div class="detail-value">${riskLevel}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">Compliance Status</div>
                        <div class="detail-value">${analysis.complianceStatus || 'Unknown'}</div>
                    </div>
                </div>
                ${summaryTableHtml}
                ${detailedFindingsHtml ? `
                    <div class="detailed-findings">
                        <h4>Detailed Findings</h4>
                        ${detailedFindingsHtml}
                    </div>
                ` : ''}
                ${recommendationsHtml}
                ${analysis.safetyAssessment && analysis.safetyAssessment.immediateActions && analysis.safetyAssessment.immediateActions.length > 0 ? `
                    <div class="immediate-actions">
                        <h4>Immediate Actions Required</h4>
                        ${analysis.safetyAssessment.immediateActions.map(action => `
                            <div class="action-item">${action}</div>
                        `).join('')}
                    </div>
                ` : ''}
            `;
        } else if (analysis.pagesWithHospitalNumbers !== undefined) {
            // Legacy format - page-by-page hospital number analysis
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
    
    if (files.length > 0) {
        // For drag and drop, we'll add the files to the selection
        // and show the file list instead of starting analysis immediately
        showNotification(`Dropped ${files.length} file(s). Added to selection.`, 'success');
        
        // Add dropped files to selection
        addDroppedFilesToSelection(files);
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

// Privacy toggle function
const togglePrivacy = (button, type) => {
    // Handle both old structure (.info-value) and new structure (.privacy-protected)
    const privacyElement = button.closest('.info-value') || button.closest('.privacy-protected');
    const privacyMask = privacyElement.querySelector('.privacy-mask');
    const icon = button.querySelector('i');
    const actualValue = privacyElement.getAttribute('data-value');
    const existingValueSpan = privacyElement.querySelector('.actual-value');
    
    if (privacyElement.classList.contains('revealed')) {
        // Hide the value
        privacyElement.classList.remove('revealed');
        privacyMask.style.display = 'inline';
        privacyMask.textContent = type === 'name' || type === 'patient_name' ? '••••••••••' : '••••••';
        icon.className = 'fas fa-eye';
        button.setAttribute('title', 'Click to reveal');
        
        // Remove the actual value span if it exists
        if (existingValueSpan) {
            existingValueSpan.remove();
        }
    } else {
        // Show the value
        privacyElement.classList.add('revealed');
        privacyMask.style.display = 'none';
        icon.className = 'fas fa-eye-slash';
        button.setAttribute('title', 'Click to hide');
        
        // Show the actual value (only if it doesn't already exist)
        if (!existingValueSpan) {
            const valueSpan = document.createElement('span');
            valueSpan.className = 'actual-value';
            valueSpan.textContent = actualValue;
            privacyElement.appendChild(valueSpan);
        }
    }
}; 