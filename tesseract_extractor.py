#!/usr/bin/env python3
"""
Tesseract Text Extractor for Handwritten Medical Documents
Uses Tesseract OCR for handwriting recognition
"""

import sys
import json
import os
import cv2
import numpy as np
import pytesseract
from PIL import Image

def extract_text_with_tesseract(image_path):
    """
    Extract text from image using Tesseract OCR
    Optimized for handwritten medical documents
    """
    try:
        # Read image with OpenCV
        image = cv2.imread(image_path)
        if image is None:
            return {
                "success": False,
                "error": f"Failed to read image: {image_path}",
                "text": "",
                "confidence": 0.0
            }
        
        # Preprocess image for better OCR
        # Convert to grayscale
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        
        # Apply adaptive histogram equalization for better contrast
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8))
        enhanced = clahe.apply(gray)
        
        # Apply slight Gaussian blur to reduce noise
        blurred = cv2.GaussianBlur(enhanced, (1, 1), 0)
        
        # Convert back to PIL Image for Tesseract
        pil_image = Image.fromarray(blurred)
        
        # Configure Tesseract for handwriting recognition
        custom_config = r'--oem 3 --psm 6 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,()-/: '
        
        # Perform OCR
        result = pytesseract.image_to_data(pil_image, config=custom_config, output_type=pytesseract.Output.DICT)
        
        # Extract text and confidence scores
        extracted_text = []
        total_confidence = 0.0
        text_count = 0
        
        for i, text in enumerate(result['text']):
            confidence = result['conf'][i]
            if text.strip() and confidence > 30:  # Filter out low confidence text
                extracted_text.append(text.strip())
                total_confidence += confidence
                text_count += 1
        
        # Calculate average confidence
        avg_confidence = total_confidence / text_count if text_count > 0 else 0.0
        
        # Join all text with spaces
        full_text = " ".join(extracted_text)
        
        return {
            "success": True,
            "text": full_text,
            "confidence": avg_confidence,
            "text_segments": len(extracted_text),
            "message": f"Extracted {len(extracted_text)} text segments"
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": f"OCR processing failed: {str(e)}",
            "text": "",
            "confidence": 0.0
        }

def main():
    """Main function to handle command line arguments"""
    if len(sys.argv) != 2:
        print(json.dumps({
            "success": False,
            "error": "Usage: python tesseract_extractor.py <image_path>",
            "text": "",
            "confidence": 0.0
        }))
        sys.exit(1)
    
    image_path = sys.argv[1]
    
    # Extract text
    result = extract_text_with_tesseract(image_path)
    
    # Output result as JSON
    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    main() 