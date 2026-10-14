$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
Write-Host "Setting up Python environment for ScanAuditor..."

if (-not (Test-Path "paddleocr_env")) {
    python -m venv paddleocr_env
}

& ".\paddleocr_env\Scripts\python.exe" -m pip install --upgrade pip
& ".\paddleocr_env\Scripts\python.exe" -m pip install -r requirements.txt
Write-Host "Python environment ready: paddleocr_env"
