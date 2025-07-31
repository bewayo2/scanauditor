# ScanAuditor - Medical Records Analysis Tool

A professional Electron application for analyzing medical records using AI-powered analysis with Ollama's qwen2.5vl:7b model.

## Features

- **Multi-file Analysis**: Analyze multiple medical record files simultaneously
- **AI-Powered Analysis**: Uses Ollama's qwen2.5vl:7b model for intelligent document analysis
- **Patient Name Matching**: Verifies patient names match filenames
- **Single Patient Validation**: Ensures documents contain records for one patient only
- **Modern UI**: Clean, professional interface with real-time status indicators
- **Drag & Drop Support**: Easy file selection with drag and drop functionality
- **Comprehensive Results**: Detailed analysis results with confidence scores and issue identification

## Analysis Parameters

The application analyzes medical records for:

1. **Patient Name Extraction**: Identifies patient names within documents
2. **Filename Matching**: Verifies patient names match the filename
3. **Single Patient Check**: Ensures only one patient name appears in the document
4. **One Patient Only**: Confirms the document contains records for one patient only
5. **Issue Detection**: Identifies discrepancies and potential problems
6. **Confidence Scoring**: Provides confidence levels for analysis accuracy

## Prerequisites

- **Node.js** (v16 or higher)
- **Ollama** installed and running locally
- **qwen2.5vl:7b model** available in Ollama

## Installation

1. **Clone or download the project**:
   ```bash
   git clone <repository-url>
   cd ScanAuditor
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Install Ollama** (if not already installed):
   - Visit [https://ollama.ai](https://ollama.ai)
   - Download and install for your operating system
   - Start Ollama service

4. **Pull the required model**:
   ```bash
   ollama pull qwen2.5vl:7b
   ```

## Usage

### Starting the Application

1. **Development mode**:
   ```bash
   npm run dev
   ```

2. **Production mode**:
   ```bash
   npm start
   ```

### Using the Application

1. **Launch the app** - The application will automatically:
   - Start the backend server on port 3001
   - Connect to Ollama service
   - Initialize the qwen2.5vl:7b model

2. **Select Files**:
   - Click "Browse Files" to select medical record files
   - Or drag and drop files onto the upload area
   - Supported formats: TXT, PDF, DOC, DOCX

3. **Analyze Files**:
   - Click "Analyze Files" to start the analysis
   - The application will process each file using the AI model
   - Progress is shown with a loading overlay

4. **Review Results**:
   - View summary statistics (total files, passed/failed, average confidence)
   - Examine detailed results for each file
   - Check for issues and discrepancies

## Status Indicators

The application provides real-time status indicators:

- **Backend Status**: Shows if the local server is running
- **Ollama Status**: Indicates connection to the Ollama service

## File Analysis Process

1. **File Upload**: Files are uploaded to the backend server
2. **Content Extraction**: Text content is extracted from the files
3. **AI Analysis**: The qwen2.5vl:7b model analyzes the content
4. **Result Processing**: Analysis results are processed and formatted
5. **Display**: Results are displayed in the user interface

## Analysis Results

Each file analysis includes:

- **Patient Name**: Extracted patient name from the document
- **Filename Match**: Whether the patient name matches the filename
- **Single Patient**: Whether only one patient name appears in the document
- **One Patient Only**: Whether the document contains records for one patient only
- **Confidence**: AI model's confidence in the analysis (0-100%)
- **Issues**: List of any problems or discrepancies found

## Building for Distribution

To create a distributable application:

```bash
npm run build
```

This will create platform-specific installers in the `dist` folder.

## Troubleshooting

### Ollama Connection Issues

1. **Ensure Ollama is running**:
   ```bash
   ollama serve
   ```

2. **Check model availability**:
   ```bash
   ollama list
   ```

3. **Pull the model if missing**:
   ```bash
   ollama pull qwen2.5vl:7b
   ```

### Backend Server Issues

1. **Check if port 3001 is available**
2. **Restart the application**
3. **Check console logs for error messages**

### File Analysis Issues

1. **Ensure files are in supported formats**
2. **Check file permissions**
3. **Verify file content is readable**

## Security Considerations

- Files are processed locally on your machine
- No data is sent to external servers (except Ollama API calls)
- Temporary files are stored locally and cleaned up automatically
- The application runs in a sandboxed Electron environment

## Technical Details

- **Frontend**: HTML5, CSS3, JavaScript (ES6+)
- **Backend**: Node.js with Express.js
- **Desktop Framework**: Electron
- **AI Model**: Ollama qwen2.5vl:7b
- **File Processing**: Multer for file uploads
- **UI Framework**: Custom CSS with modern design principles

## License

MIT License - see LICENSE file for details

## Support

For issues and questions:
1. Check the troubleshooting section
2. Review console logs for error messages
3. Ensure all prerequisites are properly installed
4. Verify Ollama service is running and accessible

## Contributing

Contributions are welcome! Please feel free to submit pull requests or open issues for bugs and feature requests. 