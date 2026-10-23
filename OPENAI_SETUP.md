# ScanAuditor OpenAI Mode and Cost Tracker

## Hospital approval comes first

Local Ollama remains the default. OpenAI mode transmits medical-record page images and OCR excerpts to the hospital's OpenAI API organization. **Do not use cloud mode for patient data** until the hospital approves it and has its own API organization/project, agreement, retention settings and regulatory controls in place. The app cannot independently verify the hospital's BAA or account configuration. Do not use a personal API key for production.

Enter a hospital-owned key in the API field, then click Use Key. The key goes to the Electron main process and is not saved to disk. The input is cleared. Clear Key removes it; closing the app also clears it. Never commit a key.

## Modes

- **Local only:** existing local Ollama Qwen3 pipeline, no OpenAI API usage costs.
- **OpenAI tiered:** GPT-6 Luna (model ID gpt-6-luna) makes one multimodal page request returning OCR text, patient identifiers and dates, plus image-quality observations. If its response is unusable, unusually short, uncertain about identifiers, or reports unreadable/cutoff/incomplete, GPT-6.1 Sol (gpt-6.1-sol) re-evaluates that page. Final QA decisions remain deterministic.
- **Astra benchmark:** GPT-6 Astra (gpt-6-astra) evaluates pages without automatic Sol fallback. Reserve this for a limited benchmark.

300-DPI imaging, deterministic image metrics, duplicates, dates, and explicit page-sequence continuation rules remain. Only ambiguous continuations may generate an extra text API call.

## Cost tracker — actual pages in each run

### Simple page-based estimate for staff

The default calculator asks one question: **How many scanned pages do you need to process?** Enter the count (for example, 1,000,000) and click **Estimate Cost**. The display shows:

- The forecasted dollar total for that many **pages**, the estimated API cost **per page**, and the source of the estimate.
- The number of metered pages in the reference run, or number of page-runs in the historical sample.
- A short summary of the latest scan and cumulative tracked API spending.

The default is the **latest matching run's observed dollars per metered page**. The number of PDF files is never multiplied into the forecast because PDFs vary in length. If a run contains four pages and costs $0.038814, the observed rate is $0.0097035 per page; 1,000,000 pages would be **$9,703.50** at that rate, regardless of how many PDFs hold those future pages. A small sample may not be representative.

Open **Advanced Options & Cost History** only when you want to choose a specific run, compare a historical per-page average, or adjust token-planning assumptions. The selected-run dropdown appears only when that method is chosen. Older saved page targets, cost records, and historical data are preserved. Clicking Estimate Cost does **not** trigger any API call. Reset All Cost History is tucked behind two disclosure controls and requires an additional system confirmation.

The cost dashboard is scoped to the **most recent scan run**, not a fixed number of files or pages. If you process a single four-page PDF, the run contains **four pages**. If you process three PDFs with 5, 12 and 8 pages, the run contains **25 pages**. The PDF page totals come from the analyzer after each run, not from a guessed records-per-project setting. If a file cannot be opened and its page count is unknown, the dashboard warns that some page counts are unavailable.

The dashboard shows:
- **Pages in last run:** sum of the page counts in the PDFs just analyzed.
- **API spend for last run:** reported API input/output token usage (including paid fallback attempts and retries) for that run.
- **Estimated cost per page:** last run's metered usage divided by the number of pages with usage. When none were metered, uses documented token assumptions.
- **Estimated total for last run:** recorded spend for that run plus expected costs for pages with no metered usage; if every page was metered, this equals the run spend.
- **API spend across all runs:** cumulative logged OpenAI usage; does not reset each time you start a new run.

Example: one 12-page cloud PDF uses exactly 12 pages for its own total. The app never multiplies that by 100,000 records automatically.

### Pagewise calculation methods

- **Latest matching run (default):** observed spending / number of metered pages in the latest comparable cloud run.
- **One selected run only:** choose a previous run; its cost / its metered page count is used without including older runs. If that run has no usable metered page data, no estimate is shown.
- **Historical average across runs:** combined matching cloud spend / number of distinct metered **(run, page)** pairs. Repeated scans count as additional page-processing events.
- **Local mode:** $0 OpenAI API charges (hardware and electricity are not included).
- **No observed paid pages:** the default or historical modes may show a clearly labeled **planning assumption** based on the estimated input/output tokens per page and fallback percentage in Advanced Options.

Old file-based target settings from previous ScanAuditor versions are not used by the new interface. The next pagewise estimate clears any previously saved file target while preserving actual historical spending and run records.

**Reset All Cost History** permanently clears this computer's local usage and run ledgers and forecast settings only after warning and confirmation. It does not reverse provider charges or delete PDFs, QA evidence, or batch checkpoints. Resets are blocked during an active desktop scan or folder audit.

An **optional future target (pages)** may be entered when you want to extrapolate the expected price of many *future pages*. Leaving it blank displays no future-project estimate. This separate target does not change the last-run cost or page count.

**Future page forecast:** By default the forecast uses the **latest matching run's measured cost per metered page**. The selector can also switch to **Historical average across runs** or to an isolated selected run. Historical average divides the selected OpenAI mode's total metered spending across run-tagged API requests by the number of distinct **(run ID, page)** pairs with usage, *not* by the number of unique PDF pages. This correctly counts a four-page PDF scanned twice as eight paid page-runs, while counting Luna and Sol calls on the same page in a single run only once in the denominator. Total cumulative spending is unchanged by this selection.

If the latest run belongs to another mode (e.g., local only or Astra), the latest-run method falls back to that selected mode's historical average. If no comparable API page-run usage is available, it uses the planning token assumptions and labels the estimate accordingly. Legacy ledger entries without a run ID remain included in lifetime spend but are excluded from historical per-page rates because their repeat-scan counts cannot be reconstructed reliably. A local-only future forecast has $0 OpenAI API cost; electricity/hardware costs are not tracked.

**Worked example:** If a four-page tiered run cost $0.038814, its measured cost is $0.0097035 per page and an optional 1,000,000-page forecast based on that run is **$9,703.50**, not $18,999.75. A repeat run incurs additional actual spending but must not double the cost-per-page denominator unfairly.

Usage is saved to an append-only non-PHI JSONL ledger within Electron's local userData/cost-tracker directory. Records contain model ID, token counts, a document hash/page key and a random run identifier, but no filename, API key, patient identifiers, or OCR text. An additional runs.jsonl file contains only run ID, date, mode, file count, known page count and unknown-page count. The API key remains memory-only.

Published **standard token rates, USD per million tokens (verified 2026-10-20)**:

| Model | Input | Cached input | Output |
| --- | ---: | ---: | ---: |
| GPT-6 Luna | $0.10 | $0.01 | $0.50 |
| GPT-6.1 Sol | $2.00 | $0.10 | $10.00 |
| GPT-6 Astra | $10.00 | $1.00 | $50.00 |

Source: https://developers.openai.com/api/docs/models

**These are estimates, not invoices.** The tracker cannot reconcile the hospital's actual OpenAI billing. It excludes charges not returned in usage (e.g. failed requests), taxes, cache writes, special tiers, surcharges and unrelated API traffic. Review published rates before the full project and update cost_tracker.js if rates change. Batch API discounts are NOT included (the app currently uses synchronous Responses API requests).

## Validation and privacy

Before large-scale use, use approved or de-identified representative records to measure exact hospital-number/name accuracy, scan-quality false positives and false negatives, Sol escalation rate, processing time, and real cost/page. CI only tests mocked provider calls and synthetic data, never real PHI or actual cloud requests.
