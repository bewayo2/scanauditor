# ScanAuditor Scan-Fidelity QA

ScanAuditor performs local automated quality assurance on PDF copies of paper medical records. Its purpose is to identify conditions that may indicate the digital copy does not faithfully reproduce the paper source.

## What the automated QA checks

- Every page present in the PDF is processed.
- PDFs are rendered at 300 DPI by default before OCR and visual analysis.
- Patient identifiers are extracted with high/medium/low uncertainty labels.
- Pages without a confirmed identifier can be recognized as high-confidence continuation pages.
- Same-page admission/discharge anomalies are flagged without comparing unrelated encounters globally.
- Visual analysis looks for unreadable, blurry, dark, light, cut-off, incomplete, rotated, or misaligned pages.
- Deterministic image metrics are calculated locally.
- Exact duplicates use SHA-256 image equality; possible near duplicates require both perceptual-image and OCR-text similarity.

## Automated QA statuses

- **Automated QA Passed**: no configured automated scan-fidelity rule requires manual review.
- **Review Required**: analysis completed, but one or more observations should be compared with the paper source.
- **Analysis Failed**: the application could not produce a meaningful automated QA result.

A pass is not a clinical, regulatory, or EHR-patient approval.

## Important limitations

ScanAuditor cannot determine whether all original paper pages were scanned unless a separate source page count exists. It cannot determine whether an observed defect was already present in the paper source. It does not verify the destination EHR patient. Identifier coverage is reported as information and is not itself a pass/fail percentage.

Medical-record analysis remains local through Ollama. Temporary page images are removed after analysis. Operational audit logs contain hashes, model/configuration data, finding codes, and timings, but not OCR text or patient identifiers.
