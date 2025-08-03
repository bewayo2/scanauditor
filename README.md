# ScanAuditor - Comprehensive Medical Document Analysis

ScanAuditor is an advanced medical document analysis tool that uses AI to comprehensively analyze scanned handwritten medical records for data integrity, quality issues, and compliance.

## New Analysis Strategy

ScanAuditor now uses a comprehensive multi-stage analysis approach:

### 1. **PaddleOCR for Handwriting Recognition**
- Uses PaddleOCR (fastest open-source OCR for handwriting)
- Extracts text from all pages of scanned documents
- Optimized for medical handwriting recognition
- Processes entire documents, not just individual pages

### 2. **Gemma 3n 4b for Text Analysis**
- Analyzes extracted text for patient names and hospital numbers (5-6 digit numbers)
- Detects multiple patients in single files
- Identifies date mismatches and inconsistencies
- Validates data integrity across all pages

### 3. **Gemma 3n 4b for Image Analysis**
- Analyzes image quality and document structure
- Detects blurry, dark, or unreadable pages
- Identifies missing pages and duplicates
- Checks page orientation and completeness

### 4. **Comprehensive Report Generation**
- Generates detailed safety assessments
- Provides specific recommendations
- Creates actionable compliance reports
- Determines if files are safe for use

## Features

- **Multi-Page Analysis**: Processes entire documents, not just individual pages
- **Handwriting Recognition**: Advanced OCR optimized for medical handwriting
- **Data Integrity Checks**: Validates patient names and hospital numbers, dates, and consistency
- **Quality Assessment**: Evaluates image quality and document completeness
- **Safety Assessment**: Determines if documents are safe for clinical use
- **Comprehensive Reporting**: Detailed reports with specific recommendations

## Report Format

Each analysis generates a comprehensive report including:

1. **File Information**: Name, scan date, total pages
2. **Summary Table**: Quick overview of all detected issues
3. **Detailed Findings**: 
   - Image quality issues (blurry, dark, unreadable pages)
   - Page sequence issues (missing, duplicate, misoriented pages)
   - Data extraction issues (missing identifiers, multiple patients, date mismatches)
4. **Recommendations**: Specific actions needed
5. **Safety Assessment**: Whether the file is safe for use
6. **Immediate Actions**: Critical issues requiring attention

## Installation

### Prerequisites
- Node.js (v16 or higher)
- Python 3.8 or higher
- Ollama (with gemma3n:latest model)

### Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd ScanAuditor
   ```

2. **Install Node.js dependencies**
   ```bash
   npm install
   ```

3. **Set up Python environment**
   ```bash
   # Windows (Command Prompt)
   setup_python_env.bat
   
   # Windows (PowerShell)
   .\setup_python_env.ps1
   ```

4. **Install Ollama models**
   ```bash
   ollama pull gemma3n:latest
   ```

5. **Start the application**
   ```bash
   npm start
   ```

## Usage

1. **Launch ScanAuditor**
   - The application will start and connect to Ollama
   - Status indicators show connection status

2. **Upload Documents**
   - Drag and drop PDF files or click to select
   - Supports multi-page scanned documents
   - Handles handwritten medical records

3. **Analysis Process**
   - Documents are converted to images
   - PaddleOCR extracts text from all pages
   - Gemma 3n analyzes text for data integrity
   - Gemma 3n analyzes images for quality issues
   - Comprehensive report is generated

4. **Review Results**
   - View summary statistics
   - Examine detailed findings
   - Check safety assessment
   - Follow recommendations

## Analysis Criteria

### Files Considered UNSAFE:
- Missing patient names or hospital numbers on more than 50% of pages
- Pages from multiple patients mixed together
- Critical date mismatches (e.g., discharge before admission)
- Missing critical information affecting patient care

### Files Considered SAFE:
- Minor quality issues that don't affect identification
- Missing patient names or hospital numbers on less than 50% of pages
- Duplicate pages (when correct page is present)
- Minor orientation issues (readable content)

## Technical Details

### OCR Technology
- **PaddleOCR**: Fastest open-source OCR for handwriting
- **Optimized Settings**: Configured for medical documents
- **Multi-language Support**: English medical terminology
- **Image Preprocessing**: Enhanced contrast and noise reduction

### AI Models
- **Gemma 3n 4b**: Google's latest open-source model
- **Text Analysis**: Patient identification and data validation
- **Image Analysis**: Quality assessment and document structure
- **Local Processing**: All analysis done locally via Ollama

### Performance
- **Fast Processing**: PaddleOCR provides rapid text extraction
- **Accurate Recognition**: Optimized for medical handwriting
- **Comprehensive Analysis**: Multi-stage validation process
- **Detailed Reporting**: Actionable insights and recommendations

## Troubleshooting

### Common Issues

1. **Python Environment Setup**
   - Ensure Python 3.8+ is installed
   - Run setup script as administrator if needed
   - Check virtual environment activation

2. **Ollama Connection**
   - Ensure Ollama is running
   - Verify gemma3n:latest model is installed
   - Check port 11434 is available

3. **PaddleOCR Installation**
   - May take time to download models
   - Requires sufficient disk space
   - Check internet connection during setup

### Support
- Check logs in the application console
- Verify all dependencies are installed
- Ensure sufficient system resources

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. 