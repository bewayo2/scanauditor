# ScanAuditor

ScanAuditor is a local Electron application for auditing scanned PDF medical records. It converts every PDF page to an image, uses local Ollama models to extract evidence, and then applies deterministic JavaScript rules to decide whether the document needs review.

## Current audit pipeline

1. **PDF conversion** — every page is converted to a PNG with `pdf2image` and Poppler.
2. **OCR** — `qwen2.5vl:7b` extracts text from each page image.
3. **Structured extraction** — `gemma3n:latest` extracts patient-name fields, hospital-number fields, and dates from each page. The model does not decide whether the document is safe.
4. **Visual checks** — `qwen2.5vl:7b` checks every page for blur, darkness, unreadable content, cut-off/incomplete pages, orientation problems, and possible duplicates.
5. **Deterministic safety checks** — JavaScript calculates identifier coverage, checks whether every page was successfully processed, detects conflicting patient identifiers, validates critical dates, and applies the final pass/review decision.

## Important behavior

- **PDF only.** The current production audit path intentionally accepts only PDF files.
- **Every page is processed.** There is no five-page testing limit.
- **OCR failures never count as successful coverage.** Any failed page makes the audit incomplete and prevents a `Safe for Use` result.
- **Hospital numbers are exact identifiers.** Numbers that differ by one digit are kept separate and treated as a possible patient-identity conflict.
- **Names are merged conservatively.** Sharing only a surname is not enough to treat two people as the same patient.
- **Original PDFs are not copied to an uploads folder.** The application reads the selected file in place. Temporary page images are deleted after each analysis.
- **Production logs do not print extracted medical text or patient identifiers.**
- **Excel export contains clear-text patient identifiers.** The UI warns before export.

## Safety decision

A document is not marked safe when any of these conditions is true:

- one or more pages failed OCR or structured extraction;
- visual analysis failed for part of the document;
- fewer than 50% of all document pages contain a recognized patient name or hospital number;
- more than one distinct patient name or hospital number is present;
- a discharge date is earlier than an admission date;
- a page is unreadable, cut off, or incomplete.

Blur, darkness, light pages, orientation issues, duplicate pages, and chronological-order warnings are reported separately and can trigger manual review recommendations.

## Prerequisites

- Node.js 18 or later
- Python 3.10 or later
- Poppler for PDF conversion
- Ollama
- Ollama models:

```bash
ollama pull qwen2.5vl:7b
ollama pull gemma3n:latest
```

## Installation

```bash
npm install
```

On Windows, create the Python environment with either:

```bat
setup_python_env.bat
```

or:

```powershell
.\setup_python_env.ps1
```

Both setup scripts create the same `paddleocr_env` environment used by the application.

### Poppler

`pdf_to_images.py` looks for Poppler in this order:

1. the `POPPLER_PATH` environment variable;
2. `poppler-windows/poppler-24.08.0/Library/bin` relative to the repository;
3. `poppler-windows/Library/bin` relative to the repository;
4. Poppler available on the system `PATH`.

There is no hard-coded developer-machine path.

## Run

Make sure Ollama is running, then:

```bash
npm start
```

For the development console:

```bash
npm run dev
```

## Tests and syntax checks

```bash
npm test
npm run check
```

The unit tests cover identity matching, hospital-number conflicts, failed OCR coverage, full-document coverage, critical image failures, and a clean passing case.

## Interactive learning

The optional learning CLI stores human corrections in `learning_data.json`. The production analyzer reads the most recent corrected examples and uses them as extraction examples. This is few-shot prompting; it does **not** retrain the underlying Ollama model.

`learning_data.json` and `training_data.json` are excluded from Git because they may contain patient information.

Run the learning CLI with:

```bash
node learn.js
```

## Privacy and local processing

OCR and analysis requests are sent only to the local Ollama service at `127.0.0.1:11434`. The Electron renderer does not run a local Express upload server. The renderer communicates with the Electron main process through a narrow preload API with context isolation and sandboxing enabled.

Temporary converted page images are removed after analysis. The application does not automatically delete the source PDF because it analyzes the original file selected by the user rather than creating its own copy.
