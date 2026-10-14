# Quick Start - ScanAuditor

## Prerequisites

Install:

- Node.js 18 or later
- Python 3.10 or later
- Ollama
- Poppler for PDF conversion

Pull both local AI models:

```bash
ollama pull qwen2.5vl:7b
ollama pull gemma3n:latest
```

## Windows setup

Run either:

```bat
setup.bat
```

or:

```powershell
.\setup.ps1
```

The setup installs Node dependencies, creates `paddleocr_env`, installs the active Python PDF-conversion dependencies, and checks both Ollama models.

## Run

Start Ollama, then:

```bash
npm start
```

## Use

1. Select or drag-and-drop PDF medical records.
2. Click **Analyze Files**.
3. ScanAuditor processes every page.
4. Review the safety status, identifier coverage, patient-identity conflicts, date findings, and scan-quality findings.
5. Export to Excel only when appropriate; the export contains patient names and hospital numbers in clear text.

## Troubleshooting

- **Ollama disconnected**: make sure Ollama is running on `127.0.0.1:11434`.
- **Models Missing**: pull `qwen2.5vl:7b` and `gemma3n:latest`.
- **PDF conversion error**: verify Poppler is installed or set the `POPPLER_PATH` environment variable.
- **Analysis incomplete**: failed OCR or structured extraction pages prevent a `Safe for Use` result. Resolve the failure and rerun the audit.

The current production audit path supports PDF files only. The sample `.txt` files are intended for the optional learning CLI, not the main Electron audit.

For more detail, see `README.md`, `PDF_CONVERSION_SETUP.md`, and `LEARNING_GUIDE.md`.
