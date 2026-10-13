@echo off
title ScanAuditor - Medical Document Analysis Tool

:: Change to the directory where the batch file is located
cd /d "%~dp0"

echo ========================================
echo    ScanAuditor - Medical Document Analysis
echo ========================================
echo.

:: Check if Node.js is installed
echo [1/5] Checking Node.js installation...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed or not in PATH
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)
echo OK - Node.js found

:: Check if Python is installed
echo [2/5] Checking Python installation...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Python is not installed or not in PATH
    echo Please install Python from https://python.org/
    pause
    exit /b 1
)
echo OK - Python found

:: Check if Ollama is running
echo [3/5] Checking Ollama connection...
echo Note: Ollama check skipped - please ensure Ollama is running manually
echo You can download Ollama from https://ollama.ai/
echo.

:: Install dependencies if node_modules doesn't exist
echo [3/4] Checking dependencies...
if not exist "node_modules" (
    echo Installing Node.js dependencies...
    npm install
    if %errorlevel% neq 0 (
        echo ERROR: Failed to install Node.js dependencies
        pause
        exit /b 1
    )
    echo OK - Dependencies installed
) else (
    echo OK - Dependencies already installed
)

:: Check Python virtual environment
echo [4/4] Checking Python environment...
if not exist "paddleocr_env" (
    echo Creating Python virtual environment...
    python -m venv paddleocr_env
    if %errorlevel% neq 0 (
        echo ERROR: Failed to create Python virtual environment
        pause
        exit /b 1
    )
    echo OK - Python environment created
) else (
    echo OK - Python environment exists
)

:: Install Python dependencies if requirements.txt exists
if exist "requirements.txt" (
    echo Installing Python dependencies...
    call paddleocr_env\Scripts\activate.bat
    pip install -r requirements.txt
    if %errorlevel% neq 0 (
        echo WARNING: Some Python dependencies may not be installed correctly
        echo This may affect PDF processing functionality
    ) else (
        echo OK - Python dependencies installed
    )
    call paddleocr_env\Scripts\deactivate.bat
)

:: Launch the application
echo.
echo ========================================
echo    Starting ScanAuditor...
echo ========================================
echo.
echo The application will open in a new window.
echo Keep this console open while using the app.
echo.
echo Press Ctrl+C to close the application.
echo.

:: Start the application
npm start

:: If we get here, the app has closed
echo.
echo ScanAuditor has been closed.
pause
