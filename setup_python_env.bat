@echo off
echo Setting up Python environment for ScanAuditor...

REM Check if Python environment exists
if not exist "pdf_converter_env" (
    echo Creating Python virtual environment...
    python -m venv pdf_converter_env
) else (
    echo Python environment already exists.
)

REM Activate virtual environment
echo Activating virtual environment...
call pdf_converter_env\Scripts\activate.bat

REM Upgrade pip
echo Upgrading pip...
python -m pip install --upgrade pip

REM Install required packages
echo Installing required packages...
pip install -r requirements.txt

REM Install PaddleOCR specifically
echo Installing PaddleOCR...
pip install paddlepaddle==3.1.0
pip install paddleocr==2.7.0

echo.
echo Python environment setup complete!
echo You can now run the ScanAuditor application.
pause 