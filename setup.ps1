$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
Write-Host "========================================"
Write-Host "ScanAuditor Setup"
Write-Host "========================================"

node --version | Out-Host
python --version | Out-Host
npm install
& ".\setup_python_env.ps1"

ollama --version | Out-Host
$models = ollama list | Out-String
if ($models -notmatch "qwen2\.5vl:7b") { ollama pull qwen2.5vl:7b }
$models = ollama list | Out-String
if ($models -notmatch "gemma3n:latest") { ollama pull gemma3n:latest }

Write-Host "Setup completed successfully."
