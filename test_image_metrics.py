import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

from image_metrics import analyze_image, difference_hash


class ImageMetricsTests(unittest.TestCase):
    def test_brightness_and_white_ratio_change(self):
        with tempfile.TemporaryDirectory() as tmp:
            white = Path(tmp) / "white.png"
            black = Path(tmp) / "black.png"
            Image.new("L", (100, 100), 255).save(white)
            Image.new("L", (100, 100), 0).save(black)
            white_metrics = analyze_image(white, 1)
            black_metrics = analyze_image(black, 2)
            self.assertGreater(white_metrics["brightnessMean"], black_metrics["brightnessMean"])
            self.assertGreater(white_metrics["whitePixelRatio"], black_metrics["whitePixelRatio"])

    def test_identical_images_have_identical_dhash(self):
        image = Image.new("L", (100, 100), 255)
        draw = ImageDraw.Draw(image)
        draw.rectangle((10, 10, 60, 60), fill=0)
        self.assertEqual(difference_hash(image), difference_hash(image.copy()))


if __name__ == "__main__":
    unittest.main()
