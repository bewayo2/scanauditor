# ScanAuditor - Launcher Scripts

This folder contains launcher scripts that allow you to run ScanAuditor without needing an IDE or command line knowledge.

## Quick Start

### Option 1: Windows Batch File (Recommended)
1. **Double-click** `run_scan_auditor.bat`
2. The script checks Node.js and Python, installs dependencies if needed, prepares the Python environment, and launches the application.

### Option 2: PowerShell Script
1. **Right-click** `run_scan_auditor.ps1`
2. Select **Run with PowerShell**.
3. The script performs the same local environment checks and launches the app.

## Prerequisites

Before running ScanAuditor, make sure you have:

### 1. Node.js
- Install the current LTS release from https://nodejs.org/
- Verify with `node --version`

### 2. Python
- Install Python 3.10 or later from https://python.org/
- Verify with `python --version`

### 3. Ollama
- Install Ollama 0.12.7 or later.
- Start Ollama.
- Pull the balanced default models:

```bash
ollama pull qwen3-vl:8b-instruct
ollama pull qwen3:14b
```

`qwen3-vl:8b-instruct` is used for OCR and visual page-quality checks. `qwen3:14b` is used for structured patient-name, hospital-number, and date extraction.

For first-time setup, running `setup.bat` or `setup.ps1` is preferred because those scripts also pull the required models.

## Manual Launch

```bash
npm install
setup_python_env.bat
npm start
```

PowerShell users can use `setup_python_env.ps1` instead.

## Alternate models

Production model selection is centralized and can be overridden for benchmarking:

```powershell
$env:SCANAUDITOR_VISION_MODEL="another-vision-model"
$env:SCANAUDITOR_TEXT_MODEL="another-text-model"
npm start
```

The configured vision model is reused for both OCR and image analysis.

## Troubleshooting

- **Node.js not found**: install Node.js and reopen the terminal.
- **Python not found**: install Python and ensure it is on PATH.
- **Ollama not running**: start Ollama before launching ScanAuditor.
- **Models Missing**: run `setup.bat`/`setup.ps1` or pull the configured models manually.
- **Qwen3-VL cannot be loaded**: update Ollama to 0.12.7 or later.
- **Python dependency failure**: run `setup_python_env.bat` or `setup_python_env.ps1` again.

## File Structure

```text
ScanAuditor/
├── run_scan_auditor.bat
├── run_scan_auditor.ps1
├── setup.bat
├── setup.ps1
├── model_config.js
├── configured_analyzer.js
├── package.json
├── requirements.txt
└── ...
```
