# ScanAuditor Scan-Fidelity QA

ScanAuditor performs local automated quality assurance on PDF copies of paper medical records. Its purpose is to identify conditions that may indicate the digital copy does not faithfully reproduce the paper source.

## What the automated QA checks

- Every page present in the PDF is processed.
- PDFs are rendered at 300 DPI by default before OCR and visual analysis.
- Patient identifiers are extracted with high/medium/low uncertainty labels.
- Pages without a confirmed identifier can be recognized as high-confidence continuation pages.
- Explicit pagination such as `Page 2 of 4` is resolved deterministically before asking a model to classify continuation structure.
- OCR, structured identifier/date extraction, and model-based continuation classification are retried before a technical model failure is reported.
- Same-page admission/discharge anomalies are flagged without comparing unrelated encounters globally.
- Visual analysis looks for unreadable, blurry, dark, light, cut-off, incomplete, rotated, or misaligned pages.
- Deterministic image metrics are calculated locally.
- Exact duplicates use SHA-256 image equality; possible near duplicates require both perceptual-image and OCR-text similarity.

## Technical processing diagnostics

Each analyzed page records non-PHI processing diagnostics for OCR, structured extraction, and continuation classification. Diagnostics include stage status, number of attempts, output character count, continuation method, and broad failure category. OCR text and patient identifiers are not included in these diagnostics.

Technical inference failures are reported separately from document uncertainty. For example, an OCR timeout after all configured retries produces `OCR_MODEL_FAILURE`, while an unidentified page that cannot be linked produces `UNRESOLVED_PAGE`.

The default retry settings are:

- OCR: 3 attempts
- Structured extraction: 2 attempts
- Model-based continuation classification: 2 attempts
- Retry delay: 750 ms, increasing by attempt

These can be adjusted with `SCANAUDITOR_OCR_ATTEMPTS`, `SCANAUDITOR_STRUCTURED_ATTEMPTS`, `SCANAUDITOR_CONTINUATION_ATTEMPTS`, and `SCANAUDITOR_RETRY_DELAY_MS`.

## Automated QA statuses

- **Automated QA Passed**: no configured automated scan-fidelity rule requires manual review.
- **Review Required**: analysis completed, but one or more observations should be reviewed.
- **Analysis Failed**: the application could not produce a meaningful automated QA result.

A pass is not a clinical, regulatory, or EHR-patient approval.

## Important limitations

ScanAuditor cannot determine whether all original paper pages were scanned unless a separate source page count exists. It cannot determine whether an observed defect was already present in the paper source. It does not verify the destination EHR patient. Identifier coverage is reported as information and is not itself a pass/fail percentage.

Medical-record analysis remains local through Ollama. Temporary page images are removed after analysis. Operational audit logs contain hashes, model/configuration data, finding codes, and timings, but not OCR text or patient identifiers.
