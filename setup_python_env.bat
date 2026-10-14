@echo off
setlocal
cd /d "%~dp0"
echo Setting up Python environment for ScanAuditor...

if not exist "paddleocr_env" (
    python -m venv paddleocr_env
    if errorlevel 1 exit /b 1
)

call paddleocr_env\Scripts\activate.bat
python -m pip install --upgrade pip
if errorlevel 1 exit /b 1
pip install -r requirements.txt
if errorlevel 1 exit /b 1
call paddleocr_env\Scripts\deactivate.bat

echo Python environment ready: paddleocr_env
endlocal
