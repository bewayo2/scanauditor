const fs = require('fs-extra');
const path = require('path');
const ComprehensiveAnalyzer = require('./comprehensive_analyzer');

class InteractiveLearning {
  constructor() {
    this.learningDataPath = path.join(__dirname, 'learning_data.json');
    this.feedbackHistory = [];
    try {
      if (fs.existsSync(this.learningDataPath)) {
        const data = fs.readJsonSync(this.learningDataPath);
        this.feedbackHistory = Array.isArray(data.feedbackHistory) ? data.feedbackHistory : [];
      }
    } catch (_) {
      this.feedbackHistory = [];
    }
    this.analyzer = new ComprehensiveAnalyzer({ learningDataPath: this.learningDataPath });
  }

  async saveLearningData() {
    await fs.writeJson(this.learningDataPath, {
      feedbackHistory: this.feedbackHistory,
      lastUpdated: new Date().toISOString()
    }, { spaces: 2 });
  }

  async analyzeWithLearning(text, fileName) {
    const page = await this.analyzer.analyzeTextPage(text, fileName, 1);
    const names = page.patientIdentifiers?.names || [];
    const hospitalNumbers = page.patientIdentifiers?.hospitalNumbers || [];
    return {
      patientIdentifiers: { names, hospitalNumbers },
      multiplePatients: {
        detected: names.length > 1 || hospitalNumbers.length > 1,
        evidence: names.length > 1 || hospitalNumbers.length > 1
          ? 'More than one distinct patient identifier was extracted.'
          : '',
        pages: names.length > 1 || hospitalNumbers.length > 1 ? [1] : []
      },
      dates: page.dates || [],
      warnings: page.warnings || [],
      extractionSucceeded: page.success
    };
  }

  async collectFeedback(fileName, text, modelPrediction) {
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const question = query => new Promise(resolve => rl.question(query, resolve));

    try {
      console.log(`\nFile: ${fileName}`);
      console.log('Model prediction:');
      console.log(JSON.stringify(modelPrediction, null, 2));

      const currentNames = modelPrediction.patientIdentifiers?.names || [];
      const currentNumbers = modelPrediction.patientIdentifiers?.hospitalNumbers || [];
      const currentMultiple = Boolean(modelPrediction.multiplePatients?.detected);

      const namesCorrect = await question('Are the patient names correct? (y/n): ');
      let correctNames = currentNames;
      if (namesCorrect.trim().toLowerCase() === 'n') {
        correctNames = (await question('Enter correct patient names (comma-separated): '))
          .split(',').map(value => value.trim()).filter(Boolean);
      }

      const numbersCorrect = await question('Are the hospital numbers correct? (y/n): ');
      let correctNumbers = currentNumbers;
      if (numbersCorrect.trim().toLowerCase() === 'n') {
        correctNumbers = (await question('Enter correct hospital numbers (comma-separated): '))
          .split(',').map(value => value.trim()).filter(Boolean);
      }

      const multipleCorrect = await question('Is the multiple-patient detection correct? (y/n): ');
      let correctMultiple = currentMultiple;
      if (multipleCorrect.trim().toLowerCase() === 'n') {
        correctMultiple = (await question('Are there multiple patients? (y/n): ')).trim().toLowerCase() === 'y';
      }

      const correction = await question('Any additional correction notes: ');
      this.feedbackHistory.push({
        fileName,
        textPreview: String(text || '').slice(0, 300),
        modelPrediction,
        correctAnswer: {
          patientIdentifiers: { names: correctNames, hospitalNumbers: correctNumbers },
          multiplePatients: { detected: correctMultiple }
        },
        correction,
        timestamp: new Date().toISOString()
      });
      await this.saveLearningData();
      console.log(`Feedback saved. Total examples: ${this.feedbackHistory.length}`);
    } finally {
      rl.close();
    }
  }

  async batchLearningMode(files) {
    for (const file of files) {
      try {
        const prediction = await this.analyzeWithLearning(file.text, file.name);
        await this.collectFeedback(file.name, file.text, prediction);
      } catch (error) {
        console.error(`Could not process ${file.name}: ${error.message}`);
      }
    }
  }

  getLearningStats() {
    return {
      totalExamples: this.feedbackHistory.length,
      lastUpdated: this.feedbackHistory.length ? this.feedbackHistory[this.feedbackHistory.length - 1].timestamp : null,
      recentExamples: this.feedbackHistory.slice(-3).map(example => ({
        fileName: example.fileName,
        correction: example.correction
      }))
    };
  }
}

module.exports = InteractiveLearning;
