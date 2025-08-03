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
      
      const prompt = `Extract all text from this medical document image. Return ONLY the extracted text, no explanations or formatting. Focus on patient names (not doctor names), hospital numbers (5-6 digit numbers, no "MR" prefix), dates, medical notes, and any handwritten or printed text.`;
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
        patientIdentifiers: { names: [], hospitalNumbers: [] },
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
1. Find patient names (full names, not doctor names) and hospital numbers (5-6 digit numbers, no "MR" prefix)
2. Focus on identifiers near the top of the page
3. Check if document contains information for multiple patients
4. Look for impossible date sequences (e.g., discharge before admission)
5. Identify pages or sections without patient identifiers (name OR hospital number)

IMPORTANT: 
- Hospital numbers are 5-6 digit numbers only (no "MR" prefix)
- Do NOT include doctor names, MRNs, or patient IDs
- We accept either a patient name OR hospital number per page
- Respond with ONLY valid JSON. No additional text, explanations, or markdown formatting.

{
  "patientIdentifiers": {
    "names": [],
    "hospitalNumbers": []
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
          patientIdentifiers: { names: [], hospitalNumbers: [] },
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
Current batch starts at page: ${i + 1}

Instructions:
1. Check image quality (clarity, blur, darkness, brightness)
2. Identify cut-off or incomplete content within each page
3. Detect orientation issues (upside-down, sideways, misaligned)
4. Find duplicate pages within this batch

IMPORTANT: 
- Answer YES/NO for each category
- If YES, list the specific page numbers affected
- Page numbers should be absolute (${i + 1}, ${i + 2}, ${i + 3}, etc.)
- Focus only on visual issues that can be detected from the images
- Respond with ONLY valid JSON. No additional text, explanations, or markdown formatting.

{
  "imageQuality": {
    "hasBlurryPages": false,
    "blurryPages": [],
    "hasDarkPages": false,
    "darkPages": [],
    "hasLightPages": false,
    "lightPages": [],
    "hasUnreadablePages": false,
    "unreadablePages": []
  },
  "pageCompleteness": {
    "hasCutoffPages": false,
    "cutoffPages": [],
    "hasIncompletePages": false,
    "incompletePages": []
  },
  "orientation": {
    "hasUpsideDown": false,
    "upsideDown": [],
    "hasSideways": false,
    "sideways": [],
    "hasMisaligned": false,
    "misaligned": []
  },
  "duplicates": {
    "hasDuplicatePages": false,
    "duplicatePages": []
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
             imageQuality: { 
               hasBlurryPages: false, blurryPages: [], 
               hasDarkPages: false, darkPages: [], 
               hasLightPages: false, lightPages: [], 
               hasUnreadablePages: false, unreadablePages: [] 
             },
             pageCompleteness: { 
               hasCutoffPages: false, cutoffPages: [], 
               hasIncompletePages: false, incompletePages: [] 
             },
             orientation: { 
               hasUpsideDown: false, upsideDown: [], 
               hasSideways: false, sideways: [], 
               hasMisaligned: false, misaligned: [] 
             },
             duplicates: { 
               hasDuplicatePages: false, duplicatePages: [] 
             },
             overallQualityScore: 0,
             criticalImageIssues: [`Batch ${Math.floor(i/batchSize) + 1} failed`]
           });
        }
      } catch (error) {
        console.error(`[ANALYSIS] Batch ${Math.floor(i/batchSize) + 1} failed:`, error);
        
                 // Add fallback result for this batch
         allResults.push({
           error: `Batch ${Math.floor(i/batchSize) + 1} failed`,
           imageQuality: { 
             hasBlurryPages: false, blurryPages: [], 
             hasDarkPages: false, darkPages: [], 
             hasLightPages: false, lightPages: [], 
             hasUnreadablePages: false, unreadablePages: [] 
           },
           pageCompleteness: { 
             hasCutoffPages: false, cutoffPages: [], 
             hasIncompletePages: false, incompletePages: [] 
           },
           orientation: { 
             hasUpsideDown: false, upsideDown: [], 
             hasSideways: false, sideways: [], 
             hasMisaligned: false, misaligned: [] 
           },
           duplicates: { 
             hasDuplicatePages: false, duplicatePages: [] 
           },
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
         hasBlurryPages: false,
         blurryPages: [],
         hasDarkPages: false,
         darkPages: [],
         hasLightPages: false,
         lightPages: [],
         hasUnreadablePages: false,
         unreadablePages: []
       },
       pageCompleteness: {
         hasCutoffPages: false,
         cutoffPages: [],
         hasIncompletePages: false,
         incompletePages: []
       },
       orientation: {
         hasUpsideDown: false,
         upsideDown: [],
         hasSideways: false,
         sideways: [],
         hasMisaligned: false,
         misaligned: []
       },
       duplicates: {
         hasDuplicatePages: false,
         duplicatePages: []
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
      
             // Combine arrays and update boolean flags
       if (batch.imageQuality) {
         if (batch.imageQuality.blurryPages && batch.imageQuality.blurryPages.length > 0) {
           combined.imageQuality.hasBlurryPages = true;
           combined.imageQuality.blurryPages.push(...batch.imageQuality.blurryPages);
         }
         if (batch.imageQuality.darkPages && batch.imageQuality.darkPages.length > 0) {
           combined.imageQuality.hasDarkPages = true;
           combined.imageQuality.darkPages.push(...batch.imageQuality.darkPages);
         }
         if (batch.imageQuality.lightPages && batch.imageQuality.lightPages.length > 0) {
           combined.imageQuality.hasLightPages = true;
           combined.imageQuality.lightPages.push(...batch.imageQuality.lightPages);
         }
         if (batch.imageQuality.unreadablePages && batch.imageQuality.unreadablePages.length > 0) {
           combined.imageQuality.hasUnreadablePages = true;
           combined.imageQuality.unreadablePages.push(...batch.imageQuality.unreadablePages);
         }
       }
       
               if (batch.pageCompleteness) {
          if (batch.pageCompleteness.cutoffPages && batch.pageCompleteness.cutoffPages.length > 0) {
            combined.pageCompleteness.hasCutoffPages = true;
            combined.pageCompleteness.cutoffPages.push(...batch.pageCompleteness.cutoffPages);
          }
          if (batch.pageCompleteness.incompletePages && batch.pageCompleteness.incompletePages.length > 0) {
            combined.pageCompleteness.hasIncompletePages = true;
            combined.pageCompleteness.incompletePages.push(...batch.pageCompleteness.incompletePages);
          }
        }
       
       if (batch.orientation) {
         if (batch.orientation.upsideDown && batch.orientation.upsideDown.length > 0) {
           combined.orientation.hasUpsideDown = true;
           combined.orientation.upsideDown.push(...batch.orientation.upsideDown);
         }
         if (batch.orientation.sideways && batch.orientation.sideways.length > 0) {
           combined.orientation.hasSideways = true;
           combined.orientation.sideways.push(...batch.orientation.sideways);
         }
         if (batch.orientation.misaligned && batch.orientation.misaligned.length > 0) {
           combined.orientation.hasMisaligned = true;
           combined.orientation.misaligned.push(...batch.orientation.misaligned);
         }
       }
       
       if (batch.duplicates) {
         if (batch.duplicates.duplicatePages && batch.duplicates.duplicatePages.length > 0) {
           combined.duplicates.hasDuplicatePages = true;
           combined.duplicates.duplicatePages.push(...batch.duplicates.duplicatePages);
         }
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
5. List priority issues in the priorityIssues array with specific descriptions

Safety Criteria:
- UNSAFE: Missing patient identifiers on more than 50% of pages, multiple patients mixed, critical date mismatches
- SAFE: Minor issues that don't affect identification or critical data

IMPORTANT: 
- If identifierCoverage.coveragePercentage is less than 50%, mark as UNSAFE and add "Low identifier coverage (X% below 50% threshold)" to priorityIssues
- If multiplePatients.detected is true, mark as UNSAFE and add "Multiple patients detected in single document" to priorityIssues
- If there are critical date mismatches, mark as UNSAFE and add "Critical date mismatches detected" to priorityIssues
- Populate priorityIssues array with specific descriptions of the most critical problems found
- Respond with ONLY valid JSON. No additional text, explanations, or markdown formatting.

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
     if (imageAnalysis.imageQuality?.hasBlurryPages) {
       const blurryPages = imageAnalysis.imageQuality.blurryPages || [];
       issues.push({
         issueType: 'Blurry/Low-Quality Images',
         count: blurryPages.length,
         pagesAffected: blurryPages.join(', '),
         description: `YES - Pages ${blurryPages.join(', ')} are blurry or low quality`
       });
     }
     
     if (imageAnalysis.imageQuality?.hasDarkPages) {
       const darkPages = imageAnalysis.imageQuality.darkPages || [];
       issues.push({
         issueType: 'Dark Pages',
         count: darkPages.length,
         pagesAffected: darkPages.join(', '),
         description: `YES - Pages ${darkPages.join(', ')} are too dark to read`
       });
     }
     
     if (imageAnalysis.imageQuality?.hasLightPages) {
       const lightPages = imageAnalysis.imageQuality.lightPages || [];
       issues.push({
         issueType: 'Light/Washed Out Pages',
         count: lightPages.length,
         pagesAffected: lightPages.join(', '),
         description: `YES - Pages ${lightPages.join(', ')} are too light or washed out`
       });
     }
     
     if (imageAnalysis.imageQuality?.hasUnreadablePages) {
       const unreadablePages = imageAnalysis.imageQuality.unreadablePages || [];
       issues.push({
         issueType: 'Unreadable Pages',
         count: unreadablePages.length,
         pagesAffected: unreadablePages.join(', '),
         description: `YES - Pages ${unreadablePages.join(', ')} are unreadable`
       });
     }
     
     
     
     if (imageAnalysis.pageCompleteness?.hasCutoffPages) {
       const cutoffPages = imageAnalysis.pageCompleteness.cutoffPages || [];
       issues.push({
         issueType: 'Cut-off Pages',
         count: cutoffPages.length,
         pagesAffected: cutoffPages.join(', '),
         description: `YES - Pages ${cutoffPages.join(', ')} have cut-off content`
       });
     }
     
     if (imageAnalysis.pageCompleteness?.hasIncompletePages) {
       const incompletePages = imageAnalysis.pageCompleteness.incompletePages || [];
       issues.push({
         issueType: 'Incomplete Pages',
         count: incompletePages.length,
         pagesAffected: incompletePages.join(', '),
         description: `YES - Pages ${incompletePages.join(', ')} are incomplete`
       });
     }
     
     // Orientation issues
     if (imageAnalysis.orientation?.hasUpsideDown) {
       const upsideDownPages = imageAnalysis.orientation.upsideDown || [];
       issues.push({
         issueType: 'Upside Down Pages',
         count: upsideDownPages.length,
         pagesAffected: upsideDownPages.join(', '),
         description: `YES - Pages ${upsideDownPages.join(', ')} are upside down`
       });
     }
     
     if (imageAnalysis.orientation?.hasSideways) {
       const sidewaysPages = imageAnalysis.orientation.sideways || [];
       issues.push({
         issueType: 'Sideways Pages',
         count: sidewaysPages.length,
         pagesAffected: sidewaysPages.join(', '),
         description: `YES - Pages ${sidewaysPages.join(', ')} are sideways`
       });
     }
     
     if (imageAnalysis.orientation?.hasMisaligned) {
       const misalignedPages = imageAnalysis.orientation.misaligned || [];
       issues.push({
         issueType: 'Misaligned Pages',
         count: misalignedPages.length,
         pagesAffected: misalignedPages.join(', '),
         description: `YES - Pages ${misalignedPages.join(', ')} are misaligned`
       });
     }
     
     // Duplicate pages
     if (imageAnalysis.duplicates?.hasDuplicatePages) {
       const duplicatePages = imageAnalysis.duplicates.duplicatePages || [];
       issues.push({
         issueType: 'Duplicate Pages',
         count: duplicatePages.length,
         pagesAffected: duplicatePages.map(d => d.pages.join(' and ')).join(', '),
         description: `YES - Duplicate pages found: ${duplicatePages.map(d => d.pages.join(' and ')).join(', ')}`
       });
     }
    
    // Pages without identifiers
    const noIdCount = (textAnalysis.pagesWithoutIdentifiers || []).length;
    if (noIdCount > 0) {
      const coverageInfo = textAnalysis.identifierCoverage ? 
        ` (${textAnalysis.identifierCoverage.coveragePercentage.toFixed(1)}% coverage)` : '';
      
      issues.push({
        issueType: `Pages without Identifiers${coverageInfo}`,
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
    
    // Add specific issue for low identifier coverage
    if (textAnalysis.identifierCoverage && textAnalysis.identifierCoverage.isUnsafe) {
      issues.push({
        issueType: 'Low Identifier Coverage',
        count: 1,
        pagesAffected: 'All pages',
        description: `Only ${textAnalysis.identifierCoverage.coveragePercentage.toFixed(1)}% of pages have patient identifiers (below 50% threshold)`
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
       hasBlurryPages: imageAnalysis.imageQuality?.hasBlurryPages || false,
       blurryPages: imageAnalysis.imageQuality?.blurryPages || [],
       hasDarkPages: imageAnalysis.imageQuality?.hasDarkPages || false,
       darkPages: imageAnalysis.imageQuality?.darkPages || [],
       hasLightPages: imageAnalysis.imageQuality?.hasLightPages || false,
       lightPages: imageAnalysis.imageQuality?.lightPages || [],
       hasUnreadablePages: imageAnalysis.imageQuality?.hasUnreadablePages || false,
       unreadablePages: imageAnalysis.imageQuality?.unreadablePages || []
     };
   }

     formatPageSequenceIssues(imageAnalysis) {
     return {
       hasCutoffPages: imageAnalysis.pageCompleteness?.hasCutoffPages || false,
       cutoffPages: imageAnalysis.pageCompleteness?.cutoffPages || [],
       hasIncompletePages: imageAnalysis.pageCompleteness?.hasIncompletePages || false,
       incompletePages: imageAnalysis.pageCompleteness?.incompletePages || [],
       hasDuplicatePages: imageAnalysis.duplicates?.hasDuplicatePages || false,
       duplicatePages: imageAnalysis.duplicates?.duplicatePages || [],
       orientationIssues: {
         hasUpsideDown: imageAnalysis.orientation?.hasUpsideDown || false,
         upsideDown: imageAnalysis.orientation?.upsideDown || [],
         hasSideways: imageAnalysis.orientation?.hasSideways || false,
         sideways: imageAnalysis.orientation?.sideways || [],
         hasMisaligned: imageAnalysis.orientation?.hasMisaligned || false,
         misaligned: imageAnalysis.orientation?.misaligned || []
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
      
             // Step 5: Calculate identifier coverage and generate recommendations
       console.log('Calculating identifier coverage...');
       
       // Calculate percentage of pages missing identifiers
       const pagesWithoutIdentifiers = textAnalysis.pagesWithoutIdentifiers || [];
       const totalPagesProcessed = maxPagesToProcess;
       const pagesMissingIdentifiers = pagesWithoutIdentifiers.length;
       const identifierCoveragePercentage = ((totalPagesProcessed - pagesMissingIdentifiers) / totalPagesProcessed) * 100;
       const isUnsafeDueToMissingIdentifiers = identifierCoveragePercentage < 50;
       
       console.log(`[MAIN] Identifier coverage analysis:`);
       console.log(`[MAIN] - Total pages processed: ${totalPagesProcessed}`);
       console.log(`[MAIN] - Pages missing identifiers: ${pagesMissingIdentifiers}`);
       console.log(`[MAIN] - Identifier coverage: ${identifierCoveragePercentage.toFixed(1)}%`);
       console.log(`[MAIN] - Unsafe due to missing identifiers: ${isUnsafeDueToMissingIdentifiers}`);
       
       // Add identifier coverage info to text analysis
       textAnalysis.identifierCoverage = {
         totalPages: totalPagesProcessed,
         pagesMissingIdentifiers: pagesMissingIdentifiers,
         coveragePercentage: identifierCoveragePercentage,
         isUnsafe: isUnsafeDueToMissingIdentifiers
       };
       
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