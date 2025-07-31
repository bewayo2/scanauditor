#!/usr/bin/env python3
"""
PDF to Images Converter
Converts PDF pages to PNG images using pdf2image library
"""

import sys
import json
import os
from pathlib import Path
from pdf2image import convert_from_path
import tempfile

# Set the path to Poppler binaries
POPPLER_PATH = r"C:\Repos\ScanAuditor\poppler-windows\poppler-24.08.0\Library\bin"

def convert_pdf_to_images(pdf_path, output_dir, num_pages=1, dpi=150):
    """
    Convert first N pages of a PDF to PNG images
    
    Args:
        pdf_path (str): Path to the PDF file
        output_dir (str): Directory to save the images
        num_pages (int): Number of pages to convert from the beginning
        dpi (int): Resolution for the output image
    
    Returns:
        dict: Result containing success status and image paths
    """
    try:
        # Ensure output directory exists
        os.makedirs(output_dir, exist_ok=True)
        
        # Convert first N pages to images
        images = convert_from_path(
            pdf_path, 
            dpi=dpi,
            first_page=1,
            last_page=num_pages,
            poppler_path=POPPLER_PATH
        )
        
        if not images:
            return {
                "success": False,
                "error": f"No images generated for first {num_pages} pages"
            }
        
        # Save all images and collect their paths
        pdf_name = os.path.splitext(os.path.basename(pdf_path))[0]
        # Remove timestamp prefix if present (e.g., "1753973860040-Tom Jones" -> "Tom Jones")
        if '-' in pdf_name and pdf_name.split('-')[0].isdigit():
            pdf_name = '-'.join(pdf_name.split('-')[1:])
        
        image_paths = []
        for i, image in enumerate(images, 1):
            image_filename = f"{pdf_name}_page_{i}.png"
            image_path = os.path.join(output_dir, image_filename)
            image.save(image_path, "PNG")
            image_paths.append(image_path)
        
        return {
            "success": True,
            "image_paths": image_paths,
            "num_pages": len(images),
            "primary_image_path": image_paths[0],  # For backward compatibility
            "image_path": image_paths[0],  # For backward compatibility
            "width": images[0].width,
            "height": images[0].height
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

def main():
    """Main function to handle command line arguments"""
    if len(sys.argv) < 4:
        print(json.dumps({
            "success": False,
            "error": "Usage: python pdf_to_images.py <pdf_path> <output_dir> <page_number> [dpi]"
        }))
        sys.exit(1)
    
    pdf_path = sys.argv[1]
    output_dir = sys.argv[2]
    num_pages = int(sys.argv[3])
    dpi = int(sys.argv[4]) if len(sys.argv) > 4 else 150
    
    # Check if PDF file exists
    if not os.path.exists(pdf_path):
        print(json.dumps({
            "success": False,
            "error": f"PDF file not found: {pdf_path}"
        }))
        sys.exit(1)
    
    # Convert PDF to images
    result = convert_pdf_to_images(pdf_path, output_dir, num_pages, dpi)
    
    # Output result as JSON
    print(json.dumps(result))

if __name__ == "__main__":
    main()