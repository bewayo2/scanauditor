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

## Patient-folder / record-association review (separate from scan defects)

In the hospital's **folder-based audit**, ScanAuditor treats a clearly identified patient **folder name**, including `SURNAME_GIVEN_123456`, `REG 123456`, and standalone 5- or 6-digit registration folders, as the authoritative *local reference*. It evaluates the **whole PDF**, not just one page. The folder identity never goes to a cloud model or into the PHI-minimized exported evidence. The local SQLite review store may contain full sensitive identifiers and must remain protected.

A separate **Patient Folder / Identity Review** is created when high-confidence, clearly labeled registration numbers differ by two or more digits on two PDF pages (or on the sole page of a one-page PDF), when a confirmed folder name differs on multiple pages, or when two distinct patient-name groups recur across multiple pages. For a **one-digit number variation**, the entire PDF is considered: isolated or minority alternate readings remain informational; an alternative becomes review-worthy when it is the only registration repeatedly observed on multiple pages, or appears on at least four pages and at least twice as many pages as the expected registration. A sole one-digit difference on a one-page PDF remains informational. Low-confidence readings, clinicians' names, dates, phone numbers and unrelated numeric fields do not independently trigger review. The output suggests possible misassociation requiring human verification; it does not prove scanning error.

The **Needs attention** default Review Queue includes both genuine *material scan-fidelity* findings and corroborated *patient folder / identity* alerts, **as first-class findings within the same overall audit**, while presenting their **different error categories**. A record can therefore read *Overall audit: Review required · Scan quality: Passed · Document preparation / patient identity: Review required*. This can indicate possible misfiling or incorrect paper-record preparation, but the application does not attribute fault to an individual before human confirmation. The per-record summary shows which PDF pages supplied repeated conflicting fields; registration and name values are masked until the operator chooses to reveal them locally. Staff can record **folder registration verified**, **folder mismatch confirmed**, **identity OCR false positive** or **inconclusive**, and request a dedicated **Identity / Filing Investigation** without ordering a needless rescan. Manual outcomes are saved separately and do not change the original automated scan-quality status. The **Type of problem** filter, **Key audit findings** column, project **overall audit finding** totals, and CSV exports all include these document-preparation issues; cases with both issue types are counted only once in the combined total.

A folder without a recognizable standalone registration-number segment is marked **not configured**, not matched. If no clear labeled patient fields are recognized, the result is **unconfirmed**; the app never assumes patient identity is proven from absence of conflict. Current extraction supports the hospital's configured 5- or 6-digit registration number convention; if actual folder naming or identifier lengths differ, configure/test the extractor and folder parser before production. These conservative rules reduce unnecessary flags but do not ensure every wrong-patient record is detected; perform independent sampling and maintain the hospital's identity/records-governance controls.

For cases scanned **before this feature**, earlier SQLite results remain preserved as **not assessed** for folder association. They lack retained page-by-page labeled identifier candidate evidence, so meaningful comparison requires **reanalysis of those files**. The separate PR #15 material-scan-defect reclassification still avoids re-running models just to remove context-only scan flags; that is different from assessing a new folder identity check.

## Material-defect-only review and action-first case details

ScanAuditor's automated **Review required** status is reserved for potential **material scanning defects**, strongly supported missing-page evidence, near-blank unexplained pages, or incomplete scans/analysis. An unresolved unnumbered continuation page, multiple possible OCR-derived patient names, or identical/similar pages **alone** are now **informational observations**, not material digitization failures. They remain available in the detailed report, but do not place a clean scan into the defect-review queue by themselves. A potential wrong-patient or source-record association question is distinct from scan-fidelity QA and may require separate hospital records governance checks.

When staff open a case from the Review Queue (or examine an individual scan), **What needs attention?** appears first. It lists only actual review-required findings and affected PDF page numbers, or clearly states that no material scanning problem was detected. Manual review decisions follow; the long technical details (page metadata, OCR identifiers, content observations and diagnostics) are behind a closed **Full Analysis Details** disclosure. A passed case can still receive optional random-sample human review. The viewer opens the original PDF in the hospital computer's default PDF application; it does not yet jump directly to a flagged page.

**Existing cases:** the SQLite database is advanced to schema version 2 automatically. Current case summaries that were incorrectly flagged solely for uncertain page linkage, multiple recognized patient names or duplicate-looking pages are reclassified in the local database **without re-running AI models or incurring API costs**. Their previous evidence snapshots and manual review/corrective-action history are retained. The current evidence export is regenerated to reflect the updated QA policy, with a new digest; historical evidence remains unchanged. If any genuine potentially material finding remains on a record, that record stays Review required.

A passed automated result means *no material scan defect detected by the configured checks*. It does **not** establish every paper sheet was scanned, establish correct patient attribution, or independently authorize destruction of source paper.

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

The audit processes PDFs one at a time and uses an append-only checkpoint. **Stop After Current File** stops after the current PDF, while folder inventory can stop during traversal. Re-select the folder and mode to resume. New checkpoints record SHA-256 hashes; the runner verifies PDF contents by streaming them before skipping, including when file metadata is unchanged. This introduces additional disk reads during archive-scale resumptions. Previously recorded checkpoints without content hashes remain skippable to avoid automatic repeat billing; their count is reported as unverified legacy skips and they require a planned re-audit when file integrity assurance is necessary. Select **Retry analysis failures** to reattempt earlier failed documents.

The desktop UI starts with a **100-new-file pilot limit** and a **$5 metered API spend limit** for cloud mode. The CLI likewise defaults to 100 new files and $5 for cloud runs; use --max-files N and --max-usd N to increase deliberately. Spending limits are checked **between PDFs**, so a large single PDF can exceed the limit before the stop takes effect. These are safeguards, not billing-provider hard caps.

The local journal and PHI-minimized evidence are stored in Electron userData/bulk-audit/<hash>/ using keyed path hashes and input-content hashes, not source filenames or patient text. The review workspace's separate SQLite database stores full details and file paths under the local userData directory. The original PDF remains in place. If a paid request succeeds but the app stops before checkpointing, resuming may incur another API request and charge.

### Command-line processing

Example (Windows PowerShell or Command Prompt):

    npm run bulk -- --root "D:\ApprovedPDFArchive" --mode local

Optional flags: --max-files 100 for a pilot and --retry-failed to revisit failed pages. Cloud processing also requires --mode tiered or --mode astra, an OPENAI_API_KEY environment variable associated with the hospital-approved API organization, and the explicit --hospital-approved flag. Do not place API keys in command arguments or source code.

## Deployment cautions

This provides a resumable framework, not validated production throughput for one million PDFs. Test disk requirements, permissions, backup, handling of interruption, OCR accuracy, API rate limits, data-security controls, and forecast costs on an appropriately approved subset before increasing scale. The current runner is sequential and not a distributed batch scheduler. Even a successful batch does not authorize paper disposal.

Create a reviewer-verified benchmark with missing numbered pages, sequence resets, nearly blank pages, difficult source handwriting, stamps, signatures, marginalia, cropped text and low contrast. Measure missed material losses and unnecessary review referrals.
