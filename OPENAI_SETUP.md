# ScanAuditor OpenAI Mode and Cost Tracker

## Hospital approval comes first

Local Ollama remains the default. OpenAI mode transmits medical-record page images and OCR excerpts to the hospital's OpenAI API organization. **Do not use cloud mode for patient data** until the hospital approves it and has its own API organization/project, agreement, retention settings and regulatory controls in place. The app cannot independently verify the hospital's BAA or account configuration. Do not use a personal API key for production.

Enter a hospital-owned key in the API field, then click Use Key. The key goes to the Electron main process and is not saved to disk. The input is cleared. Clear Key removes it; closing the app also clears it. Never commit a key.

## Modes

- **Local only:** existing local Ollama Qwen3 pipeline, no OpenAI API usage costs.
- **OpenAI tiered:** GPT-6 Luna (model ID gpt-6-luna) makes one multimodal page request returning OCR text, patient identifiers and dates, plus image-quality observations. If its response is unusable, unusually short, uncertain about identifiers, or reports unreadable/cutoff/incomplete, GPT-6.1 Sol (gpt-6.1-sol) re-evaluates that page. Final QA decisions remain deterministic.
- **Astra benchmark:** GPT-6 Astra (gpt-6-astra) evaluates pages without automatic Sol fallback. Reserve this for a limited benchmark.

300-DPI imaging, deterministic image metrics, duplicates, dates, and explicit page-sequence continuation rules remain. Only ambiguous continuations may generate an extra text API call.

## Project cost tracker

The UI displays estimated recorded spend, cost per page, projected total, and metered versus planned pages. Actual Responses API usage (input/output/cached input tokens) is recorded in an append-only, non-PHI local ledger inside Electron userData/cost-tracker/usage.jsonl. The ledger contains model ID, token counts and a document-hash/page key. No API key, raw OCR text, medical identifiers or filenames are stored.

The planning defaults are **100,000 records, 4 pages per record, 5,000 input tokens, 500 output tokens per page, and 10% Sol fallback**. Change them in the UI. The cost-per-page projection uses assumptions until actual usage is observed for the selected cloud mode. It then uses the observed average for that mode. Repeating the same page adds spend but not unique metered-page progress.

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
