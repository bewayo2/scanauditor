@echo off
echo ========================================
echo ScanAuditor Setup Script
echo ========================================
echo.

echo Checking for Node.js...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Node.js is not installed.
    echo Please install Node.js from: https://nodejs.org/
    echo Download the LTS version and run this script again.
    pause
    exit /b 1
) else (
    echo Node.js is installed.
    node --version
)

echo.
echo Checking for npm...
npm --version >nul 2>&1
if %errorlevel% neq 0 (
    echo npm is not available.
    echo Please ensure Node.js is properly installed.
    pause
    exit /b 1
) else (
    echo npm is available.
    npm --version
)

echo.
echo Installing dependencies...
npm install
if %errorlevel% neq 0 (
    echo Failed to install dependencies.
    pause
    exit /b 1
)

echo.
echo Checking for Ollama...
ollama --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Ollama is not installed.
    echo Please install Ollama from: https://ollama.ai/
    echo After installation, run: ollama pull qwen2.5vl:7b
) else (
    echo Ollama is installed.
    ollama --version
    echo.
    echo Checking for qwen2.5vl:7b model...
    ollama list | findstr qwen2.5vl:7b >nul 2>&1
    if %errorlevel% neq 0 (
        echo Model qwen2.5vl:7b not found.
        echo Pulling model... (this may take several minutes)
        ollama pull qwen2.5vl:7b
    ) else (
        echo Model qwen2.5vl:7b is available.
    )
)

echo.
echo ========================================
echo Setup completed!
echo ========================================
echo.
echo To start the application:
echo 1. Ensure Ollama is running: ollama serve
echo 2. Run: npm start
echo.
pause 