#!/usr/bin/env python3
"""Convert PDF pages to PNG images for ScanAuditor."""

import json
import os
import sys
from pathlib import Path

from pdf2image import convert_from_path


def resolve_poppler_path():
    """Use POPPLER_PATH, a bundled relative install, or the system PATH."""
    env_path = os.environ.get("POPPLER_PATH")
    if env_path and Path(env_path).is_dir():
        return env_path

    root = Path(__file__).resolve().parent
    candidates = [
        root / "poppler-windows" / "poppler-24.08.0" / "Library" / "bin",
        root / "poppler-windows" / "Library" / "bin",
        root / "poppler" / "Library" / "bin",
    ]
    for candidate in candidates:
        if candidate.is_dir():
            return str(candidate)
    return None


def convert_pdf_to_images(pdf_path, output_dir, num_pages, dpi=300):
    """Convert every requested page, one at a time, to avoid loading a large PDF into memory."""
    try:
        pdf_path = Path(pdf_path).resolve()
        output_dir = Path(output_dir).resolve()
        output_dir.mkdir(parents=True, exist_ok=True)

        if not pdf_path.is_file():
            return {"success": False, "error": f"PDF file not found: {pdf_path}"}
        if num_pages < 1:
            return {"success": False, "error": "num_pages must be at least 1"}

        poppler_path = resolve_poppler_path()
        image_paths = []
        pdf_name = pdf_path.stem

        for page_number in range(1, num_pages + 1):
            images = convert_from_path(
                str(pdf_path),
                dpi=dpi,
                first_page=page_number,
                last_page=page_number,
                poppler_path=poppler_path,
                thread_count=1,
            )
            if len(images) != 1:
                return {
                    "success": False,
                    "error": f"Expected one image for page {page_number}, got {len(images)}",
                }

            image_path = output_dir / f"{pdf_name}_page_{page_number}.png"
            images[0].save(image_path, "PNG", optimize=True)
            image_paths.append(str(image_path))
            images[0].close()
            # Machine-readable, PHI-free progress. The final result still goes
            # to stdout as one JSON document. Flush for long-running PDF jobs.
            sys.stderr.write(f"SCAN_PROGRESS:{page_number}\\n")
            sys.stderr.flush()

        return {
            "success": True,
            "image_paths": image_paths,
            "num_pages": len(image_paths),
            "poppler_source": "configured" if poppler_path else "system-path",
        }
    except Exception as exc:
        return {"success": False, "error": str(exc)}


def main():
    if len(sys.argv) < 4:
        print(json.dumps({
            "success": False,
            "error": "Usage: python pdf_to_images.py <pdf_path> <output_dir> <num_pages> [dpi]",
        }))
        return 1

    try:
        num_pages = int(sys.argv[3])
        dpi = int(sys.argv[4]) if len(sys.argv) > 4 else 300
    except ValueError:
        print(json.dumps({"success": False, "error": "num_pages and dpi must be integers"}))
        return 1

    result = convert_pdf_to_images(sys.argv[1], sys.argv[2], num_pages, dpi)
    print(json.dumps(result))
    return 0 if result.get("success") else 1


if __name__ == "__main__":
    raise SystemExit(main())
