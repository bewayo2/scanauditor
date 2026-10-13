# Training Data Creation Guide

This guide shows you how to create training data from your scanned medical records to improve the AI's accuracy.

## Step 1: Create Training Data

### Prerequisites
- Node.js installed
- Ollama running with `gemma3n:latest` and `qwen2.5vl:7b` models
- Your scanned medical record PDFs

### Running the Training System

```bash
node run_training.js
```

### Options Available

1. **Process a Single PDF**: Analyze one PDF file at a time
2. **Process Directory**: Analyze all PDFs in a folder at once
3. **View Statistics**: See your training progress
4. **Exit**: Close the program

## How It Works

### The Process:
1. **PDF Processing**: Converts your PDF to images (same as main app)
2. **OCR Extraction**: Extracts text from each page using Qwen2.5-VL
3. **AI Analysis**: Analyzes extracted text using Gemma 3N
4. **Feedback Collection**: You provide corrections via simple UI
5. **Training Data**: Saves your feedback for future use

### Example Session:

```
🤖 MEDICAL DOCUMENT TRAINING DATA CREATOR
==========================================

📊 TRAINING DATA STATISTICS
========================================
Total examples: 0

Options:
1. Process a single PDF file
2. Process all PDFs in a directory
3. View training statistics
4. Exit

Enter your choice (1-4): 1

📄 Single PDF Processing
========================
Enter the path to your PDF file: C:\medical_records\patient_001.pdf

📁 Processing PDF: patient_001.pdf
[STEP 1] Converting PDF to images...
[STEP 1] Created 3 images

[STEP 2] Processing page 1/3
[STEP 2] Running OCR...
[STEP 3] Analyzing text...

============================================================
📋 TRAINING DATA COLLECTION
============================================================
File: patient_001_page_1
Image: page_1.png

📄 EXTRACTED TEXT:
----------------------------------------
ST. JUDE CHILDREN'S RESEARCH HOSPITAL
PATIENT MEDICAL RECORD

NAME: Sarah Johnson
Hospital #: 12345
Date of Birth: 03/15/2012
...

🤖 MODEL PREDICTION:
----------------------------------------
Patient Names: Sarah Johnson
Hospital Numbers: 12345
Multiple Patients: No

📝 FEEDBACK COLLECTION:
----------------------------------------
Are the patient names correct? (y/n): y
Are the hospital numbers correct? (y/n): y
Is the multiple patients detection correct? (y/n): y
How good was the OCR extraction? (1-5, 5=perfect): 5
Any additional notes or corrections: 

✅ Training example saved!
Total training examples: 1
```

## What Gets Saved

Each training example includes:
- **File information**: PDF name, page number
- **Extracted text**: What OCR found
- **Model prediction**: What the AI thought
- **Correct answers**: Your corrections
- **OCR quality**: How well the text extraction worked
- **Notes**: Any additional feedback

## Tips for Effective Training

1. **Start Simple**: Begin with clear, well-scanned documents
2. **Be Consistent**: Use the same format for corrections
3. **Rate OCR Quality**: Help identify which documents scan well
4. **Add Notes**: Explain why corrections were needed
5. **Process in Batches**: Handle multiple files at once

## Expected Improvements

After creating 10-20 training examples, you should see:
- Better patient name recognition
- Improved hospital number extraction
- More accurate multiple patient detection
- Better handling of your specific document formats

## Output Files

- **`training_data.json`**: Contains all your training examples
- **`temp_images/`**: Temporary folder (auto-cleaned)

## Next Steps

Once you have training data:
1. **Review Statistics**: Check your training progress
2. **Test Improvements**: Try the same documents again
3. **Integrate with Main App**: Use training data in your main analysis pipeline

## Troubleshooting

**Model not responding**: Check that Ollama is running with required models

**PDF conversion errors**: Ensure PDFs are not password-protected

**OCR issues**: Try different DPI settings or image quality

**No text extracted**: Check if images are too large or poor quality

This training system creates the foundation for much more accurate medical document analysis tailored to your specific documents! 