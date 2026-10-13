# Interactive Learning System for Medical Document Analysis

This system allows you to teach the AI model to better recognize patient names and hospital numbers from medical records through interactive feedback.

## How It Works

1. **Model Makes Prediction**: The AI analyzes a medical document and extracts patient names and hospital numbers
2. **You Provide Feedback**: You tell the model if it's correct or provide corrections
3. **Model Learns**: The model uses your feedback to improve future predictions
4. **Continuous Improvement**: Over time, the model becomes more accurate for your specific documents

## Getting Started

### Prerequisites
- Node.js installed
- Ollama running with `gemma3n:latest` model
- Sample medical record files (text format)

### Running the Learning System

```bash
node learn.js
```

### Options Available

1. **Batch Learning Mode**: Process multiple files at once
   - Place your medical record files in the `uploads/` folder
   - System will process up to 10 files
   - Provide feedback for each file

2. **Single File Analysis**: Analyze one file at a time
   - Enter the path to your text file
   - Provide feedback for that specific file

3. **View Learning Progress**: See how many examples you've taught
   - Shows total feedback examples
   - Displays recent corrections
   - Shows learning data file size

## Sample Files

The system includes sample medical records to test with:

- `sample-medical-record.txt`: Single patient record
- `sample-multi-patient-record.txt`: Multiple patients in one document

## Feedback Process

For each document, you'll be asked:

1. **Are the patient names correct? (y/n)**
   - If no, enter the correct names (comma-separated)

2. **Are the hospital numbers correct? (y/n)**
   - If no, enter the correct numbers (comma-separated)

3. **Is the multiple patients detection correct? (y/n)**
   - If no, specify if there are multiple patients

4. **Any additional corrections or notes**
   - Provide any other feedback

## Learning Data

Your feedback is saved in `learning_data.json` and includes:
- Original model predictions
- Your corrections
- Text previews for context
- Timestamps

## Tips for Effective Learning

1. **Start with Simple Cases**: Begin with clear, well-formatted documents
2. **Be Consistent**: Use the same format for corrections
3. **Provide Context**: Add notes explaining why corrections were needed
4. **Review Progress**: Check learning stats to see improvement
5. **Test Regularly**: Try the same documents again to see improvement

## Expected Improvements

After providing feedback on 10-20 documents, you should see:
- More accurate patient name extraction
- Better hospital number recognition
- Improved multiple patient detection
- Fewer false positives/negatives

## File Formats Supported

- `.txt` files with medical record text
- `.json` files with structured medical data
- Plain text extracted from PDFs

## Troubleshooting

**Model not responding**: Check that Ollama is running with `gemma3n:latest`

**JSON parsing errors**: The model might return malformed JSON. The system will handle this gracefully.

**No sample files found**: Add some `.txt` files to the `uploads/` folder

## Next Steps

Once you've trained the model on your specific documents:

1. **Export Learning Data**: The `learning_data.json` file contains all your training examples
2. **Integrate with Main System**: Use the improved prompts in your main analysis pipeline
3. **Scale Up**: Apply the same learning approach to other document types

## Example Session

```
🤖 Interactive Learning Mode for Medical Document Analysis
=====================================================

📊 Current Learning Stats:
   Total examples: 0
   Last updated: Never

Options:
1. Start batch learning with sample files
2. Analyze a single file
3. View learning progress
4. Exit

Enter your choice (1-4): 1

📁 Batch Learning Mode
=====================
Found 2 sample files for learning.
Starting batch learning...

--- File 1/2 ---
[LEARNING] Analyzing: sample-medical-record.txt

=== INTERACTIVE LEARNING MODE ===
File: sample-medical-record.txt
Text Preview: "ST. JUDE CHILDREN'S RESEARCH HOSPITAL PATIENT MEDICAL RECORD NAME: Sarah Johnson Hospital #: 12345..."

Model Prediction:
{
  "patientIdentifiers": {
    "names": ["Sarah Johnson"],
    "hospitalNumbers": ["12345"]
  },
  "multiplePatients": {
    "detected": false,
    "evidence": "",
    "pages": []
  }
}

--- Feedback Collection ---
Are the patient names correct? (y/n): y
Are the hospital numbers correct? (y/n): y
Is the multiple patients detection correct? (y/n): y
Any additional corrections or notes: 

✅ Feedback saved! The model will learn from this correction.
Total feedback examples: 1
```

This system allows you to quickly improve the AI's accuracy for your specific medical documents without needing to retrain the entire model! 