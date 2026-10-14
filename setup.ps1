$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
Write-Host "========================================"
Write-Host "ScanAuditor Setup"
Write-Host "========================================"
Write-Host "Recommended Ollama version: 0.12.7 or later for Qwen3-VL."

node --version | Out-Host
python --version | Out-Host
npm install
& ".\setup_python_env.ps1"

if ((Test-Path ".\poppler-windows.zip") -and -not (Test-Path ".\poppler-windows")) {
    Write-Host "Extracting bundled Poppler..."
    Expand-Archive -Path ".\poppler-windows.zip" -DestinationPath ".\poppler-windows" -Force
}

ollama --version | Out-Host
$models = ollama list | Out-String
if ($models -notmatch "qwen3-vl:8b-instruct") {
    ollama pull qwen3-vl:8b-instruct
    if ($LASTEXITCODE -ne 0) {
        throw "Could not pull qwen3-vl:8b-instruct. Update Ollama to 0.12.7 or later and retry."
    }
}
$models = ollama list | Out-String
if ($models -notmatch "qwen3:14b") {
    ollama pull qwen3:14b
    if ($LASTEXITCODE -ne 0) { throw "Could not pull qwen3:14b." }
}

Write-Host "Setup completed successfully."
Write-Host "Vision/OCR model: qwen3-vl:8b-instruct"
Write-Host "Text analysis model: qwen3:14b"
