# Interactive Learning Guide

ScanAuditor can use recent human corrections as few-shot examples for patient-name and hospital-number extraction. This does not retrain the Ollama models.

## Run the learning tool

```bash
node learn.js
```

The CLI can analyze text examples and ask you to correct:

- patient names;
- hospital numbers;
- multiple-patient detection;
- additional extraction notes.

Corrections are stored locally in `learning_data.json`. That file is excluded from Git because it may contain patient information.

## How the main application uses corrections

`comprehensive_analyzer.js` reads the five most recent corrected examples from `learning_data.json` and includes them as extraction examples when analyzing OCR text. The final document safety decision remains deterministic JavaScript logic; feedback examples cannot directly mark a document safe.

## Privacy

Use this feature only on a workstation approved for medical records. The learning file can contain text previews and identifiers. Do not commit, email, or upload `learning_data.json`.

## Resetting local examples

Close ScanAuditor and remove `learning_data.json` from the local repository folder. The next learning session starts with no examples.
