const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const pdfParse = require('pdf-parse');

class ComprehensiveAnalyzer {
  constructor() {
    this.ollamaBaseUrl = 'http://127.0.0.1:11434';
  }

  // Convert PDF to images using Python script (existing functionality)
  async convertPDFToImages(pdfPath, outputDir, pageNumber = 1, dpi = 150) {
    try {
      await fs.ensureDir(outputDir);
      
             const pythonPath = path.join(__dirname, 'paddleocr_env', 'Scripts', 'python.exe');
      const scriptPath = path.join(__dirname, 'pdf_to_images.py');
      
      return new Promise((resolve, reject) => {
        const pythonProcess = spawn(pythonPath, [
          scriptPath,
          pdfPath,
          outputDir,
          pageNumber.toString(),
          dpi.toString()
        ]);
        
        let stdout = '';
        let stderr = '';
        
        pythonProcess.stdout.on('data', (data) => {
          stdout += data.toString();
        });
        
        pythonProcess.stderr.on('data', (data) => {
          stderr += data.toString();
        });
        
        pythonProcess.on('close', (code) => {
          if (code === 0) {
            try {
              const result = JSON.parse(stdout.trim());
              if (result.success) {
                resolve(result);
              } else {
                reject(new Error(result.error));
              }
            } catch (parseError) {
              reject(parseError);
            }
          } else {
            reject(new Error(`Python process failed with code ${code}: ${stderr}`));
          }
        });
        
        pythonProcess.on('error', (error) => {
          reject(error);
        });
      });
    } catch (error) {
      throw error;
    }
  }

  // Extract text using Qwen2.5-VL for OCR
  async extractTextWithOCR(imagePath) {
    console.log(`[OCR] Starting text extraction for: ${imagePath}`);
    try {
      console.log(`[OCR] Reading image file...`);
      // Read image as base64
      const imageBuffer = await fs.readFile(imagePath);
      console.log(`[OCR] Image file read successfully, size: ${imageBuffer.length} bytes`);
      
      // More aggressive size check - if image is too large, skip OCR for this page
      if (imageBuffer.length > 3000000) { // 3MB threshold (reduced from 8MB)
        console.log(`[OCR] Image too large (${imageBuffer.length} bytes), skipping OCR for this page`);
        return '';
      }
      
      const base64Image = imageBuffer.toString('base64');
      console.log(`[OCR] Image converted to base64, length: ${base64Image.length} characters`);
      
      const prompt = `Extract all text from this medical document image. Return ONLY the extracted text, no explanations or formatting. Focus on patient identifiers, dates, medical notes, and any handwritten or printed text.`;
      console.log(`[OCR] Sending request to Ollama with prompt length: ${prompt.length} characters`);
      
      console.log(`[OCR] Making API call to: ${this.ollamaBaseUrl}/api/generate`);
      console.log(`[OCR] Request payload size: ${JSON.stringify({
        model: 'qwen2.5vl:7b',
        prompt: prompt,
        images: ['[base64_image_data]'],
        stream: false
      }).length} characters`);
      
      const response = await axios.post(`${this.ollamaBaseUrl}/api/generate`, {
        model: 'qwen2.5vl:7b',
        prompt: prompt,
        images: [base64Image],
        stream: false
      }, {
        timeout: 120000, // 2 minute timeout (reduced from 5 minutes)
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      console.log(`[OCR] API call successful, response received`);
      console.log(`[OCR] Response data keys:`, Object.keys(response.data));
      
      const extractedText = response.data.response.trim();
      console.log(`[OCR] Extracted text length: ${extractedText.length} characters`);
      console.log(`[OCR] First 100 characters: ${extractedText.substring(0, 100)}...`);
      
      return extractedText;
    } catch (error) {
      console.error('[OCR] Qwen2.5-VL OCR failed:', error);
      console.error('[OCR] Error details:', {
        message: error.message,
        code: error.code,
        response: error.response?.data,
        status: error.response?.status
      });
      return '';
    }
  }

  // Analyze extracted text with Gemma 3n for patient identifiers and data integrity
  async analyzeTextWithGemma(fullText, fileName) {
    console.log(`[TEXT] Starting text analysis for: ${fileName}`);
    console.log(`[TEXT] Input text length: ${fullText.length} characters`);
    console.log(`[TEXT] Input text preview: "${fullText.substring(0, 300)}..."`);
    
    if (!fullText || fullText.trim().length === 0) {
      console.log(`[TEXT] No text provided for analysis`);
      return {
        error: 'No text provided for analysis',
        patientIdentifiers: { names: [], hospitalNumbers: [], mrns: [] },
        multiplePatients: { detected: false, evidence: '', pages: [] },
        dateIssues: { mismatches: [], missingDates: [] },
        pagesWithoutIdentifiers: [],
        dataIntegrityScore: 0,
        criticalIssues: ['No text extracted from document']
      };
    }
    
    const prompt = `You are a medical document analyzer. Analyze the provided text and respond ONLY with valid JSON.

Document: ${fileName}
Text Content: ${fullText}

Instructions:
1. Find all patient names, IDs, hospital numbers, MRNs
2. Check if document contains information for multiple patients
3. Look for impossible date sequences (e.g., discharge before admission)
4. Identify pages or sections without patient identifiers

IMPORTANT: Respond with ONLY valid JSON. No additional text, explanations, or markdown formatting.

{
  "patientIdentifiers": {
    "names": [],
    "hospitalNumbers": [],
    "mrns": []
  },
  "multiplePatients": {
    "detected": false,
    "evidence": "",
    "pages": []
  },
  "dateIssues": {
    "mismatches": [],
    "missingDates": []
  },
  "pagesWithoutIdentifiers": [],
  "dataIntegrityScore": 0,
  "criticalIssues": []
}`;

    try {
      const response = await axios.post(`${this.ollamaBaseUrl}/api/generate`, {
        model: 'gemma3n:latest',
        prompt: prompt,
        stream: false
      });

      let responseText = response.data.response;
      
      // Clean response
      if (responseText.includes('```json')) {
        responseText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      }

      try {
        // Try to extract JSON from the response
        let jsonText = responseText.trim();
        
        // Remove markdown code blocks if present
        if (jsonText.includes('```json')) {
          jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
        }
        
        // Try to find JSON object boundaries
        const jsonStart = jsonText.indexOf('{');
        const jsonEnd = jsonText.lastIndexOf('}');
        
        if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
          jsonText = jsonText.substring(jsonStart, jsonEnd + 1);
        }
        
        return JSON.parse(jsonText);
      } catch (parseError) {
        console.error('JSON parse error:', parseError);
        console.error('Response text:', responseText);
        
        // Return a safe fallback response
        return {
          error: 'Text analysis failed - invalid JSON response',
          patientIdentifiers: { names: [], hospitalNumbers: [], mrns: [] },
          multiplePatients: { detected: false, evidence: '', pages: [] },
          dateIssues: { mismatches: [], missingDates: [] },
          pagesWithoutIdentifiers: [],
          dataIntegrityScore: 0,
          criticalIssues: ['Analysis failed - invalid response format']
        };
      }
    } catch (error) {
      console.error('Text analysis failed:', error);
      return {
        error: 'Text analysis failed',
        patientIdentifiers: { names: [], hospitalNumbers: [], mrns: [] },
        multiplePatients: { detected: false, evidence: '', pages: [] },
        dateIssues: { mismatches: [], missingDates: [] },
        pagesWithoutIdentifiers: [],
        dataIntegrityScore: 0,
        criticalIssues: ['Analysis failed']
      };
    }
  }

  // Analyze images with Gemma 3n for quality and document issues
  async analyzeImagesWithGemma(imagePaths, fileName) {
    console.log(`[ANALYSIS] Starting image analysis for ${imagePaths.length} images`);
    
    // Process images in batches to avoid payload size limits
    const batchSize = 5; // Process 5 images at a time
    const allResults = [];
    
    for (let i = 0; i < imagePaths.length; i += batchSize) {
      const batch = imagePaths.slice(i, i + batchSize);
      console.log(`[ANALYSIS] Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(imagePaths.length/batchSize)} (images ${i+1}-${Math.min(i+batchSize, imagePaths.length)})`);
      
      const base64Images = [];
      
      // Read images in this batch
      for (const imgPath of batch) {
        try {
          // Check if image file exists before reading
          if (!await fs.pathExists(imgPath)) {
            console.error(`[ANALYSIS] Image file not found for analysis: ${imgPath}`);
            continue;
          }
          
          const imageBuffer = await fs.readFile(imgPath);
          
          // Skip very large images to prevent payload issues
          if (imageBuffer.length > 5000000) { // 5MB limit
            console.log(`[ANALYSIS] Skipping large image: ${imgPath} (${imageBuffer.length} bytes)`);
            continue;
          }
          
          base64Images.push(imageBuffer.toString('base64'));
        } catch (error) {
          console.error(`[ANALYSIS] Failed to read image for analysis: ${imgPath}`, error);
          // Continue with other images
        }
      }
      
      if (base64Images.length === 0) {
        console.log(`[ANALYSIS] No valid images in batch ${Math.floor(i/batchSize) + 1}`);
        continue;
      }

      const prompt = `You are a medical document image analyzer. Analyze the provided images and respond ONLY with valid JSON.

Document: ${fileName}
Batch: ${Math.floor(i/batchSize) + 1}/${Math.ceil(imagePaths.length/batchSize)}
Images in this batch: ${base64Images.length}

Instructions:
1. Check image quality (clarity, blur, darkness, brightness)
2. Identify missing content or cut-off text
3. Detect orientation issues (upside-down, sideways)
4. Find duplicate pages
5. Check document structure and sequence

IMPORTANT: Respond with ONLY valid JSON. No additional text, explanations, or markdown formatting.

{
  "imageQuality": {
    "blurryPages": [],
    "darkPages": [],
    "lightPages": [],
    "unreadablePages": []
  },
  "pageCompleteness": {
    "missingPages": [],
    "cutoffPages": [],
    "incompletePages": []
  },
  "orientation": {
    "upsideDown": [],
    "sideways": [],
    "misaligned": []
  },
  "duplicates": {
    "duplicatePages": []
  },
  "documentStructure": {
    "missingSequences": [],
    "outOfOrder": []
  },
  "overallQualityScore": 0,
  "criticalImageIssues": []
}`;

      try {
        console.log(`[ANALYSIS] Sending batch ${Math.floor(i/batchSize) + 1} to Gemma 3n...`);
        const response = await axios.post(`${this.ollamaBaseUrl}/api/generate`, {
          model: 'gemma3n:latest',
          prompt: prompt,
          images: base64Images,
          stream: false
        }, {
          timeout: 300000 // 5 minute timeout
        });

        let responseText = response.data.response;
        
        try {
          // Try to extract JSON from the response
          let jsonText = responseText.trim();
          
          // Remove markdown code blocks if present
          if (jsonText.includes('```json')) {
            jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
          }
          
          // Try to find JSON object boundaries
          const jsonStart = jsonText.indexOf('{');
          const jsonEnd = jsonText.lastIndexOf('}');
          
          if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
            jsonText = jsonText.substring(jsonStart, jsonEnd + 1);
          }
          
          const batchResult = JSON.parse(jsonText);
          allResults.push(batchResult);
          console.log(`[ANALYSIS] Batch ${Math.floor(i/batchSize) + 1} completed successfully`);
          
        } catch (parseError) {
          console.error(`[ANALYSIS] Batch ${Math.floor(i/batchSize) + 1} JSON parse error:`, parseError);
          
          // Add fallback result for this batch
          allResults.push({
            error: `Batch ${Math.floor(i/batchSize) + 1} failed - invalid JSON response`,
            imageQuality: { blurryPages: [], darkPages: [], lightPages: [], unreadablePages: [] },
            pageCompleteness: { missingPages: [], cutoffPages: [], incompletePages: [] },
            orientation: { upsideDown: [], sideways: [], misaligned: [] },
            duplicates: { duplicatePages: [] },
            documentStructure: { missingSequences: [], outOfOrder: [] },
            overallQualityScore: 0,
            criticalImageIssues: [`Batch ${Math.floor(i/batchSize) + 1} failed`]
          });
        }
      } catch (error) {
        console.error(`[ANALYSIS] Batch ${Math.floor(i/batchSize) + 1} failed:`, error);
        
        // Add fallback result for this batch
        allResults.push({
          error: `Batch ${Math.floor(i/batchSize) + 1} failed`,
          imageQuality: { blurryPages: [], darkPages: [], lightPages: [], unreadablePages: [] },
          pageCompleteness: { missingPages: [], cutoffPages: [], incompletePages: [] },
          orientation: { upsideDown: [], sideways: [], misaligned: [] },
          duplicates: { duplicatePages: [] },
          documentStructure: { missingSequences: [], outOfOrder: [] },
          overallQualityScore: 0,
          criticalImageIssues: [`Batch ${Math.floor(i/batchSize) + 1} failed`]
        });
      }
    }
    
    // Combine all batch results into a single analysis
    console.log(`[ANALYSIS] Combining results from ${allResults.length} batches...`);
    return this.combineBatchResults(allResults, imagePaths.length);
  }

  // Combine results from multiple batches into a single analysis
  combineBatchResults(batchResults, totalPages) {
    console.log(`[COMBINE] Combining ${batchResults.length} batch results...`);
    
    const combined = {
      imageQuality: {
        blurryPages: [],
        darkPages: [],
        lightPages: [],
        unreadablePages: []
      },
      pageCompleteness: {
        missingPages: [],
        cutoffPages: [],
        incompletePages: []
      },
      orientation: {
        upsideDown: [],
        sideways: [],
        misaligned: []
      },
      duplicates: {
        duplicatePages: []
      },
      documentStructure: {
        missingSequences: [],
        outOfOrder: []
      },
      overallQualityScore: 0,
      criticalImageIssues: []
    };
    
    let totalScore = 0;
    let validBatches = 0;
    
    batchResults.forEach((batch, index) => {
      if (batch.error) {
        console.log(`[COMBINE] Batch ${index + 1} had error: ${batch.error}`);
        combined.criticalImageIssues.push(batch.error);
        return;
      }
      
      validBatches++;
      
      // Combine arrays
      if (batch.imageQuality) {
        combined.imageQuality.blurryPages.push(...(batch.imageQuality.blurryPages || []));
        combined.imageQuality.darkPages.push(...(batch.imageQuality.darkPages || []));
        combined.imageQuality.lightPages.push(...(batch.imageQuality.lightPages || []));
        combined.imageQuality.unreadablePages.push(...(batch.imageQuality.unreadablePages || []));
      }
      
      if (batch.pageCompleteness) {
        combined.pageCompleteness.missingPages.push(...(batch.pageCompleteness.missingPages || []));
        combined.pageCompleteness.cutoffPages.push(...(batch.pageCompleteness.cutoffPages || []));
        combined.pageCompleteness.incompletePages.push(...(batch.pageCompleteness.incompletePages || []));
      }
      
      if (batch.orientation) {
        combined.orientation.upsideDown.push(...(batch.orientation.upsideDown || []));
        combined.orientation.sideways.push(...(batch.orientation.sideways || []));
        combined.orientation.misaligned.push(...(batch.orientation.misaligned || []));
      }
      
      if (batch.duplicates) {
        combined.duplicates.duplicatePages.push(...(batch.duplicates.duplicatePages || []));
      }
      
      if (batch.documentStructure) {
        combined.documentStructure.missingSequences.push(...(batch.documentStructure.missingSequences || []));
        combined.documentStructure.outOfOrder.push(...(batch.documentStructure.outOfOrder || []));
      }
      
      if (batch.criticalImageIssues) {
        combined.criticalImageIssues.push(...(batch.criticalImageIssues || []));
      }
      
      // Average the quality score
      if (batch.overallQualityScore) {
        totalScore += batch.overallQualityScore;
      }
    });
    
    // Calculate average quality score
    if (validBatches > 0) {
      combined.overallQualityScore = Math.round(totalScore / validBatches);
    }
    
    console.log(`[COMBINE] Combined analysis complete. Valid batches: ${validBatches}/${batchResults.length}`);
    return combined;
  }

  // Generate recommendations with Gemma 3n
  async generateRecommendations(textAnalysis, imageAnalysis, fileName) {
    console.log(`[RECOMMENDATIONS] Starting recommendations generation for: ${fileName}`);
    console.log(`[RECOMMENDATIONS] Text analysis:`, JSON.stringify(textAnalysis, null, 2));
    console.log(`[RECOMMENDATIONS] Image analysis:`, JSON.stringify(imageAnalysis, null, 2));
    
    const prompt = `You are a medical document safety assessor. Based on the analysis results, generate recommendations and respond ONLY with valid JSON.

Document: ${fileName}

Text Analysis Issues:
${JSON.stringify(textAnalysis, null, 2)}

Image Analysis Issues:
${JSON.stringify(imageAnalysis, null, 2)}

Instructions:
1. Generate manual review suggestions
2. Provide rescanning recommendations
3. Identify verification needs
4. Assess safety (safe/unsafe for use)

Safety Criteria:
- UNSAFE: Missing patient identifiers on multiple/all pages, multiple patients mixed, critical date mismatches
- SAFE: Minor issues that don't affect identification or critical data

IMPORTANT: Respond with ONLY valid JSON. No additional text, explanations, or markdown formatting.

{
  "recommendations": {
    "manualReview": [],
    "rescanning": [],
    "verification": [],
    "corrections": []
  },
  "safetyAssessment": {
    "safeForUse": false,
    "reason": "",
    "riskLevel": "high",
    "immediateActions": []
  },
  "priorityIssues": [],
  "complianceStatus": "needs-review"
}`;

    try {
      const response = await axios.post(`${this.ollamaBaseUrl}/api/generate`, {
        model: 'gemma3n:latest',
        prompt: prompt,
        stream: false
      });

      let responseText = response.data.response;
      
      try {
        // Try to extract JSON from the response
        let jsonText = responseText.trim();
        
        // Remove markdown code blocks if present
        if (jsonText.includes('```json')) {
          jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
        }
        
        // Try to find JSON object boundaries
        const jsonStart = jsonText.indexOf('{');
        const jsonEnd = jsonText.lastIndexOf('}');
        
        if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
          jsonText = jsonText.substring(jsonStart, jsonEnd + 1);
        }
        
        return JSON.parse(jsonText);
      } catch (parseError) {
        console.error('Recommendations JSON parse error:', parseError);
        console.error('Response text:', responseText);
        
        // Return a safe fallback response
        return {
          error: 'Recommendations generation failed - invalid JSON response',
          recommendations: { manualReview: [], rescanning: [], verification: [], corrections: [] },
          safetyAssessment: { safeForUse: false, reason: 'Analysis failed', riskLevel: 'high', immediateActions: ['Manual review required'] },
          priorityIssues: ['Analysis failed - invalid response format'],
          complianceStatus: 'needs-review'
        };
      }
    } catch (error) {
      console.error('Recommendations generation failed:', error);
      return {
        error: 'Recommendations generation failed',
        recommendations: { manualReview: [], rescanning: [], verification: [], corrections: [] },
        safetyAssessment: { safeForUse: false, reason: 'Analysis failed', riskLevel: 'high', immediateActions: ['Manual review required'] },
        priorityIssues: ['Analysis failed'],
        complianceStatus: 'needs-review'
      };
    }
  }

  // Generate comprehensive report
  generateReport(fileName, textAnalysis, imageAnalysis, recommendations, totalPages) {
    const scanDate = new Date().toISOString().split('T')[0];
    
    // Create summary table
    const summaryTable = this.createSummaryTable(textAnalysis, imageAnalysis, recommendations);
    
    // Determine if file is safe
    const isSafe = recommendations.safetyAssessment?.safeForUse || false;
    
    return {
      fileInformation: {
        fileName: fileName,
        scanDate: scanDate,
        totalPages: totalPages
      },
      summaryTable: summaryTable,
      detailedFindings: {
        imageQualityIssues: this.formatImageQualityIssues(imageAnalysis),
        pageSequence: this.formatPageSequenceIssues(imageAnalysis),
        dataExtraction: this.formatDataExtractionIssues(textAnalysis)
      },
      recommendations: recommendations.recommendations || {},
      safetyAssessment: {
        safeForUse: isSafe,
        reason: recommendations.safetyAssessment?.reason || 'Analysis incomplete',
        riskLevel: recommendations.safetyAssessment?.riskLevel || 'high',
        immediateActions: recommendations.safetyAssessment?.immediateActions || []
      },
      complianceStatus: recommendations.complianceStatus || 'needs-review',
      priorityIssues: recommendations.priorityIssues || []
    };
  }

  createSummaryTable(textAnalysis, imageAnalysis, recommendations) {
    const issues = [];
    
    // Image quality issues
    const blurryCount = (imageAnalysis.imageQuality?.blurryPages || []).length;
    if (blurryCount > 0) {
      issues.push({
        issueType: 'Blurry/Low-Quality Images',
        count: blurryCount,
        pagesAffected: imageAnalysis.imageQuality.blurryPages.join(', ')
      });
    }
    
    // Missing pages
    const missingCount = (imageAnalysis.pageCompleteness?.missingPages || []).length;
    if (missingCount > 0) {
      issues.push({
        issueType: 'Missing Pages',
        count: missingCount,
        pagesAffected: imageAnalysis.pageCompleteness.missingPages.join(', ')
      });
    }
    
    // Orientation issues
    const orientationCount = (imageAnalysis.orientation?.upsideDown || []).length + 
                           (imageAnalysis.orientation?.sideways || []).length;
    if (orientationCount > 0) {
      issues.push({
        issueType: 'Improper Orientation',
        count: orientationCount,
        pagesAffected: [...(imageAnalysis.orientation?.upsideDown || []), 
                       ...(imageAnalysis.orientation?.sideways || [])].join(', ')
      });
    }
    
    // Duplicate pages
    const duplicateCount = (imageAnalysis.duplicates?.duplicatePages || []).length;
    if (duplicateCount > 0) {
      issues.push({
        issueType: 'Duplicate Pages',
        count: duplicateCount,
        pagesAffected: imageAnalysis.duplicates.duplicatePages.map(d => d.pages.join(' and ')).join(', ')
      });
    }
    
    // Pages without identifiers
    const noIdCount = (textAnalysis.pagesWithoutIdentifiers || []).length;
    if (noIdCount > 0) {
      issues.push({
        issueType: 'Pages without Identifiers',
        count: noIdCount,
        pagesAffected: textAnalysis.pagesWithoutIdentifiers.join(', ')
      });
    }
    
    // Multiple patients (check both text analysis and recommendations)
    if (textAnalysis.multiplePatients?.detected || 
        (textAnalysis.patientIdentifiers?.names && textAnalysis.patientIdentifiers.names.length > 2)) {
      issues.push({
        issueType: 'Multiple Patients Detected',
        count: 1,
        pagesAffected: textAnalysis.multiplePatients?.pages?.join(', ') || 'All pages'
      });
    }
    
    // Date mismatches
    const dateMismatchCount = (textAnalysis.dateIssues?.mismatches || []).length;
    if (dateMismatchCount > 0) {
      issues.push({
        issueType: 'Date Mismatches',
        count: dateMismatchCount,
        pagesAffected: textAnalysis.dateIssues.mismatches.map(m => m.page).join(', ')
      });
    }
    
    // Add priority issues from recommendations
    if (recommendations.priorityIssues && recommendations.priorityIssues.length > 0) {
      recommendations.priorityIssues.forEach((issue, index) => {
        issues.push({
          issueType: `Priority Issue ${index + 1}`,
          count: 1,
          pagesAffected: 'All pages',
          description: issue
        });
      });
    }
    
    // Add critical issues from text analysis
    if (textAnalysis.criticalIssues && textAnalysis.criticalIssues.length > 0) {
      textAnalysis.criticalIssues.forEach((issue, index) => {
        issues.push({
          issueType: `Critical Issue ${index + 1}`,
          count: 1,
          pagesAffected: 'All pages',
          description: issue
        });
      });
    }
    
    // If no specific issues found but document is marked as unsafe, add a general issue
    if (issues.length === 0 && recommendations.safetyAssessment?.safeForUse === false) {
      issues.push({
        issueType: 'Document Safety Concerns',
        count: 1,
        pagesAffected: 'All pages',
        description: recommendations.safetyAssessment?.reason || 'Document requires review'
      });
    }
    
    return issues;
  }

  formatImageQualityIssues(imageAnalysis) {
    return {
      blurryPages: imageAnalysis.imageQuality?.blurryPages || [],
      darkPages: imageAnalysis.imageQuality?.darkPages || [],
      lightPages: imageAnalysis.imageQuality?.lightPages || [],
      unreadablePages: imageAnalysis.imageQuality?.unreadablePages || []
    };
  }

  formatPageSequenceIssues(imageAnalysis) {
    return {
      missingPages: imageAnalysis.pageCompleteness?.missingPages || [],
      duplicatePages: imageAnalysis.duplicates?.duplicatePages || [],
      orientationIssues: {
        upsideDown: imageAnalysis.orientation?.upsideDown || [],
        sideways: imageAnalysis.orientation?.sideways || []
      }
    };
  }

  formatDataExtractionIssues(textAnalysis) {
    return {
      pagesWithoutIdentifiers: textAnalysis.pagesWithoutIdentifiers || [],
      multiplePatients: textAnalysis.multiplePatients || { detected: false, evidence: '', pages: [] },
      dateMismatches: textAnalysis.dateIssues?.mismatches || []
    };
  }

  // Main analysis function
  async analyzeFile(file) {
    try {
      const fileName = file.originalname;
      console.log(`Starting comprehensive analysis of: ${fileName}`);
      
      // Skip connection test for now - Ollama might be busy with model initialization
      console.log(`[MAIN] Skipping connection test - proceeding with analysis`);
      
      // Step 1: Get PDF info and convert all pages to images
      console.log(`[MAIN] Step 1: Starting PDF processing...`);
      
      // Create unique temporary directory for this analysis
      const sessionId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      const outputDir = path.join(__dirname, 'temp_images', sessionId);
      console.log(`[MAIN] Session ID: ${sessionId}`);
      console.log(`[MAIN] Output directory: ${outputDir}`);
      
      // First, get the total number of pages
      console.log(`[MAIN] Reading PDF file: ${file.path}`);
      const pdfBuffer = await fs.readFile(file.path);
      console.log(`[MAIN] PDF file read, size: ${pdfBuffer.length} bytes`);
      
      console.log(`[MAIN] Parsing PDF to get page count...`);
      const pdfData = await pdfParse(pdfBuffer);
      const totalPages = pdfData.numpages;
      console.log(`[MAIN] PDF parsed successfully, total pages: ${totalPages}`);
      
      // Convert all pages to images
      console.log(`[MAIN] Starting PDF to image conversion...`);
      console.log(`[MAIN] Converting ${totalPages} pages to images at 100 DPI...`);
      
      const conversionResult = await this.convertPDFToImages(file.path, outputDir, totalPages, 100);
      console.log(`[MAIN] PDF to image conversion completed`);
      
      if (!conversionResult.success) {
        console.error(`[MAIN] PDF to image conversion failed:`, conversionResult.error);
        throw new Error('PDF to image conversion failed');
      }
      
      console.log(`[MAIN] Conversion result:`, conversionResult);
      
      const imagePaths = conversionResult.image_paths || [conversionResult.image_path];
      
      console.log(`Converted ${totalPages} pages to images`);
      console.log(`[MAIN] Image paths:`, imagePaths);
      
      // Step 2: Extract text from all images using PaddleOCR (TESTING: limit to first 5 pages)
      const maxPagesToProcess = Math.min(5, imagePaths.length);
      console.log(`[MAIN] Starting text extraction for ${maxPagesToProcess} images (TESTING: limited to first 5 pages)`);
      console.log(`[MAIN] Total pages in document: ${imagePaths.length}, processing: ${maxPagesToProcess}`);
      
      let allExtractedText = '';
      const pageTexts = [];
      
      for (let i = 0; i < maxPagesToProcess; i++) {
        console.log(`[MAIN] ===== PROCESSING PAGE ${i + 1}/${maxPagesToProcess} (of ${totalPages} total) =====`);
        console.log(`[MAIN] Image path: ${imagePaths[i]}`);
        
        try {
          // Check if image file exists before processing
          console.log(`[MAIN] Checking if image file exists...`);
          if (!await fs.pathExists(imagePaths[i])) {
            console.error(`[MAIN] Image file not found: ${imagePaths[i]}`);
            continue;
          }
          console.log(`[MAIN] Image file exists, proceeding with OCR...`);
          
          console.log(`[MAIN] Calling extractTextWithOCR for page ${i + 1}...`);
          
          // Add timeout wrapper for OCR
          const extractedText = await Promise.race([
            this.extractTextWithOCR(imagePaths[i]),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('OCR timeout')), 180000) // 3 minute timeout
            )
          ]);
          
          console.log(`[MAIN] OCR completed for page ${i + 1}`);
          
          if (extractedText && extractedText.trim()) {
            console.log(`[MAIN] Text extracted successfully from page ${i + 1}`);
            console.log(`[MAIN] Extracted text length: ${extractedText.length} characters`);
            console.log(`\n=== EXTRACTED TEXT FROM PAGE ${i + 1} ===`);
            console.log(extractedText);
            console.log(`=== END PAGE ${i + 1} ===\n`);
            
            const pageText = `Page ${i + 1}: ${extractedText}`;
            allExtractedText += pageText + '\n\n';
            pageTexts.push({ page: i + 1, text: extractedText });
            console.log(`[MAIN] Page ${i + 1} text added to collection`);
          } else {
            console.log(`[MAIN] No text extracted from page ${i + 1}`);
          }
        } catch (error) {
          console.error(`[MAIN] Failed to extract text from page ${i + 1}:`, error);
          console.error(`[MAIN] Error stack:`, error.stack);
          
          if (error.message === 'OCR timeout') {
            console.log(`[MAIN] Skipping page ${i + 1} due to timeout`);
          }
          
          // Continue with next page
        }
        
        console.log(`[MAIN] ===== COMPLETED PAGE ${i + 1}/${maxPagesToProcess} (of ${totalPages} total) =====`);
      }
      
      console.log(`[MAIN] Text extraction loop completed`);
      console.log(`[MAIN] Total extracted text length: ${allExtractedText.length} characters`);
      console.log(`[MAIN] Number of pages with text: ${pageTexts.length}`);
      console.log(`Extracted ${allExtractedText.length} characters of text`);
      
      // Step 3: Analyze text with Gemma 3n
      console.log('Analyzing text content...');
      console.log(`[MAIN] Text analysis input length: ${allExtractedText.length} characters`);
      console.log(`[MAIN] Text analysis input preview: "${allExtractedText.substring(0, 500)}..."`);
      
      if (!allExtractedText || allExtractedText.trim().length === 0) {
        console.log(`[MAIN] WARNING: No text extracted from any pages!`);
        console.log(`[MAIN] This will result in no findings being generated.`);
      }
      
      console.log(`[MAIN] About to call analyzeTextWithGemma...`);
      const textAnalysis = await this.analyzeTextWithGemma(allExtractedText, fileName);
      console.log(`[MAIN] analyzeTextWithGemma completed`);
      console.log(`[MAIN] Text analysis result:`, JSON.stringify(textAnalysis, null, 2));
      
      // Step 4: Analyze images with Gemma 3n (TESTING: limit to first 5 pages)
      const imagesToAnalyze = imagePaths.slice(0, maxPagesToProcess);
      console.log(`[MAIN] Analyzing image quality for ${imagesToAnalyze.length} images (TESTING: limited to first 5 pages)`);
      const imageAnalysis = await this.analyzeImagesWithGemma(imagesToAnalyze, fileName);
      
      // Step 5: Generate recommendations
      console.log('Generating recommendations...');
      console.log(`[MAIN] About to call generateRecommendations...`);
      const recommendations = await this.generateRecommendations(textAnalysis, imageAnalysis, fileName);
      console.log(`[MAIN] generateRecommendations completed`);
      console.log(`[MAIN] Recommendations result:`, JSON.stringify(recommendations, null, 2));
      
      // Step 6: Generate comprehensive report
      console.log('Generating final report...');
      console.log(`[MAIN] About to call generateReport...`);
      const report = this.generateReport(fileName, textAnalysis, imageAnalysis, recommendations, totalPages);
      console.log(`[MAIN] generateReport completed`);
      console.log(`[MAIN] Final report:`, JSON.stringify(report, null, 2));
      
      // Cleanup temporary images
      try {
        // Only cleanup if directory exists and is empty or contains only our session files
        if (await fs.pathExists(outputDir)) {
          await fs.remove(outputDir);
          console.log(`Cleaned up temporary directory: ${outputDir}`);
        }
      } catch (cleanupError) {
        console.warn('Failed to cleanup temporary images:', cleanupError);
      }
      
      return {
        filename: fileName,
        filepath: file.path,
        analysis: report,
        timestamp: new Date().toISOString(),
        extractedText: allExtractedText,
        pageTexts: pageTexts
      };
      
    } catch (error) {
      console.error('Comprehensive analysis failed:', error);
      return {
        filename: file.originalname,
        filepath: file.path,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

module.exports = ComprehensiveAnalyzer; 