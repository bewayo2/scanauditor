# ScanAuditor - Medical Document Analysis Tool
# PowerShell Launcher Script

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   ScanAuditor - Medical Document Analysis" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if Node.js is installed
Write-Host "[1/5] Checking Node.js installation..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ Node.js found: $nodeVersion" -ForegroundColor Green
    } else {
        throw "Node.js not found"
    }
} catch {
    Write-Host "ERROR: Node.js is not installed or not in PATH" -ForegroundColor Red
    Write-Host "Please install Node.js from https://nodejs.org/" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# Check if Python is installed
Write-Host "[2/5] Checking Python installation..." -ForegroundColor Yellow
try {
    $pythonVersion = python --version 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ Python found: $pythonVersion" -ForegroundColor Green
    } else {
        throw "Python not found"
    }
} catch {
    Write-Host "ERROR: Python is not installed or not in PATH" -ForegroundColor Red
    Write-Host "Please install Python from https://python.org/" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# Check if Ollama is running
Write-Host "[3/5] Checking Ollama connection..." -ForegroundColor Yellow
try {
    $ollamaResponse = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -Method Get -TimeoutSec 5
    Write-Host "✓ Ollama is running" -ForegroundColor Green
} catch {
    Write-Host "WARNING: Ollama is not running or not accessible" -ForegroundColor Yellow
    Write-Host "Please start Ollama before running ScanAuditor" -ForegroundColor Yellow
    Write-Host "You can download Ollama from https://ollama.ai/" -ForegroundColor Yellow
    Write-Host ""
    $continue = Read-Host "Press Enter to continue anyway (app may not work without Ollama) or 'n' to exit"
    if ($continue -eq 'n') {
        exit 1
    }
}

# Install dependencies if node_modules doesn't exist
Write-Host "[4/5] Checking dependencies..." -ForegroundColor Yellow
if (-not (Test-Path "node_modules")) {
    Write-Host "Installing Node.js dependencies..." -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Failed to install Node.js dependencies" -ForegroundColor Red
        Read-Host "Press Enter to exit"
        exit 1
    }
    Write-Host "✓ Dependencies installed" -ForegroundColor Green
} else {
    Write-Host "✓ Dependencies already installed" -ForegroundColor Green
}

# Check Python virtual environment
Write-Host "[5/5] Checking Python environment..." -ForegroundColor Yellow
if (-not (Test-Path "paddleocr_env")) {
    Write-Host "Creating Python virtual environment..." -ForegroundColor Yellow
    python -m venv paddleocr_env
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Failed to create Python virtual environment" -ForegroundColor Red
        Read-Host "Press Enter to exit"
        exit 1
    }
    Write-Host "✓ Python environment created" -ForegroundColor Green
} else {
    Write-Host "✓ Python environment exists" -ForegroundColor Green
}

# Install Python dependencies if requirements.txt exists
if (Test-Path "requirements.txt") {
    Write-Host "Installing Python dependencies..." -ForegroundColor Yellow
    & ".\paddleocr_env\Scripts\Activate.ps1"
    pip install -r requirements.txt
    if ($LASTEXITCODE -ne 0) {
        Write-Host "WARNING: Some Python dependencies may not be installed correctly" -ForegroundColor Yellow
        Write-Host "This may affect PDF processing functionality" -ForegroundColor Yellow
    } else {
        Write-Host "✓ Python dependencies installed" -ForegroundColor Green
    }
    deactivate
}

# Launch the application
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   Starting ScanAuditor..." -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "The application will open in a new window." -ForegroundColor White
Write-Host "Keep this console open while using the app." -ForegroundColor White
Write-Host ""
Write-Host "Press Ctrl+C to close the application." -ForegroundColor White
Write-Host ""

# Start the application
npm start

# If we get here, the app has closed
Write-Host ""
Write-Host "ScanAuditor has been closed." -ForegroundColor Yellow
Read-Host "Press Enter to exit"
