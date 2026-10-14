# Training Data Notes

The current ScanAuditor production pipeline does not fine-tune or retrain Ollama models. The supported feedback mechanism is the interactive learning workflow documented in `LEARNING_GUIDE.md`.

## Recommended workflow

1. Run the application on representative PDF records.
2. Use `node learn.js` with approved text examples when you need to correct identifier extraction behavior.
3. Review and correct patient names and hospital numbers.
4. Keep `learning_data.json` local. It is excluded from Git because it may contain patient information.
5. Re-run the main application. The five most recent corrections are used as few-shot extraction examples.

The learning workflow now uses the same centralized model configuration as the main application. The balanced defaults are `qwen3-vl:8b-instruct` for vision/OCR and `qwen3:14b` for structured text extraction.

## About the older training scripts

`create_training_data.js` and `run_training.js` are experimental utilities retained for reference. Their `training_data.json` output is not consumed by the production analyzer. Do not treat those utilities as authoritative for current model selection or production behavior.

For production behavior, use the pipeline documented in `README.md`, `model_config.js`, and the feedback workflow in `LEARNING_GUIDE.md`.
