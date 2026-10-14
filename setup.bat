@echo off
setlocal
cd /d "%~dp0"
echo ========================================
echo ScanAuditor Setup
echo ========================================

echo Recommended Ollama version: 0.12.7 or later for Qwen3-VL.

node --version >nul 2>&1 || (
  echo ERROR: Node.js is not installed or not in PATH.
  exit /b 1
)
python --version >nul 2>&1 || (
  echo ERROR: Python is not installed or not in PATH.
  exit /b 1
)

npm install || exit /b 1
call setup_python_env.bat || exit /b 1

if exist "poppler-windows.zip" if not exist "poppler-windows" (
  echo Extracting bundled Poppler...
  powershell -NoProfile -Command "Expand-Archive -Path 'poppler-windows.zip' -DestinationPath 'poppler-windows' -Force"
  if errorlevel 1 exit /b 1
)

ollama --version >nul 2>&1 || (
  echo ERROR: Ollama is not installed or not in PATH.
  echo Install/update Ollama, then run:
  echo   ollama pull qwen3-vl:8b-instruct
  echo   ollama pull qwen3:14b
  exit /b 1
)

ollama list | findstr /i /c:"qwen3-vl:8b-instruct" >nul || ollama pull qwen3-vl:8b-instruct
if errorlevel 1 (
  echo ERROR: Could not pull qwen3-vl:8b-instruct. Update Ollama to 0.12.7 or later and retry.
  exit /b 1
)
ollama list | findstr /i /c:"qwen3:14b" >nul || ollama pull qwen3:14b
if errorlevel 1 exit /b 1

echo Setup completed successfully.
echo Vision/OCR model: qwen3-vl:8b-instruct
echo Text analysis model: qwen3:14b
endlocal
