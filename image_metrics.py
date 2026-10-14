#!/usr/bin/env python3
"""Calculate deterministic, local-only page image metrics for ScanAuditor."""

import json
import sys
from pathlib import Path

from PIL import Image, ImageFilter, ImageStat


def difference_hash(image):
    small = image.convert("L").resize((9, 8), Image.Resampling.LANCZOS)
    pixels = list(small.getdata())
    value = 0
    for y in range(8):
        row = y * 9
        for x in range(8):
            value = (value << 1) | (1 if pixels[row + x] > pixels[row + x + 1] else 0)
    return f"{value:016x}"


def analyze_image(path, page_number):
    image_path = Path(path)
    if not image_path.is_file():
        raise FileNotFoundError(f"Page image not found for page {page_number}")

    with Image.open(image_path) as image:
        gray = image.convert("L")
        sample = gray.resize((256, 256), Image.Resampling.LANCZOS)
        pixels = list(sample.getdata())
        stats = ImageStat.Stat(sample)
        edge_stats = ImageStat.Stat(sample.filter(ImageFilter.FIND_EDGES))
        white_ratio = sum(1 for value in pixels if value >= 245) / len(pixels)

        return {
            "pageNumber": page_number,
            "width": image.width,
            "height": image.height,
            "brightnessMean": round(stats.mean[0], 2),
            "contrastStdDev": round(stats.stddev[0], 2),
            "edgeVariance": round(edge_stats.var[0], 2),
            "whitePixelRatio": round(white_ratio, 4),
            "dhash": difference_hash(image),
        }


def main():
    try:
        request = json.load(sys.stdin)
        paths = request.get("imagePaths", [])
        if not isinstance(paths, list):
            raise ValueError("imagePaths must be an array")
        pages = [analyze_image(path, index + 1) for index, path in enumerate(paths)]
        print(json.dumps({"success": True, "pages": pages}))
        return 0
    except Exception as exc:
        print(json.dumps({"success": False, "error": str(exc), "pages": []}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
