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

The cost dashboard is scoped to the **most recent scan run**, not a fixed number of files or pages. If you process a single four-page PDF, the run contains **four pages**. If you process three PDFs with 5, 12 and 8 pages, the run contains **25 pages**. The PDF page totals come from the analyzer after each run, not from a guessed records-per-project setting. If a file cannot be opened and its page count is unknown, the dashboard warns that some page counts are unavailable.

The dashboard shows:
- **Pages in last run:** sum of the page counts in the PDFs just analyzed.
- **API spend for last run:** reported API input/output token usage (including paid fallback attempts and retries) for that run.
- **Estimated cost per page:** last run's metered usage divided by the number of pages with usage. When none were metered, uses documented token assumptions.
- **Estimated total for last run:** recorded spend for that run plus expected costs for pages with no metered usage; if every page was metered, this equals the run spend.
- **API spend across all runs:** cumulative logged OpenAI usage; does not reset each time you start a new run.

Example: one 12-page cloud PDF uses exactly 12 pages for its own total. The app never multiplies that by 100,000 records automatically.

An **optional future target (pages)** may be entered when you want to extrapolate the expected price of many *future pages*. Leaving it blank displays no future-project estimate. This separate target does not change the last-run cost or page count. Mode-specific future projections use the selected OpenAI mode's observed usage when available, otherwise planning token assumptions. A local-only run has $0 OpenAI API cost; electricity/hardware costs are not tracked.

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
