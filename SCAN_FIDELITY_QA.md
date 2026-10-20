# ScanAuditor Scan-Fidelity QA

ScanAuditor performs automated quality assurance on PDF copies of paper medical records, using local Ollama by default or hospital-authorized cloud inference. Its purpose is to identify conditions that may indicate the digital copy does not faithfully reproduce the paper source.

## What the automated QA checks

- Every page present in the PDF is processed.
- PDFs are rendered at 300 DPI by default before OCR and visual analysis.
- Patient identifiers are extracted with high/medium/low uncertainty labels.
- Pages without a confirmed identifier can be recognized as high-confidence continuation pages.
- Explicit pagination such as `Page 1 of 4` is recognized as a document start, with pages 2–4 treated as continuations when pagination agrees. A first PDF page cannot be a prior-page continuation.
- OCR, structured identifier/date extraction, and model-based continuation classification are retried before a technical model failure is reported.
- Same-page admission/discharge anomalies are recorded as informational source-document observations, not scan defects.
- Visual analysis looks for unreadable, blurry, dark, light, cut-off, incomplete, rotated, or misaligned pages.
- Deterministic image metrics are calculated locally.
- Exact duplicates use SHA-256 image equality; possible near duplicates require both perceptual-image and OCR-text similarity.

## Review-worthy findings versus informational observations

ScanAuditor checks the **fidelity of digitization**, not the legibility, completeness, or clinical correctness of the paper original. The model cannot prove from a PDF alone whether the paper was faded, blurred, or poorly handwritten.

- **Informational:** Uncertain handwritten patient names or hospital numbers, uncertain dates, and low-confidence or unsupported model observations of blur, lightness, darkness, or tilt. These do not alone force `Review Required`.
- **Review Required:** Strong, localized model evidence of material loss of printed content (such as visibly clipped content or materially illegible printed text), unresolved page linkage, confirmed competing patient identifiers, or detected duplicates. **Possible defects always require comparison with the paper before recommending rescanning.**
- **Technical processing issues:** failed OCR, image metrics or other analysis stages remain review/analysis failures.
- **Legacy local image assessments:** because older/local quality results may lack granular evidence, severe unreadable/cutoff/incomplete flags still go to review. Subjective blur/lighting/tilt without corroboration remains informational.

The cloud model returns bounded non-PHI quality categories (type, confidence, region, reason, suspected material loss). The results UI shows those categories and whether Luna or Sol supplied each final page assessment. These are **model observations, not independently verified paper-to-digital differences**.

## Human review outcomes

The results UI saves a reviewer-selected outcome to a local append-only file indexed by document SHA-256. Choices distinguish a **digital-only visual inspection** (no digitization defect seen or suspected model false positive) from **confirmed paper comparisons** (source issue or scanning defect). Do not select a paper-confirmed outcome unless the paper was actually reviewed. Outcomes are saved separately from the automated status; they never silently replace it. No extracted medical text, patient names or numbers are stored in the review-outcome log.

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

Local mode keeps medical-record analysis within Ollama; cloud mode sends page images and limited OCR context to the authorized OpenAI API organization. Temporary page images are removed after analysis. Operational audit logs contain hashes, model/configuration data, finding codes, and timings, but not OCR text or patient identifiers.
