Write-Host "Setting up Python environment for ScanAuditor..." -ForegroundColor Green

# Check if Python environment exists
if (-not (Test-Path "pdf_converter_env")) {
    Write-Host "Creating Python virtual environment..." -ForegroundColor Yellow
    python -m venv pdf_converter_env
} else {
    Write-Host "Python environment already exists." -ForegroundColor Yellow
}

# Activate virtual environment
Write-Host "Activating virtual environment..." -ForegroundColor Yellow
& "pdf_converter_env\Scripts\Activate.ps1"

# Upgrade pip
Write-Host "Upgrading pip..." -ForegroundColor Yellow
python -m pip install --upgrade pip

# Install required packages
Write-Host "Installing required packages..." -ForegroundColor Yellow
pip install -r requirements.txt

# Install PaddleOCR specifically
Write-Host "Installing PaddleOCR..." -ForegroundColor Yellow
pip install paddlepaddle==3.1.0
pip install paddleocr==2.7.0

Write-Host ""
Write-Host "Python environment setup complete!" -ForegroundColor Green
Write-Host "You can now run the ScanAuditor application." -ForegroundColor Green
Read-Host "Press Enter to continue" 