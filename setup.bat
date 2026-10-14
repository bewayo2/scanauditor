@echo off
setlocal
cd /d "%~dp0"
echo ========================================
echo ScanAuditor Setup
echo ========================================

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

ollama --version >nul 2>&1 || (
  echo ERROR: Ollama is not installed or not in PATH.
  echo Install Ollama, then run:
  echo   ollama pull qwen2.5vl:7b
  echo   ollama pull gemma3n:latest
  exit /b 1
)

ollama list | findstr /i "qwen2.5vl:7b" >nul || ollama pull qwen2.5vl:7b
if errorlevel 1 exit /b 1
ollama list | findstr /i "gemma3n:latest" >nul || ollama pull gemma3n:latest
if errorlevel 1 exit /b 1

echo Setup completed successfully.
endlocal
