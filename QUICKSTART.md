# Quick Start Guide - ScanAuditor

## Prerequisites Installation

### 1. Install Node.js
- Go to [https://nodejs.org/](https://nodejs.org/)
- Download and install the LTS version
- Verify installation: `node --version`

### 2. Install Ollama
- Go to [https://ollama.ai/](https://ollama.ai/)
- Download and install for your operating system
- Start Ollama: `ollama serve`

### 3. Pull the AI Model
```bash
ollama pull qwen2.5vl:7b
```

## Quick Setup

### Option 1: Automated Setup (Windows)
1. **Run the setup script:**
   
   **In Command Prompt:**
   ```cmd
   setup.bat
   ```
   
   **In PowerShell:**
   ```powershell
   .\setup.bat
   ```
   
   Or run the PowerShell script directly:
   ```powershell
   .\setup.ps1
   ```
   
2. Follow the prompts

### Option 2: Manual Setup
```bash
# Install dependencies
npm install

# Start the application
npm start
```

## Using the Application

1. **Launch**: Run `npm start` to open the application
2. **Select Files**: Click "Browse Files" or drag & drop medical records
3. **Analyze**: Click "Analyze Files" to process the documents
4. **Review Results**: Check the analysis results and any issues found

## Test Files

The application includes sample files for testing:
- `sample-medical-record.txt` - Single patient record
- `sample-multi-patient-record.txt` - Multiple patients (should fail validation)

## Troubleshooting

### Common Issues:
- **"Ollama not connected"**: Ensure `ollama serve` is running
- **"Model not found"**: Run `ollama pull qwen2.5vl:7b`
- **"Backend error"**: Check if port 3001 is available

### Status Indicators:
- **Green**: Connected and ready
- **Red**: Disconnected or error
- **Yellow**: Checking connection

## Analysis Results

The application checks:
- ✅ Patient name matches filename
- ✅ Only one patient in document
- ✅ Document contains single patient records
- ⚠️ Issues and discrepancies found

## Support

For detailed documentation, see `README.md` 