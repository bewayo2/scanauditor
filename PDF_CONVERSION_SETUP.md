# PDF-to-Image Conversion Setup

ScanAuditor converts PDF pages to PNG images with Python `pdf2image`, which requires Poppler. ImageMagick is not used by the current application.

## Python environment

Run one of the setup scripts from the repository root:

```bat
setup_python_env.bat
```

or:

```powershell
.\setup_python_env.ps1
```

Both scripts create `paddleocr_env`, which is the environment used by the PDF conversion path.

## Poppler

`pdf_to_images.py` searches for Poppler in this order:

1. `POPPLER_PATH` environment variable;
2. `poppler-windows/poppler-24.08.0/Library/bin` relative to the repository;
3. `poppler-windows/Library/bin` relative to the repository;
4. Poppler executables available on the system `PATH`.

This makes the application portable; there is no hard-coded `C:\Repos\...` dependency.

## Processing behavior

- Every PDF page is converted and audited.
- Pages are converted one at a time to reduce peak memory use.
- Temporary PNG files are placed under `temp_images/` and deleted after each analysis.
- OCR is performed locally with the configured vision model, which defaults to `qwen3-vl:8b-instruct`.
- The same vision model performs scan-quality checks after OCR/identifier extraction.

## Troubleshooting

If PDF conversion fails:

1. Confirm Python can import `pdf2image`:
   ```bat
   paddleocr_env\Scripts\python.exe -c "import pdf2image; print('ok')"
   ```
2. Confirm Poppler is installed or set `POPPLER_PATH` to its `bin` directory.
3. Run `pdfinfo -v` or `pdftoppm -h` from a terminal if Poppler is on the system `PATH`.
4. Run ScanAuditor again and review the non-PHI error message in the console.

If OCR fails while PDF conversion succeeds, verify Ollama is current and that the configured vision model is installed. The default Qwen3-VL model requires Ollama 0.12.7 or later.
