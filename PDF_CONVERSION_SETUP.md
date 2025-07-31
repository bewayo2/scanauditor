# PDF-to-Image Conversion Setup Guide

## Current Issue

The ScanAuditor application is designed to analyze medical records, including handwritten documents. However, handwritten PDFs cannot be read by standard text extraction tools like `pdf-parse`. To properly analyze handwritten documents, we need to convert PDF pages to images and use the vision model (`qwen2.5vl:7b`) to read the handwritten text.

## Problem

The current system attempts to use PDF-to-image conversion libraries (`pdf2pic`, `pdf-img-convert`) but these require external dependencies that are not installed on your system:

- **ImageMagick** or **GraphicsMagick** (for image processing)
- **Visual Studio Build Tools** (for compiling native dependencies)

## Solutions

### Option 1: Install ImageMagick (Recommended)

1. **Download ImageMagick for Windows:**
   - Go to: https://imagemagick.org/script/download.php#windows
   - Download the latest version for Windows
   - Choose the version that matches your system (32-bit or 64-bit)

2. **Install ImageMagick:**
   - Run the installer
   - Make sure to check "Add application directory to your system path" during installation
   - Complete the installation

3. **Verify Installation:**
   - Open a new Command Prompt or PowerShell
   - Run: `magick --version`
   - You should see ImageMagick version information

4. **Restart the Application:**
   - After installing ImageMagick, restart the ScanAuditor application
   - The PDF-to-image conversion should now work

### Option 2: Use Online PDF Converters (Alternative)

If you prefer not to install additional software, you can:

1. **Convert PDFs manually:**
   - Use online tools like:
     - https://www.ilovepdf.com/pdf_to_image
     - https://smallpdf.com/pdf-to-jpg
     - https://convertio.co/pdf-jpg/
   
2. **Save images locally:**
   - Convert each page of the handwritten PDF to JPG/PNG
   - Save the images in a folder
   - The vision model can analyze these images directly

### Option 3: Use Different PDF Files

If you have access to typed/printed medical records instead of handwritten ones, these can be analyzed directly without image conversion.

## Current Status

The application currently:
- ✅ Detects handwritten documents correctly
- ✅ Attempts enhanced text extraction
- ✅ Provides clear feedback about the limitation
- ❌ Cannot convert PDFs to images (missing dependencies)

## Next Steps

1. **Install ImageMagick** (Option 1 above)
2. **Restart the application**
3. **Test with your handwritten medical records**

Once ImageMagick is installed, the application will be able to:
- Convert PDF pages to high-quality images
- Send these images to the vision model
- Extract patient names from handwritten text
- Provide accurate analysis of handwritten medical records

## Technical Details

The application uses:
- `pdf2pic` library for PDF-to-image conversion
- `qwen2.5vl:7b` vision model for reading handwritten text
- Ollama for local AI processing

The vision model can read handwritten text much better than text extraction tools, making it ideal for analyzing scanned handwritten medical records. 