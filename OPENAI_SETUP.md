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

### Simple estimate for staff

The default cost view asks one question: **How many PDF files do you need to process?** Enter the count and click **Estimate Cost**. ScanAuditor displays one estimated total, the cost per file, the reference sample and a reminder that calculating does not make API calls. It defaults to the latest matching scan run. The last run and the cumulative tracked spend appear as two smaller reference figures.

To select a specific previous run, calculate using a historical average, estimate by pages, or adjust assumed token prices, open **Advanced Options & Cost History**. The chosen-run dropdown appears only when **One selected run only** is selected. Existing saved forecast settings and the full local usage ledger are preserved. Click Estimate Cost again to apply changes. Reset All Cost History is intentionally nested under Advanced Options and a second Reset cost history disclosure; it still requires the Electron main-process confirmation dialog.


The cost dashboard is scoped to the **most recent scan run**, not a fixed number of files or pages. If you process a single four-page PDF, the run contains **four pages**. If you process three PDFs with 5, 12 and 8 pages, the run contains **25 pages**. The PDF page totals come from the analyzer after each run, not from a guessed records-per-project setting. If a file cannot be opened and its page count is unknown, the dashboard warns that some page counts are unavailable.

The dashboard shows:
- **Pages in last run:** sum of the page counts in the PDFs just analyzed.
- **API spend for last run:** reported API input/output token usage (including paid fallback attempts and retries) for that run.
- **Estimated cost per page:** last run's metered usage divided by the number of pages with usage. When none were metered, uses documented token assumptions.
- **Estimated total for last run:** recorded spend for that run plus expected costs for pages with no metered usage; if every page was metered, this equals the run spend.
- **API spend across all runs:** cumulative logged OpenAI usage; does not reset each time you start a new run.

Example: one 12-page cloud PDF uses exactly 12 pages for its own total. The app never multiplies that by 100,000 records automatically.

### Projecting future files from a chosen scan run

The cost tracker also has an **optional future target (files)**. The app uses the **actual count of PDFs in the reference run**, not a hard-coded pages-per-file assumption. For example, if a cloud run processed 4 PDF pages in 1 file and cost $0.038814, projecting 1,000,000 **files** from only that run yields $38,814 (assuming similar files). Projecting 1,000,000 **pages** from the same run yields $9,703.50. These are different budgets and neither is a billing invoice.

- **Latest matching run (default):** Uses the most recently recorded run in the selected model mode for both page and file costing.
- **Only a selected run (ignore history):** Pick a prior run by timestamp, model mode, and actual file/page count. The file projection uses only its cost and file count. Historical charges never enter that estimate. If the run lacks usable metered data or its mode does not match, the forecast displays **unavailable** rather than silently using the full history.
- **Historical average across runs:** Uses observed token spend divided by **all fully metered files** in matching-model runs, weighted by the actual number of files per run. Runs with incomplete API usage are excluded from the historical per-file rate. The older historical **per-page** calculation remains separate.
- File projections require a recorded run with an actual file count. If no paid usage was observed, the app cannot infer cost per file merely from token assumptions: that would require guessing pages per file.
- Neither selecting a run nor choosing a forecasting method changes actual cumulative spending. Local-only mode forecasts $0 in OpenAI charges, excluding hardware and electricity.

**Reset All Cost History** permanently deletes this computer's locally recorded API token-usage ledger, the run-cost history, and saved cost assumptions after a warning and confirmation. The cost tracker then starts with zero recorded spending and no selected samples. **It does not erase actual OpenAI bills or previously incurred charges**, patient PDFs, QA reports, or resumable batch checkpoints. Reset is disabled while an individual or folder audit is active. Cost records collected by a separate CLI process or on another computer are not coordinated by the desktop reset.

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
