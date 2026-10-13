const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const { spawn } = require('child_process');
const readline = require('readline');

class TrainingDataCreator {
  constructor() {
    this.ollamaBaseUrl = 'http://127.0.0.1:11434';
    this.trainingDataPath = path.join(__dirname, 'training_data.json');
    this.trainingData = [];
    this.loadTrainingData();
  }

  async loadTrainingData() {
    try {
      if (await fs.pathExists(this.trainingDataPath)) {
        const data = await fs.readJson(this.trainingDataPath);
        this.trainingData = data.trainingData || [];
        console.log(`[TRAINING] Loaded ${this.trainingData.length} training examples`);
      }
    } catch (error) {
      console.log('[TRAINING] No existing training data found, starting fresh');
      this.trainingData = [];
    }
  }

  async saveTrainingData() {
    try {
      await fs.writeJson(this.trainingDataPath, {
        trainingData: this.trainingData,
        lastUpdated: new Date().toISOString(),
        totalExamples: this.trainingData.length
      }, { spaces: 2 });
      console.log(`[TRAINING] Saved ${this.trainingData.length} training examples`);
    } catch (error) {
      console.error('[TRAINING] Error saving training data:', error);
    }
  }

  // Convert PDF to images using the same method as main app
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

  // Extract text using OCR (same as main app)
  async extractTextWithOCR(imagePath) {
    console.log(`[OCR] Starting text extraction for: ${imagePath}`);
    try {
      const imageBuffer = await fs.readFile(imagePath);
      
      if (imageBuffer.length > 3000000) {
        console.log(`[OCR] Image too large (${imageBuffer.length} bytes), skipping OCR`);
        return '';
      }
      
      const base64Image = imageBuffer.toString('base64');
      
      const prompt = `Extract all text from this medical document image. Return ONLY the extracted text, no explanations or formatting.`;
      
      const response = await axios.post(`${this.ollamaBaseUrl}/api/generate`, {
        model: 'qwen2.5vl:7b',
        prompt: prompt,
        images: [base64Image],
        stream: false
      });

      return response.data.response.trim();
    } catch (error) {
      console.error('[OCR] Error:', error);
      return '';
    }
  }

  // Analyze text with Gemma (same as main app)
  async analyzeTextWithGemma(fullText, fileName) {
    console.log(`[TEXT] Starting text analysis for: ${fileName}`);
    
    if (!fullText || fullText.trim().length === 0) {
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
1. Find patient names and hospital numbers by looking in specific locations:
   - Patient names: Look ONLY in fields labeled "NAME", "Patient Name", "Patient:", or at the top of forms
   - Hospital numbers: Look for 5-6 digit numbers in fields labeled "Hospital #", "Hospital Number", "Patient ID", or similar
   - Focus on the header section of medical forms (first 1/3 of the page)

2. Distinguish between different types of names:
   - PATIENT NAMES: Found ONLY in "NAME" fields, patient information sections
   - DOCTOR/STAFF NAMES: Found in "M.D.", "Doctor", "Nursing Staff", "Signature" fields
   - NEXT OF KIN: Found in "Next of Kin", "Emergency Contact" fields
   - Do NOT count doctor names, staff names, or next of kin as patient names

3. Check for multiple patients:
   - Only flag as multiple patients if you find DIFFERENT patient names in "NAME" fields
   - Same patient name appearing multiple times = single patient
   - Different names in different sections (doctor, next of kin) = single patient

IMPORTANT: 
- Hospital numbers are 5-6 digit numbers only (no "MR" prefix)
- ONLY count names in "NAME" fields as patient names
- Doctor names, staff names, next of kin names are NOT patient names
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
      
      if (responseText.includes('```json')) {
        responseText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      }

      try {
        const analysis = JSON.parse(responseText.trim());
        return analysis;
      } catch (parseError) {
        console.error('[TEXT] JSON parse error:', parseError);
        return {
          error: 'Failed to parse model response',
          patientIdentifiers: { names: [], hospitalNumbers: [] },
          multiplePatients: { detected: false, evidence: '', pages: [] },
          dateIssues: { mismatches: [], missingDates: [] },
          pagesWithoutIdentifiers: [],
          dataIntegrityScore: 0,
          criticalIssues: ['JSON parsing error']
        };
      }
    } catch (error) {
      console.error('[TEXT] API error:', error);
      throw error;
    }
  }

  // Easy UI for collecting feedback
  async collectFeedback(fileName, imagePath, extractedText, modelPrediction) {
    console.log('\n' + '='.repeat(60));
    console.log('📋 TRAINING DATA COLLECTION');
    console.log('='.repeat(60));
    console.log(`File: ${fileName}`);
    console.log(`Image: ${path.basename(imagePath)}`);
    
    console.log('\n📄 EXTRACTED TEXT:');
    console.log('-'.repeat(40));
    console.log(extractedText.substring(0, 500) + (extractedText.length > 500 ? '...' : ''));
    
    console.log('\n🤖 MODEL PREDICTION:');
    console.log('-'.repeat(40));
    console.log('Patient Names:', modelPrediction.patientIdentifiers.names.join(', ') || 'None found');
    console.log('Hospital Numbers:', modelPrediction.patientIdentifiers.hospitalNumbers.join(', ') || 'None found');
    console.log('Multiple Patients:', modelPrediction.multiplePatients.detected ? 'Yes' : 'No');
    
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const question = (query) => new Promise((resolve) => rl.question(query, resolve));

    try {
      console.log('\n📝 FEEDBACK COLLECTION:');
      console.log('-'.repeat(40));
      
      // Patient names feedback
      const namesCorrect = await question('Are the patient names correct? (y/n): ');
      let correctNames = modelPrediction.patientIdentifiers.names;
      
      if (namesCorrect.toLowerCase() === 'n') {
        const correctNamesInput = await question('Enter correct patient names (comma-separated): ');
        correctNames = correctNamesInput.split(',').map(name => name.trim()).filter(name => name);
      }

      // Hospital numbers feedback
      const numbersCorrect = await question('Are the hospital numbers correct? (y/n): ');
      let correctNumbers = modelPrediction.patientIdentifiers.hospitalNumbers;
      
      if (numbersCorrect.toLowerCase() === 'n') {
        const correctNumbersInput = await question('Enter correct hospital numbers (comma-separated): ');
        correctNumbers = correctNumbersInput.split(',').map(num => num.trim()).filter(num => num);
      }

      // Multiple patients feedback
      const multiplePatientsCorrect = await question('Is the multiple patients detection correct? (y/n): ');
      let correctMultiplePatients = modelPrediction.multiplePatients.detected;
      
      if (multiplePatientsCorrect.toLowerCase() === 'n') {
        const multiplePatientsInput = await question('Are there multiple patients? (y/n): ');
        correctMultiplePatients = multiplePatientsInput.toLowerCase() === 'y';
      }

      // OCR quality feedback
      const ocrQuality = await question('How good was the OCR extraction? (1-5, 5=perfect): ');
      
      // Additional notes
      const notes = await question('Any additional notes or corrections: ');

      // Create training example
      const trainingExample = {
        fileName,
        imagePath: path.basename(imagePath),
        extractedText: extractedText.substring(0, 1000), // Limit text length
        modelPrediction,
        correctAnswer: {
          patientIdentifiers: {
            names: correctNames,
            hospitalNumbers: correctNumbers
          },
          multiplePatients: {
            detected: correctMultiplePatients,
            evidence: correctMultiplePatients ? 'User confirmed multiple patients' : 'User confirmed single patient'
          }
        },
        ocrQuality: parseInt(ocrQuality) || 3,
        notes,
        timestamp: new Date().toISOString()
      };

      // Save training example
      this.trainingData.push(trainingExample);
      await this.saveTrainingData();

      console.log('\n✅ Training example saved!');
      console.log(`Total training examples: ${this.trainingData.length}`);

    } finally {
      rl.close();
    }
  }

  // Process a single PDF file
  async processPDF(pdfPath) {
    console.log(`\n📁 Processing PDF: ${path.basename(pdfPath)}`);
    
    try {
      // Create temp directory for images
      const tempDir = path.join(__dirname, 'temp_images', path.basename(pdfPath, '.pdf'));
      await fs.ensureDir(tempDir);

      // Convert PDF to images
      console.log('[STEP 1] Converting PDF to images...');
      const conversionResult = await this.convertPDFToImages(pdfPath, tempDir);
      
      if (!conversionResult.success) {
        throw new Error(conversionResult.error);
      }

      const imagePaths = conversionResult.imagePaths;
      console.log(`[STEP 1] Created ${imagePaths.length} images`);

      // Process each page
      for (let i = 0; i < imagePaths.length; i++) {
        const imagePath = imagePaths[i];
        console.log(`\n[STEP 2] Processing page ${i + 1}/${imagePaths.length}`);
        
        // Extract text with OCR
        console.log('[STEP 2] Running OCR...');
        const extractedText = await this.extractTextWithOCR(imagePath);
        
        if (!extractedText) {
          console.log('[STEP 2] No text extracted, skipping page');
          continue;
        }

        // Analyze with Gemma
        console.log('[STEP 3] Analyzing text...');
        const analysis = await this.analyzeTextWithGemma(extractedText, `${path.basename(pdfPath)}_page_${i + 1}`);

        // Collect feedback
        await this.collectFeedback(
          `${path.basename(pdfPath)}_page_${i + 1}`,
          imagePath,
          extractedText,
          analysis
        );
      }

      // Clean up temp files
      await fs.remove(tempDir);
      console.log('\n🧹 Cleaned up temporary files');

    } catch (error) {
      console.error(`Error processing ${pdfPath}:`, error);
    }
  }

  // Process multiple PDFs
  async processMultiplePDFs(pdfDirectory) {
    console.log(`\n📂 Processing PDFs from: ${pdfDirectory}`);
    
    try {
      const files = await fs.readdir(pdfDirectory);
      const pdfFiles = files.filter(file => file.toLowerCase().endsWith('.pdf'));
      
      if (pdfFiles.length === 0) {
        console.log('No PDF files found in directory');
        return;
      }

      console.log(`Found ${pdfFiles.length} PDF files`);
      
      for (let i = 0; i < pdfFiles.length; i++) {
        const pdfFile = pdfFiles[i];
        const pdfPath = path.join(pdfDirectory, pdfFile);
        
        console.log(`\n📄 Processing ${i + 1}/${pdfFiles.length}: ${pdfFile}`);
        await this.processPDF(pdfPath);
      }

      console.log('\n🎉 All PDFs processed!');
      console.log(`Total training examples created: ${this.trainingData.length}`);

    } catch (error) {
      console.error('Error processing PDFs:', error);
    }
  }

  // Show training statistics
  showStats() {
    console.log('\n📊 TRAINING DATA STATISTICS');
    console.log('='.repeat(40));
    console.log(`Total examples: ${this.trainingData.length}`);
    
    if (this.trainingData.length > 0) {
      const lastExample = this.trainingData[this.trainingData.length - 1];
      console.log(`Last updated: ${lastExample.timestamp}`);
      
      const avgOcrQuality = this.trainingData.reduce((sum, ex) => sum + ex.ocrQuality, 0) / this.trainingData.length;
      console.log(`Average OCR quality: ${avgOcrQuality.toFixed(1)}/5`);
      
      const filesWithMultiplePatients = this.trainingData.filter(ex => ex.correctAnswer.multiplePatients.detected).length;
      console.log(`Files with multiple patients: ${filesWithMultiplePatients}`);
    }
  }
}

module.exports = TrainingDataCreator; 