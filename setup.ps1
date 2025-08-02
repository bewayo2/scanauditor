# ScanAuditor Setup Script
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "ScanAuditor Setup Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check for Node.js
Write-Host "Checking for Node.js..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Node.js is installed: $nodeVersion" -ForegroundColor Green
    } else {
        throw "Node.js not found"
    }
} catch {
    Write-Host "Node.js is not installed." -ForegroundColor Red
    Write-Host "Please install Node.js from: https://nodejs.org/" -ForegroundColor Yellow
    Write-Host "Download the LTS version and run this script again." -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}

# Check for npm
Write-Host ""
Write-Host "Checking for npm..." -ForegroundColor Yellow
try {
    $npmVersion = npm --version 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "npm is available: $npmVersion" -ForegroundColor Green
    } else {
        throw "npm not found"
    }
} catch {
    Write-Host "npm is not available." -ForegroundColor Red
    Write-Host "Please ensure Node.js is properly installed." -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}

# Install dependencies
Write-Host ""
Write-Host "Installing dependencies..." -ForegroundColor Yellow
try {
    npm install
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Dependencies installed successfully." -ForegroundColor Green
    } else {
        throw "npm install failed"
    }
} catch {
    Write-Host "Failed to install dependencies." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# Check for Ollama
Write-Host ""
Write-Host "Checking for Ollama..." -ForegroundColor Yellow
try {
    $ollamaVersion = ollama --version 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Ollama is installed: $ollamaVersion" -ForegroundColor Green
        
        # Check for qwen2.5vl:7b model
        Write-Host ""
        Write-Host "Checking for qwen2.5vl:7b model..." -ForegroundColor Yellow
        $modelList = ollama list 2>$null
        if ($modelList -match "qwen2.5vl:7b") {
            Write-Host "Model qwen2.5vl:7b is available." -ForegroundColor Green
        } else {
            Write-Host "Model qwen2.5vl:7b not found." -ForegroundColor Yellow
            Write-Host "Pulling model... (this may take several minutes)" -ForegroundColor Yellow
            ollama pull qwen2.5vl:7b
            if ($LASTEXITCODE -eq 0) {
                Write-Host "Model pulled successfully." -ForegroundColor Green
            } else {
                Write-Host "Failed to pull model." -ForegroundColor Red
            }
        }
    } else {
        throw "Ollama not found"
    }
} catch {
    Write-Host "Ollama is not installed." -ForegroundColor Red
    Write-Host "Please install Ollama from: https://ollama.ai/" -ForegroundColor Yellow
    Write-Host "After installation, run: ollama pull qwen2.5vl:7b" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Setup completed!" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "To start the application:" -ForegroundColor Yellow
Write-Host "1. Ensure Ollama is running: ollama serve" -ForegroundColor White
Write-Host "2. Run: npm start" -ForegroundColor White
Write-Host ""
Read-Host "Press Enter to exit" 