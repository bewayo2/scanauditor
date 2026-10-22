# ScanAuditor: Preservation Evidence and Resumable Audits

## Meaning of a scan quality result

ScanAuditor evaluates the **digital reproduction**, not authority to destroy paper. A digital scan quality pass means no configured material reproduction defect was detected. It cannot establish that every original sheet was digitized.

## Internal completeness

Printed page numbering such as Page 1 of 4 through Page 4 of 4 is checked against PDF order. It detects skipped numbers, repeated numbers and potentially unfinished form sequences, while allowing a new sequence when concatenated documents restart at page 1.

The displayed states are **internally-consistent**, **potential-gap**, or **not-establishable**. Even internally consistent PDFs do NOT establish original-paper completeness. Page numbering is OCR-derived; a suspected gap is a review finding, not definitive proof of missing paper. Entirely omitted unnumbered sheets cannot be discovered from the PDF alone.

## Content preservation

In authorized OpenAI mode, the existing single multimodal page request now includes categorical observations of printed text, handwriting, signatures, stamps, marginal notes and visible document edges. Each category can be legible, uncertain, potentially clipped or not observed. A category marked **not observed** cannot be interpreted as proof that the paper original contained a missing signature or stamp. Uncertain handwriting is informational rather than automatically a scanning defect.

Local Ollama mode does not yet produce these additional structured content observations, and correctly displays **not assessed** for that part. Local image metrics independently flag pages that look almost entirely blank (review candidates, not proof of loss).

## PHI-minimized QA evidence JSON

Click **Export QA Evidence (JSON)** for analyzed files. The evidence contains file SHA-256, page count, app/model versions, analysis configuration, QA finding codes, internal completeness, controlled content observations and page diagnostics, plus a SHA-256 digest of the resulting payload. It excludes filenames, OCR text, patient names, hospital numbers and uncontrolled free-form model text.

The evidence digest is deterministic for an existing analysis result, but is **not** a hospital digital signature, trusted timestamp or proof of source-paper completeness.

## Resumable folder audits

Use **Select PDF Folder** and **Start / Resume Folder Audit** in the desktop UI. It traverses subfolders, skips symbolic links, processes PDFs one at a time, and records an append-only per-file checkpoint. **Stop After Current File** halts safely. Re-select the same folder and mode to resume; completed files are skipped. Select **Retry analysis failures** to reattempt files previously recorded as failed. A modified file gets a new checkpoint key.

The desktop UI starts with a **100-new-file pilot limit** and a **$5 metered API spend limit** for cloud mode. The CLI likewise defaults to 100 new files and $5 for cloud runs; use --max-files N and --max-usd N to increase deliberately. Spending limits are checked **between PDFs**, so a large single PDF can exceed the limit before the stop takes effect. These are safeguards, not billing-provider hard caps.

The local journal and evidence are stored in Electron userData/bulk-audit/<hash>/ using keyed path hashes, not source filenames or patient text. The original PDF remains in place. If a paid request succeeds but the app stops before checkpointing, resuming may incur another API request and charge.

### Command-line processing

Example (Windows PowerShell or Command Prompt):

    npm run bulk -- --root "D:\ApprovedPDFArchive" --mode local

Optional flags: --max-files 100 for a pilot and --retry-failed to revisit failed pages. Cloud processing also requires --mode tiered or --mode astra, an OPENAI_API_KEY environment variable associated with the hospital-approved API organization, and the explicit --hospital-approved flag. Do not place API keys in command arguments or source code.

## Deployment cautions

This provides a resumable framework, not validated production throughput for one million PDFs. Test disk requirements, permissions, backup, handling of interruption, OCR accuracy, API rate limits, data-security controls, and forecast costs on an appropriately approved subset before increasing scale. The current runner is sequential and not a distributed batch scheduler. Even a successful batch does not authorize paper disposal.

Create a reviewer-verified benchmark with missing numbered pages, sequence resets, nearly blank pages, difficult source handwriting, stamps, signatures, marginalia, cropped text and low contrast. Measure missed material losses and unnecessary review referrals.
