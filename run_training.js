const TrainingDataCreator = require('./create_training_data');
const path = require('path');
const readline = require('readline');

async function main() {
  const trainer = new TrainingDataCreator();
  
  console.log('🤖 MEDICAL DOCUMENT TRAINING DATA CREATOR');
  console.log('==========================================\n');
  
  // Show current stats
  trainer.showStats();
  
  console.log('\nOptions:');
  console.log('1. Process a single PDF file');
  console.log('2. Process all PDFs in a directory');
  console.log('3. View training statistics');
  console.log('4. Exit');
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const question = (query) => new Promise((resolve) => rl.question(query, resolve));

  try {
    const choice = await question('\nEnter your choice (1-4): ');
    
    switch (choice) {
      case '1':
        await processSinglePDF(trainer);
        break;
      case '2':
        await processDirectory(trainer);
        break;
      case '3':
        trainer.showStats();
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

async function processSinglePDF(trainer) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const question = (query) => new Promise((resolve) => rl.question(query, resolve));

  try {
    console.log('\n📄 Single PDF Processing');
    console.log('========================');
    
    const pdfPath = await question('Enter the path to your PDF file: ');
    
    if (!await require('fs-extra').pathExists(pdfPath)) {
      console.log('File not found. Please check the path.');
      return;
    }
    
    console.log(`\nProcessing: ${path.basename(pdfPath)}`);
    await trainer.processPDF(pdfPath);
    
  } finally {
    rl.close();
  }
}

async function processDirectory(trainer) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const question = (query) => new Promise((resolve) => rl.question(query, resolve));

  try {
    console.log('\n📂 Directory Processing');
    console.log('======================');
    
    const directoryPath = await question('Enter the path to directory containing PDFs: ');
    
    if (!await require('fs-extra').pathExists(directoryPath)) {
      console.log('Directory not found. Please check the path.');
      return;
    }
    
    console.log(`\nProcessing PDFs in: ${directoryPath}`);
    await trainer.processMultiplePDFs(directoryPath);
    
  } finally {
    rl.close();
  }
}

// Run the main function
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main, processSinglePDF, processDirectory }; 