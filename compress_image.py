#!/usr/bin/env python3
"""
Image compression script for OCR processing.
Reduces image size to prevent ENOBUFS errors when sending to Ollama.
"""

import argparse
import base64
import json
import sys
from io import BytesIO
from PIL import Image

def compress_image(input_base64, max_size=1024, quality=85, preserve_text=False):
    """
    Compress an image to reduce its size for OCR processing.
    
    Args:
        input_base64 (str): Base64 encoded image data
        max_size (int): Maximum width/height for the image
        quality (int): JPEG quality (1-100)
        preserve_text (bool): Use text-preserving compression techniques
    
    Returns:
        dict: Result with success status and compressed image data
    """
    try:
        # Decode base64 image
        image_data = base64.b64decode(input_base64)
        image = Image.open(BytesIO(image_data))
        
        # Convert to RGB if necessary (for JPEG compression)
        if image.mode in ('RGBA', 'LA', 'P'):
            # Create white background for transparent images
            background = Image.new('RGB', image.size, (255, 255, 255))
            if image.mode == 'P':
                image = image.convert('RGBA')
            background.paste(image, mask=image.split()[-1] if image.mode == 'RGBA' else None)
            image = background
        elif image.mode != 'RGB':
            image = image.convert('RGB')
        
        # Resize if image is too large, but preserve text quality
        if max(image.size) > max_size:
            # Calculate new size maintaining aspect ratio
            ratio = max_size / max(image.size)
            new_size = tuple(int(dim * ratio) for dim in image.size)
            
            # Use high-quality resampling for text preservation
            if preserve_text:
                # For text, use LANCZOS which is better for sharp edges
                image = image.resize(new_size, Image.Resampling.LANCZOS)
            else:
                image = image.resize(new_size, Image.Resampling.LANCZOS)
        
        # Compress image with text-preserving settings
        output_buffer = BytesIO()
        
        if preserve_text:
            # For text preservation, use PNG if quality is very high
            if quality >= 95:
                image.save(output_buffer, format='PNG', optimize=True)
            else:
                # Use JPEG with very high quality and specific settings for text
                image.save(output_buffer, format='JPEG', quality=quality, optimize=True, subsampling=0)
        else:
            image.save(output_buffer, format='JPEG', quality=quality, optimize=True)
            
        compressed_data = output_buffer.getvalue()
        
        # Encode back to base64
        compressed_base64 = base64.b64encode(compressed_data).decode('utf-8')
        
        return {
            'success': True,
            'compressed_image': compressed_base64,
            'original_size': len(image_data),
            'compressed_size': len(compressed_data),
            'compression_ratio': len(compressed_data) / len(image_data)
        }
        
    except Exception as e:
        return {
            'success': False,
            'error': str(e)
        }

def main():
    parser = argparse.ArgumentParser(description='Compress image for OCR processing')
    parser.add_argument('--input-buffer', required=True, help='Base64 encoded input image')
    parser.add_argument('--max-size', type=int, default=1024, help='Maximum image dimension')
    parser.add_argument('--quality', type=int, default=85, help='JPEG quality (1-100)')
    parser.add_argument('--preserve-text', action='store_true', help='Use text-preserving compression')
    
    args = parser.parse_args()
    
    # Compress the image
    result = compress_image(args.input_buffer, args.max_size, args.quality, args.preserve_text)
    
    # Output result as JSON
    print(json.dumps(result))
    
    if not result['success']:
        sys.exit(1)

if __name__ == '__main__':
    main() 