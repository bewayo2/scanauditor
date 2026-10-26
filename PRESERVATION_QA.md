# ScanAuditor: Preservation Evidence and Resumable Audits

## Meaning of a scan quality result

ScanAuditor evaluates the **digital reproduction**, not authority to destroy paper. A digital scan quality pass means no configured material reproduction defect was detected. It cannot establish that every original sheet was digitized.

## Internal completeness

**Printed numbering is optional and scoped to individual forms or visits, not an entire patient record.** For example, one PDF can contain a visit numbered 1 of 4 through 4 of 4, an unnumbered handwritten continuation, another visit numbered 1 of 6 through 6 of 6, and several unnumbered laboratory reports. This is normal and does not itself trigger a review.

ScanAuditor groups numbering into separate sequences whenever a page restarts at 1, decreases, or declares a different total. It keeps unnumbered pages in the PDF without assuming they are missing or erroneous. An unnumbered page between two numbered pages might itself contain the content implied by a skipped printed page number.

A review finding for an internal gap now requires **a clearly established consecutive numbered run beginning at 1, followed by an abrupt jump on adjacent PDF pages** (for example, printed 1 of 4, 2 of 4, then 4 of 4). A less certain jump, such as one separated by an unnumbered continuation sheet, is informational rather than an automatic review finding. A form finishing short of its declared total at the **end of the PDF** may be a review candidate only after several consecutive numbered pages establish the sequence; a visit ending before another visit starts is not automatically considered incomplete. Duplicate printed numbers without strong form context are informational rather than proof of a duplicate scan.

The displayed states are **internally-consistent** (one complete numbered section), **numbered-sections-consistent** (multiple complete numbered sections and/or unnumbered sheets), **potential-gap** (strong suspicion requiring comparison), and **not-establishable** (insufficient evidence). Even internally consistent sections do NOT establish original-paper completeness. Page numbering is OCR-derived and can contain recognition errors. Entirely omitted unnumbered paper sheets cannot be discovered from the PDF alone.

## Content preservation

In authorized OpenAI mode, the existing single multimodal page request now includes categorical observations of printed text, handwriting, signatures, stamps, marginal notes and visible document edges. Each category can be legible, uncertain, potentially clipped or not observed. A category marked **not observed** cannot be interpreted as proof that the paper original contained a missing signature or stamp. Uncertain handwriting is informational rather than automatically a scanning defect.

Local Ollama mode does not yet produce these additional structured content observations, and correctly displays **not assessed** for that part. Local image metrics independently flag pages that look almost entirely blank (review candidates, not proof of loss).

## PHI-minimized QA evidence JSON

Click **Export QA Evidence (JSON)** for analyzed files. The evidence contains file SHA-256, page count, app/model versions, analysis configuration, QA finding codes, internal completeness, controlled content observations and page diagnostics, plus a SHA-256 digest of the resulting payload. It excludes filenames, OCR text, patient names, hospital numbers and uncontrolled free-form model text.

The evidence digest is deterministic for an existing analysis result, but is **not** a hospital digital signature, trusted timestamp or proof of source-paper completeness.

## SQLite audit projects and manual review

**Bulk folder audits are the primary ScanAuditor workflow.** An individual PDF scan is a secondary way to create or update an indexed case, using the same document-detail and human-review controls.

The local database is created automatically at **Electron userData/audit-workspace/workspace.sqlite3**. SQLite is hosted by a persistent Python standard-library worker (ScanAuditor already requires Python for PDF rendering). There is no database server, native Node module, separate service installation, or user-run SQL script. The worker uses WAL mode and indexed, transactional records.

After scanning, use **Audit Projects & Review Queue** to select the project. The default queue shows **Review required + Awaiting review**; filters allow Passed, Analysis Failed, Previously Reviewed, **Type of problem** (a plain-language list of problem categories actually present in the selected project), and local filename search. Technical finding codes remain stored in SQLite for reproducibility but are translated into readable labels on screen. The app only fetches **50 records per page**, not an entire 100,000-record population. Failed scans remain visible and can be reviewed or reanalyzed. Project summaries and page counts are calculated in SQLite.

Select **Inspect** to open the same detailed QA report used by a single-file scan. Users can record a manual outcome and optional reviewer label, see past review decisions, request or close a **rescan** or **paper comparison**, export that record's PHI-minimized evidence or its **full individual-equivalent Excel report** (the latter may contain PHI and requires confirmation), and **open the original PDF in the workstation's default viewer**. Reanalyze This Record runs against the existing case and project; it may incur additional cloud API costs with the normal key/hospital-authorization requirement. Automatic findings and human decisions remain separate. Paper-confirmed outcomes are only valid when source paper was actually inspected. Reviewer labels are **not authenticated**, and this desktop prototype has no role-based access control.

The SQLite database retains one current result per source PDF and historical evidence snapshots per reanalysis, plus append-only review and corrective-action status events. When reanalysis changes the input file hash, previous human review does not silently carry forward as the current disposition. Earlier events remain for accountability.

**Privacy and deployment:** Unlike the existing PHI-minimized checkpoint and exported QA evidence, the workspace SQLite database *does* contain local source paths, filenames, detailed analysis, and potentially patient identifiers. It is not encrypted by SQLite itself. Use hospital-managed full-disk encryption, OS account permissions and approved encrypted backups before introducing production PHI. The app uses restrictive Unix filesystem permissions where supported; Windows NTFS permissions depend on endpoint/IT configuration. Do not put the live SQLite/WAL files directly on OneDrive or a multi-PC network share. Use **Back Up Audit Database** to create a consistent snapshot after an explicit sensitive-data warning to a hospital-approved destination. Backups require secure handling and an IT-supported restore plan. **Export Project Summary (CSV)** also warns that filenames may identify patients; the CSV is streamed from indexed records and is not automatically uploaded.

This is a single-workstation, locally indexed audit system; it is **not** a validated centrally governed multi-user hospital records system. True shared reviewer logins, authenticated reviewer identities, permissions, cross-workstation conflict control, centralized backups and administrative sign-off would require an additional centrally hosted service.

**Clean start:** earlier pre-SQLite test-batch checkpoints and legacy JSONL scan results are not imported (by request). New checkpoints are in a separately versioned namespace so old test runs do not skip newly indexed records. Existing raw legacy files remain on disk until an administrator removes them; the new database does not destroy PDFs, provider charges, or old data.

## Resumable folder audits

Use **Select PDF Folder** and **Start / Resume Folder Audit** in the desktop UI. The selected folder's **full local path is shown on screen**, but it is never stored in the checkpoint, progress ledger, or cloud request.

After selection, a **read-only preview** traverses the folder and subfolders (without following symbolic links) to count PDF files. It then reads page-count metadata for up to **60 uniformly sampled PDFs** (or every PDF if there are fewer than 60). The screen displays **Anticipated pages in folder** as an approximate extrapolation from sampled pages per PDF, along with the sample size and unreadable sample count. Only when every file's page metadata was successfully read does it label the total an exact metadata count. If no page counts are readable, the estimate is unavailable—not zero. This may take time for very large folders or slow network storage; the inventory displays live stage and file-count feedback.

During scanning, the UI shows the current PDF number **without its name**, a progress bar for the **current batch/session file limit**, processed PDFs, pages **actually processed this session**, files skipped from the prior checkpoint, review/failed counts, and this session's metered API cost. The page counters update after each PDF is completed, not inside a single multi-page PDF. Page estimates and actual totals have different labels; no estimates are counted as verified QA pages. Cumulative progress from older sessions is represented by checkpoint-skip counts, not by silently adding those pages to the present session.

The audit still processes PDFs one at a time and records an append-only per-file checkpoint. **Stop After Current File** halts the current operation (during inventory or after the current PDF when auditing). Re-select the same folder and mode to resume; completed files are skipped. Select **Retry analysis failures** to reattempt previously failed documents. A modified file gets a new checkpoint key.

The desktop UI starts with a **100-new-file pilot limit** and a **$5 metered API spend limit** for cloud mode. The CLI likewise defaults to 100 new files and $5 for cloud runs; use --max-files N and --max-usd N to increase deliberately. Spending limits are checked **between PDFs**, so a large single PDF can exceed the limit before the stop takes effect. These are safeguards, not billing-provider hard caps.

The local journal and PHI-minimized evidence are stored in Electron userData/bulk-audit/<hash>/ using keyed path hashes, not source filenames or patient text. The review workspace's separate SQLite database stores full details and file paths under the local userData directory. The original PDF remains in place. If a paid request succeeds but the app stops before checkpointing, resuming may incur another API request and charge.

### Command-line processing

Example (Windows PowerShell or Command Prompt):

    npm run bulk -- --root "D:\ApprovedPDFArchive" --mode local

Optional flags: --max-files 100 for a pilot and --retry-failed to revisit failed pages. Cloud processing also requires --mode tiered or --mode astra, an OPENAI_API_KEY environment variable associated with the hospital-approved API organization, and the explicit --hospital-approved flag. Do not place API keys in command arguments or source code.

## Deployment cautions

This provides a resumable framework, not validated production throughput for one million PDFs. Test disk requirements, permissions, backup, handling of interruption, OCR accuracy, API rate limits, data-security controls, and forecast costs on an appropriately approved subset before increasing scale. The current runner is sequential and not a distributed batch scheduler. Even a successful batch does not authorize paper disposal.

Create a reviewer-verified benchmark with missing numbered pages, sequence resets, nearly blank pages, difficult source handwriting, stamps, signatures, marginalia, cropped text and low contrast. Measure missed material losses and unnecessary review referrals.
