# ScanAuditor - Launcher Scripts

This folder contains launcher scripts that allow you to run ScanAuditor without needing an IDE or command line knowledge.

## Quick Start

### Option 1: Windows Batch File (Recommended)
1. **Double-click** `run_scan_auditor.bat`
2. The script will automatically:
   - Check if Node.js and Python are installed
   - Verify Ollama is running
   - Install dependencies if needed
   - Launch the application

### Option 2: PowerShell Script
1. **Right-click** `run_scan_auditor.ps1`
2. Select **"Run with PowerShell"**
3. The script will perform the same checks and launch the app

## Prerequisites

Before running the launcher scripts, make sure you have:

### 1. Node.js
- Download from: https://nodejs.org/
- Install the LTS version
- Verify installation: Open Command Prompt and type `node --version`

### 2. Python
- Download from: https://python.org/
- Install Python 3.11 or later
- Verify installation: Open Command Prompt and type `python --version`

### 3. Ollama
- Download from: https://ollama.ai/
- Install and start Ollama
- Pull required models:
  ```bash
  ollama pull qwen2.5vl:7b
  ollama pull gemma3n:latest
  ```

## What the Launcher Does

The launcher scripts automatically:

1. **Environment Check**: Verifies Node.js and Python are installed
2. **Ollama Check**: Confirms Ollama is running (required for AI processing)
3. **Dependency Installation**: Installs Node.js packages if needed
4. **Python Environment**: Creates and configures Python virtual environment
5. **Application Launch**: Starts ScanAuditor in a new window

## Troubleshooting

### "Node.js not found"
- Install Node.js from https://nodejs.org/
- Restart your computer after installation

### "Python not found"
- Install Python from https://python.org/
- Make sure to check "Add Python to PATH" during installation

### "Ollama not running"
- Start Ollama application
- Or run `ollama serve` in Command Prompt

### "Dependencies failed to install"
- Check your internet connection
- Try running the script as Administrator
- Delete `node_modules` folder and try again

### "Python dependencies failed"
- Install Visual Studio Build Tools (required for some packages)
- Or try running: `pip install --upgrade pip`

## Manual Launch (Advanced Users)

If you prefer to launch manually:

```bash
# Install dependencies
npm install

# Create Python environment
python -m venv paddleocr_env
paddleocr_env\Scripts\activate
pip install -r requirements.txt
deactivate

# Start the application
npm start
```

## Support

If you encounter issues:
1. Check the console output for error messages
2. Ensure all prerequisites are installed
3. Try running the script as Administrator
4. Check that Ollama is running and models are downloaded

## File Structure

```
ScanAuditor/
├── run_scan_auditor.bat          # Windows batch launcher
├── run_scan_auditor.ps1          # PowerShell launcher
├── LAUNCHER_README.md            # This file
├── package.json                  # Node.js dependencies
├── requirements.txt              # Python dependencies
└── ... (other application files)
```
