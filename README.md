# ScanAuditor

ScanAuditor is a desktop application for auditing the fidelity of scanned PDF medical records. It processes every page and applies deterministic JavaScript QA rules. Local Ollama processing is the default; hospital-authorized OpenAI vision models are optional.

## Local audit pipeline

1. **PDF conversion** — every page is converted to a PNG with `pdf2image` and Poppler.
2. **OCR** — `qwen3-vl:8b-instruct` extracts text from each page image.
3. **Structured extraction** — `qwen3:14b` extracts patient-name fields, hospital-number fields, and dates from each page. The model does not decide whether the document is safe.
4. **Visual checks** — `qwen3-vl:8b-instruct` checks every page for blur, darkness, unreadable content, cut-off/incomplete pages, orientation problems, and possible duplicates.
5. **Deterministic safety checks** — JavaScript calculates identifier coverage, checks whether every page was successfully processed, detects conflicting patient identifiers, validates critical dates, and applies the final pass/review decision.

The default model pair is intended as the balanced accuracy/performance configuration for a workstation with roughly 24 GB of NVIDIA VRAM. The same vision model is reused for OCR and image-quality analysis, while the 14B text model handles structured identifier/date extraction.

## Model configuration

Model selection is centralized in `model_config.js`.

Default models:

```text
Vision/OCR: qwen3-vl:8b-instruct
Text analysis: qwen3:14b
```

You can override either model without editing source code:

### PowerShell

```powershell
$env:SCANAUDITOR_VISION_MODEL="another-vision-model"
$env:SCANAUDITOR_TEXT_MODEL="another-text-model"
npm start
```

### Command Prompt

```bat
set SCANAUDITOR_VISION_MODEL=another-vision-model
set SCANAUDITOR_TEXT_MODEL=another-text-model
npm start
```

OCR and image-quality analysis always use the configured vision model. The Electron status check reads the same configuration, so it reports `Models Missing` when the selected models are not installed.

## Important behavior

- **PDF only.** The current production audit path intentionally accepts only PDF files.
- **Every page is processed.** There is no five-page testing limit.
- **OCR failures never count as successful coverage.** Any failed page makes the audit incomplete and triggers an automated QA finding.
- **Hospital numbers are exact identifiers.** Numbers that differ by one digit are kept separate and treated as a possible patient-identity conflict.
- **Names are merged conservatively.** Sharing only a surname is not enough to treat two people as the same patient.
- **Original PDFs are not copied to an uploads folder.** The application reads the selected file in place. Temporary page images are deleted after each analysis.
- **Production diagnostic logs use an allowlist of controlled fields**, excluding filenames, paths, raw error messages and patient identifiers.
- **Excel export contains clear-text patient identifiers.** The UI warns before export.

## Automated QA decisions

Results are **Automated QA Passed**, **Review Required**, or **Analysis Failed**. Missing identifiers do not by themselves imply a bad scan; the app looks for continuation pages. Unreadable/cutoff pages, identity conflicts, uncertainty, anomalies, duplicates, and failed analysis are reported conservatively. The app cannot prove source-paper completeness, clinical correctness, or that an issue was introduced during scanning.

## Digital preservation checks and million-file folder audits

ScanAuditor now checks **internal PDF pagination gaps** (not completeness against the original paper), observes printed text/handwriting/stamps/signatures/marginal notes when using approved cloud inference, and produces PHI-minimized JSON evidence with a file hash, version details, categorical findings and a digest. The desktop app includes an optional **Resumable Folder Audit** with checkpointed scanning, stop/resume and a local evidence journal. A CLI is also available for supervised archive trials. See [PRESERVATION_QA.md](PRESERVATION_QA.md) for the authoritative QA policy, whole-record identity assessment, content-verified checkpoints, scale limits and safety requirements.

## Bulk-first SQLite review workspace

The main workflow is **Resumable Folder Audit → Audit Projects & Review Queue → Record Review**. Analyze a folder, then review indexed findings and manual decisions without re-running every PDF. The app creates a local SQLite database automatically through the existing Python runtime—no separate SQLite server or native Node add-on is required. Human reviews remain current after reanalysis only when the file hash and material findings remain unchanged. It displays 50 results per page, supports finding/status/search filters, and provides the detailed individual audit report, human-review dispositions, original PDF opening, rescan/paper-comparison actions, audit history, evidence exports and per-record reanalysis. Individual PDF audits feed the same case store.

**Security:** The SQLite database contains source paths, detailed analysis and potentially patient identifiers. It is not encrypted on its own, is designed for one hospital-controlled workstation, and must reside on an encrypted/managed local disk. CSV exports and backups require an explicit warning. It does not grant paper-disposal authorization. See [PRESERVATION_QA.md](PRESERVATION_QA.md) for deployment/retention cautions.

## Optional OpenAI models and costing

The user can select **Local only**, **GPT-6 Luna with GPT-6.1 Sol fallback**, or **GPT-6 Astra benchmark**. One cloud multimodal request per page extracts text, patient fields, dates, and quality observations. The app only sends medical images externally when cloud mode is explicitly selected, an API key has been entered, and hospital authorization is confirmed. The API key is kept in memory for this session, not persisted.

The **Scan Cost Tracker** forecasts costs **per page, not per PDF**: enter the total number of pages expected and click **Estimate Cost**. It uses the latest comparable run's observed dollars per metered page by default, while keeping selected-run and historical averages in Advanced Options. PDF file counts do not determine the forecast. The app separately displays actual recorded spending and never makes an API call merely to calculate an estimate. It is not a billing invoice. For setup, rates and privacy requirements, read [OPENAI_SETUP.md](OPENAI_SETUP.md).

## Prerequisites

- Node.js 18 or later
- Python 3.10 or later
- Poppler for PDF conversion
- Ollama 0.12.7 or later
- Ollama models:

```bash
ollama pull qwen3-vl:8b-instruct
ollama pull qwen3:14b
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

For a complete Windows setup, `setup.bat` or `setup.ps1` also pulls the two default Ollama models.

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

The tests cover identity matching, hospital-number conflicts, failed OCR coverage, full-document coverage, critical image failures, a clean passing case, and centralized model selection/overrides.

## Interactive learning

The optional learning CLI stores human corrections in `learning_data.json`. The production analyzer reads the most recent corrected examples and uses them as extraction examples. This is few-shot prompting; it does **not** retrain the underlying Ollama model.

The learning workflow uses the same centralized model configuration as the main application.

`learning_data.json` and `training_data.json` are excluded from Git because they may contain patient information.

Run the learning CLI with:

```bash
node learn.js
```

## Privacy and local processing

OCR and analysis requests are sent only to the local Ollama service at `127.0.0.1:11434`. The Electron renderer does not run a local Express upload server. The renderer communicates with the Electron main process through a narrow preload API with context isolation and sandboxing enabled.

Temporary converted page images are removed after analysis. The application does not automatically delete the source PDF because it analyzes the original file selected by the user rather than creating its own copy.
