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
      
      const prompt = `Extract all text from this medical document image. Return ONLY the extracted text, no explanations or formatting. 

Focus on extracting text from these specific areas:
1. Header section (top 1/3 of page) - look for "NAME" fields, "Hospital #" fields
2. Patient information sections - patient names, hospital numbers (5-6 digit numbers)
3. Medical notes and handwritten text
4. Dates and vital signs
5. All form fields and labels

Extract everything you can read, including handwritten text, but prioritize the header section where patient identifiers are typically located.`;
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

CRITICAL RULES FOR PATIENT NAME IDENTIFICATION:
1. PATIENT NAMES: ONLY extract names from fields explicitly labeled as:
   - "NAME:" or "NAME"
   - "Patient Name:" or "Patient Name"
   - "Patient:" or "Patient"
   - At the very top of medical forms where patient information is listed

2. ABSOLUTELY IGNORE these fields - they are NOT patient names:
   - "Dr." or "Doctor" or "M.D." or "Physician" - these are DOCTOR names
   - "Next of Kin" or "Emergency Contact" - these are FAMILY members
   - "Nursing Staff" or "Nurse" - these are STAFF names
   - "Signature" - these are SIGNATURES
   - Any name that appears after "Dr.", "Doctor", "M.D.", "Physician"
   - Any name that appears after "Next of Kin", "Emergency Contact"
   - Any name that appears after "Nursing Staff", "Nurse"
   - Any name that appears after "Signature"
   - Placeholder text like "-----------------------", "_______________", or repeated dashes/underscores
   - Text that is mostly numbers or special characters

3. PATIENT NAME EXTRACTION RULES:
   - Look ONLY in the header section (first 1/3 of the page)
   - Extract ONLY ONE patient name per page - the FIRST name found in a "NAME:" field
   - If you see "NAME: John Smith" - that's the patient (STOP looking for more names)
   - If you see "Dr. Johnson" later - that's NOT the patient, ignore it
   - If you see "Next of Kin: Mary Smith" - that's NOT the patient, ignore it
   - If you see "Nursing Staff: Sarah Jones" - that's NOT the patient, ignore it
   - If you see "-----------------------" or similar placeholder text - ignore it completely
   - IMPORTANT: Return only the FIRST valid patient name found, not multiple names
   - Handle name variations: "Gerard Hubert", "Gerard Adrian Hubert", "Hubert Gerard" might be the same person

4. HOSPITAL NUMBER EXTRACTION:
   - Look for 5-6 digit numbers in fields labeled "Hospital #", "Hospital Number", "Patient ID"
   - The FIRST 6-digit number that appears is usually the hospital number
   - Focus on the header section of medical forms
   - IGNORE placeholder text like "-----------------------", "_______________", or repeated dashes/underscores
   - IGNORE text that is mostly special characters or non-numeric content

5. MULTIPLE PATIENT DETECTION:
   - Only flag as multiple patients if you find DIFFERENT names in "NAME:" fields
   - Same name appearing multiple times = single patient
   - Different names in different sections (doctor, next of kin) = single patient
   - Example: "NAME: John Smith" + "Dr. Johnson" = ONE patient (John Smith)
   - Example: "NAME: John Smith" + "Next of Kin: Mary Smith" = ONE patient (John Smith)

6. DATE EXTRACTION:
   - Look for the date when the medical note was written
   - PRIORITY: If "Admission Date" is found, use it as the primary date
   - Common formats: DD/MM/YY, DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD, DD-MM-YYYY
   - Look for dates in fields like "DATE:", "Date:", "Note Date:", "Written:", "Document Date:", "Admission Date:"
   - If no clearly identified date can be found on a page, do NOT mark it as missing - assume it's correctly scanned

7. VALIDATION RULES:
   - Hospital numbers are 5-6 digit numbers only (no "MR" prefix)
   - ONLY count names in "NAME:" fields as patient names
   - Doctor names, staff names, next of kin names are NEVER patient names
   - Extract ONLY ONE patient name per page (the first valid one found)
   - If the SAME patient name appears on multiple pages, count it as ONE patient
   - We accept either a patient name OR hospital number per page
   - DO NOT return multiple names for a single page

RESPOND WITH ONLY VALID JSON. No additional text, explanations, or markdown formatting.

EXAMPLE FORMAT (replace with actual data found):
{
  "patientIdentifiers": {
    "names": ["John Smith"],  // Only ONE name per page
    "hospitalNumbers": ["123456"]  // Only ONE hospital number per page
  },
  "multiplePatients": {
    "detected": false,
    "evidence": "",
    "pages": []
  },
  "dateIssues": {
    "mismatches": [],
    "missingDates": [],
    "pageDates": []
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
        
        const analysis = JSON.parse(jsonText);
        
        // POST-PROCESSING VALIDATION: Filter out non-patient names, handle variations, and ensure one name per page
        if (analysis.patientIdentifiers && analysis.patientIdentifiers.names && analysis.patientIdentifiers.names.length > 0) {
          const originalNames = [...analysis.patientIdentifiers.names];
          
          // First filter out non-patient names and placeholder text
          const filteredNames = originalNames.filter(name => {
            // Remove placeholder text (dashes, underscores, etc.)
            if (name.match(/^[-_=\s]+$/) || name.includes('-----------------------') || name.includes('_______________')) {
              console.log(`[TEXT] Filtered out placeholder text: ${name}`);
              return false;
            }
            
            // Remove doctor names
            if (name.toLowerCase().includes('dr.') || 
                name.toLowerCase().includes('doctor') || 
                name.toLowerCase().includes('m.d.') ||
                name.toLowerCase().includes('physician')) {
              console.log(`[TEXT] Filtered out doctor name: ${name}`);
              return false;
            }
            
            // Remove names that are likely staff or next of kin
            if (name.toLowerCase().includes('nurse') || 
                name.toLowerCase().includes('staff') ||
                name.toLowerCase().includes('signature')) {
              console.log(`[TEXT] Filtered out staff/signature name: ${name}`);
              return false;
            }
            
            // Remove single names that are likely last names only
            if (name.split(' ').length === 1 && name.length < 8) {
              console.log(`[TEXT] Filtered out likely last name only: ${name}`);
              return false;
            }
            
            // Remove names that are mostly numbers or special characters
            if (name.match(/^[0-9\s\-_=]+$/)) {
              console.log(`[TEXT] Filtered out numeric/special character name: ${name}`);
              return false;
            }
            
            return true;
          });
          
          // Handle name variations - consolidate similar names
          const consolidatedNames = this.consolidateNameVariations(filteredNames);
          
          // Then ensure only one name per page (keep the first valid name found)
          if (consolidatedNames.length > 1) {
            console.log(`[TEXT] Multiple names detected after consolidation: ${consolidatedNames.join(', ')}`);
            console.log(`[TEXT] Keeping only the first name: ${consolidatedNames[0]}`);
            analysis.patientIdentifiers.names = [consolidatedNames[0]];
          } else if (consolidatedNames.length === 1) {
            analysis.patientIdentifiers.names = consolidatedNames;
          } else {
            analysis.patientIdentifiers.names = [];
          }
          
          if (analysis.patientIdentifiers.names.length !== originalNames.length) {
            console.log(`[TEXT] Post-processing result: ${originalNames.length} -> ${analysis.patientIdentifiers.names.length} names`);
            console.log(`[TEXT] Final patient name(s):`, analysis.patientIdentifiers.names);
          }
        }

        // POST-PROCESSING VALIDATION: Filter out placeholder text from hospital numbers
        if (analysis.patientIdentifiers && analysis.patientIdentifiers.hospitalNumbers && analysis.patientIdentifiers.hospitalNumbers.length > 0) {
          const originalNumbers = [...analysis.patientIdentifiers.hospitalNumbers];
          
          const filteredNumbers = originalNumbers.filter(number => {
            // Remove placeholder text (dashes, underscores, etc.)
            if (number.match(/^[-_=\s]+$/) || number.includes('-----------------------') || number.includes('_______________')) {
              console.log(`[TEXT] Filtered out placeholder hospital number: ${number}`);
              return false;
            }
            
            // Remove text that is mostly special characters
            if (number.match(/^[^0-9]+$/)) {
              console.log(`[TEXT] Filtered out non-numeric hospital number: ${number}`);
              return false;
            }
            
            // Keep only numbers that look like actual hospital numbers (5-6 digits)
            if (!number.match(/^\d{5,6}$/)) {
              console.log(`[TEXT] Filtered out invalid hospital number format: ${number}`);
              return false;
            }
            
            return true;
          });
          
          analysis.patientIdentifiers.hospitalNumbers = filteredNumbers;
          
          if (analysis.patientIdentifiers.hospitalNumbers.length !== originalNumbers.length) {
            console.log(`[TEXT] Hospital number post-processing result: ${originalNumbers.length} -> ${analysis.patientIdentifiers.hospitalNumbers.length} numbers`);
            console.log(`[TEXT] Final hospital number(s):`, analysis.patientIdentifiers.hospitalNumbers);
          }
        }
        
        return analysis;
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

  // Consolidate name variations to handle different formats of the same person's name
  consolidateNameVariations(names) {
    if (!names || names.length <= 1) {
      return names;
    }

    console.log(`[TEXT] Consolidating name variations: ${names.join(', ')}`);
    
    const normalizedNames = names.map(name => ({
      original: name,
      normalized: this.normalizeName(name)
    }));

    const consolidated = [];
    const processed = new Set();

    for (let i = 0; i < normalizedNames.length; i++) {
      if (processed.has(i)) continue;

      const current = normalizedNames[i];
      const similarNames = [current.original];

      // Check for similar names
      for (let j = i + 1; j < normalizedNames.length; j++) {
        if (processed.has(j)) continue;

        const other = normalizedNames[j];
        if (this.areNamesSimilar(current.normalized, other.normalized)) {
          similarNames.push(other.original);
          processed.add(j);
          console.log(`[TEXT] Found similar names: "${current.original}" and "${other.original}"`);
        }
      }

      // Choose the best representation (prefer longer, more complete names)
      const bestName = this.selectBestName(similarNames);
      consolidated.push(bestName);
      processed.add(i);
    }

    console.log(`[TEXT] Name consolidation result: ${names.length} -> ${consolidated.length} unique names`);
    return consolidated;
  }

  // Normalize a name for comparison (remove extra spaces, convert to lowercase, etc.)
  normalizeName(name) {
    return name
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ') // Replace multiple spaces with single space
      .replace(/[^\w\s]/g, ''); // Remove special characters except spaces
  }

  // Check if two normalized names are similar (same person with variations)
  areNamesSimilar(name1, name2) {
    if (name1 === name2) return true;

    const words1 = name1.split(' ').filter(w => w.length > 0);
    const words2 = name2.split(' ').filter(w => w.length > 0);

    if (words1.length === 0 || words2.length === 0) return false;

    // Check if they share at least 2 words (for names with 3+ words)
    // or if they share at least 1 word (for shorter names)
    const minSharedWords = Math.min(words1.length, words2.length) >= 3 ? 2 : 1;
    
    const sharedWords = words1.filter(word1 => 
      words2.some(word2 => word2.includes(word1) || word1.includes(word2))
    );

    return sharedWords.length >= minSharedWords;
  }

  // Select the best name from a list of similar names
  selectBestName(names) {
    if (names.length === 1) return names[0];

    // Prefer names with more words (more complete)
    const sortedByWordCount = names.sort((a, b) => {
      const aWords = a.split(' ').filter(w => w.length > 0).length;
      const bWords = b.split(' ').filter(w => w.length > 0).length;
      return bWords - aWords;
    });

    // Among names with the same word count, prefer the first one (usually the most complete)
    return sortedByWordCount[0];
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

  combinePageAnalyses(pageAnalyses, fileName) {
    console.log(`[COMBINE] Combining ${pageAnalyses.length} page analyses...`);
    
    if (pageAnalyses.length === 0) {
      return {
        patientIdentifiers: { names: [], hospitalNumbers: [] },
        multiplePatients: { detected: false, evidence: '', pages: [] },
        dateIssues: { detected: false, evidence: '', pages: [] },
        pagesWithoutIdentifiers: [],
        extractedDates: []
      };
    }

    // Initialize combined analysis
    const combinedAnalysis = {
      patientIdentifiers: { names: [], hospitalNumbers: [] },
      multiplePatients: { detected: false, evidence: '', pages: [] },
      dateIssues: { detected: false, evidence: '', pages: [] },
      pagesWithoutIdentifiers: [],
      extractedDates: []
    };

    // Collect all patient identifiers from all pages
    const allNames = [];
    const allHospitalNumbers = [];
    const allDates = [];
    const pagesWithoutIdentifiers = [];

    pageAnalyses.forEach((pageAnalysis, index) => {
      const pageNumber = pageAnalysis.pageNumber || (index + 1);
      
      // Add patient names from this page
      if (pageAnalysis.patientIdentifiers && pageAnalysis.patientIdentifiers.names) {
        pageAnalysis.patientIdentifiers.names.forEach(name => {
          allNames.push({ name, page: pageNumber });
        });
      }
      
      // Add hospital numbers from this page
      if (pageAnalysis.patientIdentifiers && pageAnalysis.patientIdentifiers.hospitalNumbers) {
        pageAnalysis.patientIdentifiers.hospitalNumbers.forEach(number => {
          allHospitalNumbers.push({ number, page: pageNumber });
        });
      }
      
      // Add dates from this page
      if (pageAnalysis.extractedDates) {
        pageAnalysis.extractedDates.forEach(date => {
          allDates.push({ ...date, page: pageNumber });
        });
      }
      
      // Check if this page has no identifiers
      const hasNames = pageAnalysis.patientIdentifiers && pageAnalysis.patientIdentifiers.names && pageAnalysis.patientIdentifiers.names.length > 0;
      const hasNumbers = pageAnalysis.patientIdentifiers && pageAnalysis.patientIdentifiers.hospitalNumbers && pageAnalysis.patientIdentifiers.hospitalNumbers.length > 0;
      
      if (!hasNames && !hasNumbers) {
        pagesWithoutIdentifiers.push(pageNumber);
      }
    });

    // Set combined patient identifiers with name consolidation
    const allNameStrings = allNames.map(item => item.name);
    console.log(`[COMBINE] All names before consolidation: ${allNameStrings.join(', ')}`);
    combinedAnalysis.patientIdentifiers.names = this.consolidateNameVariations(allNameStrings);
    console.log(`[COMBINE] Names after consolidation: ${combinedAnalysis.patientIdentifiers.names.join(', ')}`);
    combinedAnalysis.patientIdentifiers.hospitalNumbers = allHospitalNumbers.map(item => item.number);
    combinedAnalysis.extractedDates = allDates;
    combinedAnalysis.pagesWithoutIdentifiers = pagesWithoutIdentifiers;

    // Check for multiple patients (using consolidated names)
    const uniqueNumbers = [...new Set(allHospitalNumbers.map(item => item.number))];
    
    if (combinedAnalysis.patientIdentifiers.names.length > 1) {
      combinedAnalysis.multiplePatients = {
        detected: true,
        evidence: `Multiple different patient names found: ${combinedAnalysis.patientIdentifiers.names.join(', ')}`,
        pages: [...new Set(allNames.map(item => item.page))]
      };
    } else if (uniqueNumbers.length > 1 && combinedAnalysis.patientIdentifiers.names.length === 1) {
      // Same name but different hospital numbers
      combinedAnalysis.multiplePatients = {
        detected: true,
        evidence: `Same patient name (${combinedAnalysis.patientIdentifiers.names[0]}) found with multiple different hospital numbers: ${uniqueNumbers.join(', ')}. This may indicate multiple patients or data inconsistency.`,
        pages: [...new Set(allHospitalNumbers.map(item => item.page))]
      };
    }

    // Check for date issues (chronological order)
    if (allDates.length > 1) {
      const sortedDates = allDates
        .filter(date => date.parsedDate)
        .sort((a, b) => new Date(a.parsedDate) - new Date(b.parsedDate));
      
      if (sortedDates.length > 1) {
        // Check if pages are in chronological order
        const pageOrder = sortedDates.map(date => date.page);
        const expectedOrder = [...new Set(pageOrder)].sort((a, b) => a - b);
        
        if (JSON.stringify(pageOrder) !== JSON.stringify(expectedOrder)) {
          combinedAnalysis.dateIssues = {
            detected: true,
            evidence: `Pages appear to be out of chronological order. Expected order: ${expectedOrder.join(', ')}, but found: ${pageOrder.join(', ')}`,
            pages: pageOrder
          };
        }
      }
    }

    console.log(`[COMBINE] Combined analysis result:`);
    console.log(`[COMBINE] - Total names: ${combinedAnalysis.patientIdentifiers.names.length}`);
    console.log(`[COMBINE] - Total hospital numbers: ${combinedAnalysis.patientIdentifiers.hospitalNumbers.length}`);
    console.log(`[COMBINE] - Multiple patients detected: ${combinedAnalysis.multiplePatients.detected}`);
    console.log(`[COMBINE] - Date issues detected: ${combinedAnalysis.dateIssues.detected}`);
    console.log(`[COMBINE] - Pages without identifiers: ${combinedAnalysis.pagesWithoutIdentifiers.length}`);

    return combinedAnalysis;
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

Multiple Patient Detection Rules:
- Only flag as multiple patients if DIFFERENT patient names appear in "NAME" fields
- Same patient name appearing multiple times = single patient (safe) - even across different pages
- Same patient name on page 1 and page 2 = ONE patient (safe)
- Different names in different sections (doctor, next of kin, staff) = single patient (safe)
- Doctor names, staff names, next of kin names are NOT patient names
- The FIRST name that appears on the page is usually the patient's name
- The FIRST 6-digit number that appears on the page is usually the hospital number
- IGNORE these fields completely: "Next of Kin", "Emergency Contact", "M.D.", "Doctor", "Nursing Staff", "Signature"
- Example: "NAME: Hershelle Stephen" + "Next of Kin: Edmira Stephen" = ONE patient (Hershelle Stephen)
- Example: "NAME: Hershelle Stephen" on page 1 + "NAME: Hershelle Stephen" on page 2 = ONE patient (Hershelle Stephen)

IMPORTANT LOGIC RULES: 
- If identifierCoverage.coveragePercentage is GREATER THAN OR EQUAL TO 50%, the document is SAFE for identifier coverage
- If identifierCoverage.coveragePercentage is LESS THAN 50%, mark as UNSAFE and add "Low identifier coverage (X% below 50% threshold)" to priorityIssues
- If identifierCoverage.coveragePercentage >= 50%, DO NOT add "missing patient identifiers" issues to priorityIssues
- If multiplePatients.detected is FALSE, there are NO multiple patient issues
- If multiplePatients.detected is TRUE, mark as UNSAFE and add "Multiple patients detected in single document" to priorityIssues
- If there are critical date mismatches, mark as UNSAFE and add "Critical date mismatches detected" to priorityIssues
- If identifierCoverage.coveragePercentage >= 50% AND multiplePatients.detected is FALSE, the document should be marked as SAFE
- Populate priorityIssues array with specific descriptions of the most critical problems found
- priorityIssues should be an array of strings (e.g., ["Low identifier coverage", "Multiple patients detected"])
- DO NOT generate unnecessary recommendations when the document is SAFE
- If the document is SAFE, do NOT add "Implement a rescan" or similar scanning recommendations to immediateActions
- Only add rescanning recommendations when there are actual image quality issues (blurry, dark, unreadable pages)
- Chronological order issues will be automatically detected and added to recommendations
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
        
        const parsedRecommendations = JSON.parse(jsonText);
        
        // Fix common AI typos in JSON keys
        if (parsedRecommendations.recommendaions) {
          parsedRecommendations.recommendations = parsedRecommendations.recommendaions;
          delete parsedRecommendations.recommendaions;
          console.log('[RECOMMENDATIONS] Fixed typo: recommendaions -> recommendations');
        }
        
        if (parsedRecommendations.safetyAssesment) {
          parsedRecommendations.safetyAssessment = parsedRecommendations.safetyAssesment;
          delete parsedRecommendations.safetyAssesment;
          console.log('[RECOMMENDATIONS] Fixed typo: safetyAssesment -> safetyAssessment');
        }
        
        if (parsedRecommendations.priorityIsssues) {
          parsedRecommendations.priorityIssues = parsedRecommendations.priorityIsssues;
          delete parsedRecommendations.priorityIsssues;
          console.log('[RECOMMENDATIONS] Fixed typo: priorityIsssues -> priorityIssues');
        }
        
        // Ensure required fields exist
        if (!parsedRecommendations.recommendations) {
          parsedRecommendations.recommendations = { manualReview: [], rescanning: [], verification: [], corrections: [] };
        }
        if (!parsedRecommendations.safetyAssessment) {
          parsedRecommendations.safetyAssessment = { safeForUse: false, reason: 'Analysis failed', riskLevel: 'high', immediateActions: [] };
        }
        if (!parsedRecommendations.priorityIssues) {
          parsedRecommendations.priorityIssues = [];
        }
        if (!parsedRecommendations.complianceStatus) {
          parsedRecommendations.complianceStatus = 'needs-review';
        }
        
        // Validate chronological order
        const chronologicalValidation = this.validateChronologicalOrder(textAnalysis);
        
        // Add chronological issues to recommendations if found
        if (!chronologicalValidation.isChronological) {
          if (!parsedRecommendations.priorityIssues) {
            parsedRecommendations.priorityIssues = [];
          }
          
          // Handle multiple patients case differently
          if (chronologicalValidation.multiplePatientsDetected) {
            parsedRecommendations.priorityIssues.push('Multiple patients detected - chronological order cannot be validated');
            if (!parsedRecommendations.safetyAssessment.immediateActions) {
              parsedRecommendations.safetyAssessment.immediateActions = [];
            }
            parsedRecommendations.safetyAssessment.immediateActions.push('Separate patients into individual documents for proper chronological validation');
          } else {
            // Regular chronological order issues
            parsedRecommendations.priorityIssues.push(...chronologicalValidation.issues);
            if (!parsedRecommendations.safetyAssessment.immediateActions) {
              parsedRecommendations.safetyAssessment.immediateActions = [];
            }
            parsedRecommendations.safetyAssessment.immediateActions.push('Review page order - pages appear out of chronological sequence');
          }
        }
        
        // Validate and correct AI errors
        const validatedRecommendations = this.validateRecommendations(parsedRecommendations, textAnalysis);
        
        return validatedRecommendations;
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

  // Validate and correct AI recommendations
  validateRecommendations(recommendations, textAnalysis) {
    console.log('[VALIDATION] Validating AI recommendations...');
    
    const coveragePercentage = textAnalysis.identifierCoverage?.coveragePercentage || 0;
    const multiplePatientsDetected = textAnalysis.multiplePatients?.detected || false;
    
    console.log('[VALIDATION] Coverage:', coveragePercentage + '%');
    console.log('[VALIDATION] Multiple Patients:', multiplePatientsDetected);
    
    // Check for impossible logic errors
    let corrected = false;
    const correctedPriorityIssues = [];
    
    // Helper function to extract issue text (handles both string and object formats)
    const getIssueText = (issue) => {
      if (typeof issue === 'string') {
        return issue;
      } else if (issue && typeof issue === 'object' && issue.description) {
        return issue.description;
      }
      return '';
    };
    
    // Remove impossible coverage issues
    if (coveragePercentage >= 50) {
      // Remove any "low identifier coverage" issues and "missing identifiers" when coverage is good
      const filteredIssues = (recommendations.priorityIssues || []).filter(issue => {
        const issueText = getIssueText(issue).toLowerCase();
        return !issueText.includes('low identifier coverage') &&
               !issueText.includes('below 50% threshold') &&
               !issueText.includes('missing patient identifiers on some pages') &&
               !issueText.includes('missing patient identifiers');
      });
      
      if (filteredIssues.length !== (recommendations.priorityIssues || []).length) {
        corrected = true;
        console.log('[VALIDATION] Removed impossible low coverage and missing identifier issues');
      }
      correctedPriorityIssues.push(...filteredIssues);
    } else {
      correctedPriorityIssues.push(...(recommendations.priorityIssues || []));
    }
    
    // Check for multiple patient logic
    if (!multiplePatientsDetected) {
      // Remove any multiple patient issues
      const filteredIssues = correctedPriorityIssues.filter(issue => {
        const issueText = getIssueText(issue).toLowerCase();
        return !issueText.includes('multiple patients') &&
               !issueText.includes('multiple patient');
      });
      
      if (filteredIssues.length !== correctedPriorityIssues.length) {
        corrected = true;
        console.log('[VALIDATION] Removed impossible multiple patient issues');
      }
      correctedPriorityIssues.length = 0;
      correctedPriorityIssues.push(...filteredIssues);
    }
    
    // Determine correct safety assessment
    const shouldBeSafe = coveragePercentage >= 50 && !multiplePatientsDetected;
    const currentSafe = recommendations.safetyAssessment?.safeForUse || false;
    
    if (shouldBeSafe !== currentSafe) {
      corrected = true;
      console.log('[VALIDATION] Correcting safety assessment from', currentSafe, 'to', shouldBeSafe);
    }
    
    // Filter out unnecessary rescanning recommendations when document is safe
    let correctedImmediateActions = recommendations.safetyAssessment?.immediateActions || [];
    if (shouldBeSafe) {
      correctedImmediateActions = correctedImmediateActions.filter(action => 
        !action.toLowerCase().includes('rescan') &&
        !action.toLowerCase().includes('scan') &&
        !action.toLowerCase().includes('implement a rescan')
      );
      if (correctedImmediateActions.length !== (recommendations.safetyAssessment?.immediateActions || []).length) {
        corrected = true;
        console.log('[VALIDATION] Removed unnecessary rescanning recommendations');
      }
    }
    
    if (corrected) {
      console.log('[VALIDATION] AI recommendations corrected due to logic errors');
      return {
        ...recommendations,
        priorityIssues: correctedPriorityIssues,
        safetyAssessment: {
          ...recommendations.safetyAssessment,
          safeForUse: shouldBeSafe,
          reason: shouldBeSafe ? 'Document meets safety criteria' : 'Document has safety issues',
          riskLevel: shouldBeSafe ? 'low' : 'high',
          immediateActions: correctedImmediateActions
        },
        complianceStatus: shouldBeSafe ? 'approved' : 'needs-review'
      };
    }
    
    // Even if no other corrections were made, ensure rescan recommendations are filtered when safe
    if (shouldBeSafe && (recommendations.safetyAssessment?.immediateActions || []).some(action => 
      action.toLowerCase().includes('rescan') || 
      action.toLowerCase().includes('scan') || 
      action.toLowerCase().includes('implement a rescan')
    )) {
      console.log('[VALIDATION] Document is safe but has rescan recommendations - filtering them out');
      const filteredImmediateActions = (recommendations.safetyAssessment?.immediateActions || []).filter(action => 
        !action.toLowerCase().includes('rescan') &&
        !action.toLowerCase().includes('scan') &&
        !action.toLowerCase().includes('implement a rescan')
      );
      
      return {
        ...recommendations,
        safetyAssessment: {
          ...recommendations.safetyAssessment,
          immediateActions: filteredImmediateActions
        }
      };
    }
    
    console.log('[VALIDATION] AI recommendations are valid');
    return recommendations;
  }

  // Validate chronological order of page dates
  validateChronologicalOrder(textAnalysis) {
    console.log('[CHRONOLOGY] Validating chronological order of page dates...');
    
    // Check if multiple patients are detected
    const hasMultiplePatients = textAnalysis.multiplePatients?.detected || false;
    
    if (hasMultiplePatients) {
      console.log('[CHRONOLOGY] Multiple patients detected - chronological order check skipped');
      return {
        isChronological: false,
        outOfOrderPages: [],
        missingDates: [],
        issues: ['Multiple patients detected - chronological order cannot be validated'],
        multiplePatientsDetected: true
      };
    }
    
    const pageDates = textAnalysis.dateIssues?.pageDates || [];
    console.log('[CHRONOLOGY] Page dates found:', JSON.stringify(pageDates, null, 2));
    
    if (pageDates.length < 2) {
      console.log('[CHRONOLOGY] Not enough dates to validate chronological order');
      return {
        isChronological: true,
        outOfOrderPages: [],
        missingDates: pageDates.filter(d => !d.date).map(d => d.page),
        issues: []
      };
    }
    
    const chronologicalIssues = [];
    const outOfOrderPages = [];
    
    // Sort dates by page number to get expected order
    const sortedByPage = [...pageDates].sort((a, b) => a.page - b.page);
    console.log('[CHRONOLOGY] Dates sorted by page number:', JSON.stringify(sortedByPage, null, 2));
    
    // Check if dates are in chronological order (ascending: earlier dates first)
    for (let i = 1; i < sortedByPage.length; i++) {
      const current = sortedByPage[i];
      const previous = sortedByPage[i - 1];
      
      if (current.date && previous.date) {
        const currentDate = new Date(current.date);
        const previousDate = new Date(previous.date);
        
        console.log(`[CHRONOLOGY] Comparing: Page ${previous.page} (${previous.date}) vs Page ${current.page} (${current.date})`);
        console.log(`[CHRONOLOGY] Date objects: ${previousDate.toISOString()} vs ${currentDate.toISOString()}`);
        
        if (currentDate < previousDate) {
          const issue = `Page ${current.page} (${current.date}) appears before Page ${previous.page} (${previous.date}) - OUT OF ORDER`;
          console.log(`[CHRONOLOGY] ISSUE FOUND: ${issue}`);
          chronologicalIssues.push(issue);
          outOfOrderPages.push({
            page: current.page,
            date: current.date,
            expectedAfter: previous.page,
            expectedAfterDate: previous.date
          });
        } else {
          console.log(`[CHRONOLOGY] ✓ Page ${current.page} is correctly after Page ${previous.page}`);
        }
      } else {
        console.log(`[CHRONOLOGY] Skipping comparison - missing date on page ${current.page} or ${previous.page}`);
      }
    }
    
    // Note: Missing dates are not treated as issues - they are assumed to be correctly scanned
    const missingDates = pageDates.filter(d => !d.date).map(d => d.page);
    
    console.log('[CHRONOLOGY] Validation complete:', {
      isChronological: chronologicalIssues.length === 0,
      outOfOrderPages: outOfOrderPages.length,
      missingDates: missingDates.length,
      note: 'Missing dates are not treated as errors - assumed correctly scanned'
    });
    
    return {
      isChronological: chronologicalIssues.length === 0,
      outOfOrderPages,
      missingDates,
      issues: chronologicalIssues
    };
  }

  // Generate comprehensive report
  generateReport(fileName, textAnalysis, imageAnalysis, recommendations, totalPages) {
    const scanDate = new Date().toISOString().split('T')[0];
    
    // Create summary table
    const summaryTable = this.createSummaryTable(textAnalysis, imageAnalysis, recommendations);
    
    // Determine if file is safe
    const isSafe = recommendations.safetyAssessment?.safeForUse || false;
    
    // Add console.log to debug detailedFindings
    const detailedFindings = {
      imageQualityIssues: this.formatImageQualityIssues(imageAnalysis),
      pageSequence: this.formatPageSequenceIssues(imageAnalysis),
      dataExtraction: this.formatDataExtractionIssues(textAnalysis)
    };
    
    console.log('[REPORT] Detailed findings structure:', JSON.stringify(detailedFindings, null, 2));
    
    return {
      fileInformation: {
        fileName: fileName,
        scanDate: scanDate,
        totalPages: totalPages
      },
      summaryTable: summaryTable,
      detailedFindings: detailedFindings,
      // Include patientIdentifiers for privacy feature
      patientIdentifiers: textAnalysis.patientIdentifiers || { names: [], hospitalNumbers: [] },
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
       const findings = [];
       
       // Add positive findings
       if (!imageAnalysis.imageQuality?.hasBlurryPages) {
         findings.push('Blurry images: No');
       } else {
         findings.push(`Blurry images: Pages ${imageAnalysis.imageQuality.blurryPages.join(', ')}`);
       }
       
       if (!imageAnalysis.imageQuality?.hasDarkPages) {
         findings.push('Dark images: No');
       } else {
         findings.push(`Dark images: Pages ${imageAnalysis.imageQuality.darkPages.join(', ')}`);
       }
       
       if (!imageAnalysis.imageQuality?.hasLightPages) {
         findings.push('Light/washed out images: No');
       } else {
         findings.push(`Light/washed out images: Pages ${imageAnalysis.imageQuality.lightPages.join(', ')}`);
       }
       
       if (!imageAnalysis.imageQuality?.hasUnreadablePages) {
         findings.push('Unreadable images: No');
       } else {
         findings.push(`Unreadable images: Pages ${imageAnalysis.imageQuality.unreadablePages.join(', ')}`);
       }
       
       return {
         hasBlurryPages: imageAnalysis.imageQuality?.hasBlurryPages || false,
         blurryPages: imageAnalysis.imageQuality?.blurryPages || [],
         hasDarkPages: imageAnalysis.imageQuality?.hasDarkPages || false,
         darkPages: imageAnalysis.imageQuality?.darkPages || [],
         hasLightPages: imageAnalysis.imageQuality?.hasLightPages || false,
         lightPages: imageAnalysis.imageQuality?.lightPages || [],
         hasUnreadablePages: imageAnalysis.imageQuality?.hasUnreadablePages || false,
         unreadablePages: imageAnalysis.imageQuality?.unreadablePages || [],
         positiveFindings: findings
       };
     }

     formatPageSequenceIssues(imageAnalysis) {
       const findings = [];
       
       // Add positive findings for page completeness
       if (!imageAnalysis.pageCompleteness?.hasCutoffPages) {
         findings.push('Cut-off pages: No');
       } else {
         findings.push(`Cut-off pages: Pages ${imageAnalysis.pageCompleteness.cutoffPages.join(', ')}`);
       }
       
       if (!imageAnalysis.pageCompleteness?.hasIncompletePages) {
         findings.push('Incomplete pages: No');
       } else {
         findings.push(`Incomplete pages: Pages ${imageAnalysis.pageCompleteness.incompletePages.join(', ')}`);
       }
       
       if (!imageAnalysis.duplicates?.hasDuplicatePages) {
         findings.push('Duplicate pages: No');
       } else {
         findings.push(`Duplicate pages: ${imageAnalysis.duplicates.duplicatePages.map(d => d.pages.join(' and ')).join(', ')}`);
       }
       
       // Add positive findings for orientation
       if (!imageAnalysis.orientation?.hasUpsideDown) {
         findings.push('Upside down pages: No');
       } else {
         findings.push(`Upside down pages: Pages ${imageAnalysis.orientation.upsideDown.join(', ')}`);
       }
       
       if (!imageAnalysis.orientation?.hasSideways) {
         findings.push('Sideways pages: No');
       } else {
         findings.push(`Sideways pages: Pages ${imageAnalysis.orientation.sideways.join(', ')}`);
       }
       
       if (!imageAnalysis.orientation?.hasMisaligned) {
         findings.push('Misaligned pages: No');
       } else {
         findings.push(`Misaligned pages: Pages ${imageAnalysis.orientation.misaligned.join(', ')}`);
       }
       
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
         },
         positiveFindings: findings
       };
     }

  formatDataExtractionIssues(textAnalysis) {
    const findings = [];
    
    // Add positive findings with privacy masking for UNIQUE patient names and IDs only
    if (textAnalysis.patientIdentifiers?.names && textAnalysis.patientIdentifiers.names.length > 0) {
      // Get unique names to avoid duplicates
      const uniqueNames = [...new Set(textAnalysis.patientIdentifiers.names)];
      uniqueNames.forEach((name, index) => {
        findings.push({
          type: 'patient_name',
          label: `Patient name ${uniqueNames.length > 1 ? index + 1 : ''} found`,
          value: name,
          masked: '••••••••••'
        });
      });
    }
    
    if (textAnalysis.patientIdentifiers?.hospitalNumbers && textAnalysis.patientIdentifiers.hospitalNumbers.length > 0) {
      // Get unique hospital numbers to avoid duplicates
      const uniqueHospitalNumbers = [...new Set(textAnalysis.patientIdentifiers.hospitalNumbers)];
      uniqueHospitalNumbers.forEach((id, index) => {
        findings.push({
          type: 'hospital_id',
          label: `Hospital ID ${uniqueHospitalNumbers.length > 1 ? index + 1 : ''} found`,
          value: id,
          masked: '••••••'
        });
      });
    }
    
    if (textAnalysis.identifierCoverage?.coveragePercentage >= 50) {
      findings.push(`Identifier coverage: ${textAnalysis.identifierCoverage.coveragePercentage.toFixed(1)}% (meets threshold)`);
    } else {
      findings.push(`Identifier coverage: ${textAnalysis.identifierCoverage?.coveragePercentage.toFixed(1) || 0}% (below threshold)`);
    }
    
    if (!textAnalysis.multiplePatients?.detected) {
      findings.push('Multiple patients: No');
    } else {
      findings.push('Multiple patients: Yes');
    }
    
    if (!textAnalysis.dateIssues?.mismatches || textAnalysis.dateIssues.mismatches.length === 0) {
      findings.push('Date mismatches: No');
    } else {
      findings.push(`Date mismatches: ${textAnalysis.dateIssues.mismatches.length} found`);
    }
    
    // Add chronological order findings
    const chronologicalValidation = this.validateChronologicalOrder(textAnalysis);
    if (chronologicalValidation.isChronological) {
      findings.push('Chronological order: Pages are in correct sequence');
    } else {
      findings.push(`Chronological order: ${chronologicalValidation.outOfOrderPages.length} pages out of sequence`);
    }
    
    if (chronologicalValidation.missingDates.length === 0) {
      findings.push('Missing dates: No');
    } else {
      findings.push(`Missing dates: Pages ${chronologicalValidation.missingDates.join(', ')} (assumed correctly scanned)`);
    }
    
    return {
      pagesWithoutIdentifiers: textAnalysis.pagesWithoutIdentifiers || [],
      multiplePatients: textAnalysis.multiplePatients || { detected: false, evidence: '', pages: [] },
      dateMismatches: textAnalysis.dateIssues?.mismatches || [],
      chronologicalIssues: chronologicalValidation,
      positiveFindings: findings
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
      
      // Step 3: Analyze text with Gemma 3n - PER PAGE ANALYSIS
      console.log('Analyzing text content per page...');
      console.log(`[MAIN] Number of pages to analyze: ${pageTexts.length}`);
      
      if (pageTexts.length === 0) {
        console.log(`[MAIN] WARNING: No text extracted from any pages!`);
        console.log(`[MAIN] This will result in no findings being generated.`);
      }
      
      // Analyze each page individually to ensure "one name per page" rule is applied correctly
      const pageAnalyses = [];
      for (let i = 0; i < pageTexts.length; i++) {
        const pageData = pageTexts[i];
        console.log(`[MAIN] Analyzing page ${pageData.page} (${pageData.text.length} characters)...`);
        
        try {
          const pageAnalysis = await this.analyzeTextWithGemma(pageData.text, `${fileName} - Page ${pageData.page}`);
          pageAnalysis.pageNumber = pageData.page;
          pageAnalyses.push(pageAnalysis);
          console.log(`[MAIN] Page ${pageData.page} analysis completed`);
        } catch (error) {
          console.error(`[MAIN] Failed to analyze page ${pageData.page}:`, error);
          // Continue with next page
        }
      }
      
      // Combine all page analyses into a single text analysis
      const textAnalysis = this.combinePageAnalyses(pageAnalyses, fileName);
      console.log(`[MAIN] Combined text analysis completed`);
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