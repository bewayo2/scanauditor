const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');

class InteractiveLearning {
  constructor() {
    this.ollamaBaseUrl = 'http://127.0.0.1:11434';
    this.learningDataPath = path.join(__dirname, 'learning_data.json');
    this.feedbackHistory = [];
    this.loadLearningData();
  }

  async loadLearningData() {
    try {
      if (await fs.pathExists(this.learningDataPath)) {
        const data = await fs.readJson(this.learningDataPath);
        this.feedbackHistory = data.feedbackHistory || [];
        console.log(`[LEARNING] Loaded ${this.feedbackHistory.length} feedback examples`);
      }
    } catch (error) {
      console.log('[LEARNING] No existing learning data found, starting fresh');
      this.feedbackHistory = [];
    }
  }

  async saveLearningData() {
    try {
      await fs.writeJson(this.learningDataPath, {
        feedbackHistory: this.feedbackHistory,
        lastUpdated: new Date().toISOString()
      }, { spaces: 2 });
      console.log(`[LEARNING] Saved ${this.feedbackHistory.length} feedback examples`);
    } catch (error) {
      console.error('[LEARNING] Error saving learning data:', error);
    }
  }

  async analyzeWithLearning(text, fileName) {
    console.log(`[LEARNING] Analyzing: ${fileName}`);
    
    // Build context from previous feedback
    const contextExamples = this.buildContextExamples();
    
    const prompt = `You are a medical document analyzer learning from feedback. Use these examples to improve your analysis:

${contextExamples}

Now analyze this document:

Document: ${fileName}
Text Content: ${text}

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

4. Look for impossible date sequences (e.g., discharge before admission)
5. Identify pages or sections without patient identifiers (name OR hospital number)

IMPORTANT: 
- Hospital numbers are 5-6 digit numbers only (no "MR" prefix)
- ONLY count names in "NAME" fields as patient names
- Doctor names, staff names, next of kin names are NOT patient names
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
        const analysis = JSON.parse(responseText.trim());
        return analysis;
      } catch (parseError) {
        console.error('[LEARNING] JSON parse error:', parseError);
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
      console.error('[LEARNING] API error:', error);
      throw error;
    }
  }

  buildContextExamples() {
    if (this.feedbackHistory.length === 0) {
      return "No previous examples available. Use your best judgment.";
    }

    let examples = "Previous examples with corrections:\n\n";
    
    // Use the last 5 feedback examples to avoid prompt bloat
    const recentExamples = this.feedbackHistory.slice(-5);
    
    recentExamples.forEach((example, index) => {
      examples += `Example ${index + 1}:\n`;
      examples += `Document: ${example.fileName}\n`;
      examples += `Text Preview: "${example.textPreview}"\n`;
      examples += `Model Prediction: ${JSON.stringify(example.modelPrediction)}\n`;
      examples += `Correct Answer: ${JSON.stringify(example.correctAnswer)}\n`;
      examples += `Correction: ${example.correction}\n\n`;
    });

    return examples;
  }

  async collectFeedback(fileName, text, modelPrediction) {
    console.log('\n=== INTERACTIVE LEARNING MODE ===');
    console.log(`File: ${fileName}`);
    console.log(`Text Preview: "${text.substring(0, 200)}..."`);
    console.log('\nModel Prediction:');
    console.log(JSON.stringify(modelPrediction, null, 2));
    
    // Get user feedback
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const question = (query) => new Promise((resolve) => rl.question(query, resolve));

    try {
      console.log('\n--- Feedback Collection ---');
      
      // Ask about patient names
      const namesCorrect = await question('Are the patient names correct? (y/n): ');
      let correctNames = modelPrediction.patientIdentifiers.names;
      
      if (namesCorrect.toLowerCase() === 'n') {
        const correctNamesInput = await question('Enter correct patient names (comma-separated): ');
        correctNames = correctNamesInput.split(',').map(name => name.trim()).filter(name => name);
      }

      // Ask about hospital numbers
      const numbersCorrect = await question('Are the hospital numbers correct? (y/n): ');
      let correctNumbers = modelPrediction.patientIdentifiers.hospitalNumbers;
      
      if (numbersCorrect.toLowerCase() === 'n') {
        const correctNumbersInput = await question('Enter correct hospital numbers (comma-separated): ');
        correctNumbers = correctNumbersInput.split(',').map(num => num.trim()).filter(num => num);
      }

      // Ask about multiple patients
      const multiplePatientsCorrect = await question('Is the multiple patients detection correct? (y/n): ');
      let correctMultiplePatients = modelPrediction.multiplePatients.detected;
      
      if (multiplePatientsCorrect.toLowerCase() === 'n') {
        const multiplePatientsInput = await question('Are there multiple patients? (y/n): ');
        correctMultiplePatients = multiplePatientsInput.toLowerCase() === 'y';
      }

      // Get general correction notes
      const correction = await question('Any additional corrections or notes: ');

      // Create feedback record
      const feedback = {
        fileName,
        textPreview: text.substring(0, 300),
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
        correction,
        timestamp: new Date().toISOString()
      };

      // Save feedback
      this.feedbackHistory.push(feedback);
      await this.saveLearningData();

      console.log('\n✅ Feedback saved! The model will learn from this correction.');
      console.log(`Total feedback examples: ${this.feedbackHistory.length}`);

    } finally {
      rl.close();
    }
  }

  async batchLearningMode(files) {
    console.log('\n=== BATCH LEARNING MODE ===');
    console.log(`Processing ${files.length} files for learning...\n`);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      console.log(`\n--- File ${i + 1}/${files.length} ---`);
      
      try {
        // Analyze the file
        const analysis = await this.analyzeWithLearning(file.text, file.name);
        
        // Collect feedback
        await this.collectFeedback(file.name, file.text, analysis);
        
        console.log(`\nCompleted ${i + 1}/${files.length} files`);
        
      } catch (error) {
        console.error(`Error processing ${file.name}:`, error);
      }
    }

    console.log('\n🎉 Batch learning completed!');
    console.log(`Total feedback examples collected: ${this.feedbackHistory.length}`);
  }

  getLearningStats() {
    return {
      totalExamples: this.feedbackHistory.length,
      lastUpdated: this.feedbackHistory.length > 0 ? 
        this.feedbackHistory[this.feedbackHistory.length - 1].timestamp : null,
      recentExamples: this.feedbackHistory.slice(-3).map(ex => ({
        fileName: ex.fileName,
        correction: ex.correction
      }))
    };
  }
}

module.exports = InteractiveLearning; 