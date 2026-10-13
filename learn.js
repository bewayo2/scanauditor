const InteractiveLearning = require('./interactive_learning');
const fs = require('fs-extra');
const path = require('path');

async function main() {
  const learner = new InteractiveLearning();
  
  console.log('🤖 Interactive Learning Mode for Medical Document Analysis');
  console.log('=====================================================\n');
  
  // Show current learning stats
  const stats = learner.getLearningStats();
  console.log(`📊 Current Learning Stats:`);
  console.log(`   Total examples: ${stats.totalExamples}`);
  console.log(`   Last updated: ${stats.lastUpdated || 'Never'}`);
  
  if (stats.recentExamples.length > 0) {
    console.log(`   Recent examples: ${stats.recentExamples.length}`);
  }
  
  console.log('\nOptions:');
  console.log('1. Start batch learning with sample files');
  console.log('2. Analyze a single file');
  console.log('3. View learning progress');
  console.log('4. Exit');
  
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const question = (query) => new Promise((resolve) => rl.question(query, resolve));

  try {
    const choice = await question('\nEnter your choice (1-4): ');
    
    switch (choice) {
      case '1':
        await batchLearningMode(learner);
        break;
      case '2':
        await singleFileMode(learner);
        break;
      case '3':
        await viewProgress(learner);
        break;
      case '4':
        console.log('Goodbye!');
        break;
      default:
        console.log('Invalid choice. Please try again.');
    }
  } finally {
    rl.close();
  }
}

async function batchLearningMode(learner) {
  console.log('\n📁 Batch Learning Mode');
  console.log('=====================');
  
  // Check for sample files in uploads directory
  const uploadsDir = path.join(__dirname, 'uploads');
  const sampleFiles = [];
  
  if (await fs.pathExists(uploadsDir)) {
    const files = await fs.readdir(uploadsDir);
    const textFiles = files.filter(file => 
      file.endsWith('.txt') || file.endsWith('.json')
    );
    
    for (const file of textFiles.slice(0, 10)) { // Limit to 10 files
      const filePath = path.join(uploadsDir, file);
      const content = await fs.readFile(filePath, 'utf8');
      sampleFiles.push({
        name: file,
        text: content
      });
    }
  }
  
  if (sampleFiles.length === 0) {
    console.log('No sample files found in uploads directory.');
    console.log('Please add some .txt or .json files to the uploads folder.');
    return;
  }
  
  console.log(`Found ${sampleFiles.length} sample files for learning.`);
  console.log('Starting batch learning...\n');
  
  await learner.batchLearningMode(sampleFiles);
}

async function singleFileMode(learner) {
  console.log('\n📄 Single File Analysis');
  console.log('======================');
  
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const question = (query) => new Promise((resolve) => rl.question(query, resolve));

  try {
    const filePath = await question('Enter the path to your text file: ');
    
    if (!await fs.pathExists(filePath)) {
      console.log('File not found. Please check the path.');
      return;
    }
    
    const content = await fs.readFile(filePath, 'utf8');
    const fileName = path.basename(filePath);
    
    console.log(`\nAnalyzing: ${fileName}`);
    console.log(`Content length: ${content.length} characters`);
    
    // Analyze the file
    const analysis = await learner.analyzeWithLearning(content, fileName);
    
    // Collect feedback
    await learner.collectFeedback(fileName, content, analysis);
    
  } finally {
    rl.close();
  }
}

async function viewProgress(learner) {
  console.log('\n📈 Learning Progress');
  console.log('===================');
  
  const stats = learner.getLearningStats();
  
  console.log(`Total feedback examples: ${stats.totalExamples}`);
  console.log(`Last updated: ${stats.lastUpdated || 'Never'}`);
  
  if (stats.recentExamples.length > 0) {
    console.log('\nRecent corrections:');
    stats.recentExamples.forEach((example, index) => {
      console.log(`${index + 1}. ${example.fileName}: ${example.correction}`);
    });
  }
  
  // Show learning data file info
  const learningDataPath = path.join(__dirname, 'learning_data.json');
  if (await fs.pathExists(learningDataPath)) {
    const stats = await fs.stat(learningDataPath);
    console.log(`\nLearning data file size: ${(stats.size / 1024).toFixed(2)} KB`);
  }
}

// Run the main function
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main, batchLearningMode, singleFileMode, viewProgress }; 