# File → Markdown Converter

A local-first, fully offline desktop app that converts documents to Markdown using Microsoft's MarkItDown library. Runs as a native window via `pywebview` (WebView2 on Windows).

## Project Structure

```
md-converter/
├── app.py               # Entry point — pywebview window + JS API bridge
├── converter.py         # MarkItDown wrapper (conversion logic + validation)
├── requirements.txt     # Python dependencies
├── build.py             # PyInstaller packaging script
├── tests/
│   └── test_converter.py  # Unit tests for convert_bytes
└── frontend/
    ├── index.html       # Single-page app shell
    ├── app.v2.js        # All UI logic: drag/drop, state, API calls, log history
    ├── style.v2.css     # Dark-theme CSS (CSS variables, three-column grid)
    └── marked.umd.js    # marked v18 UMD build (bundled locally, no CDN)
```

## Running the App

```bash
# Install dependencies (requires Python 3.10+)
pip install -r requirements.txt

# Run in dev mode
python app.py
```

## Running Unit Tests

```bash
python -m unittest tests/test_converter.py
```

## Building a Standalone Binary

```bash
python build.py
# Output: dist/FileToMarkdown.exe (Windows) or dist/FileToMarkdown.app (macOS)
```

## Architecture

**Backend (Python)**
- `app.py`: `Api` class methods are exposed to JS as `window.pywebview.api.*`
- `converter.py`: Converts base64 file data via MarkItDown; writes to a temp file (MarkItDown requires a real path), converts, then deletes it
- Conversions run in a `daemon=True` background thread so the UI stays responsive
- Result is posted back to JS via `window.evaluate_js("window.__onConvertResult(...)")`
- History API: `save_history_file(id, content)`, `read_history_file(id)`, `delete_history_file(id)`, `clear_history_files()` — write/read markdown outputs under `~/.md-converter/history/<id>.md`; IDs are sanitized to alphanumeric + `-_` only

**Frontend (Vanilla JS)**
- Three-column workspace: Input File | Action + Log History | Output Preview
- JS bridge readiness gated on `pywebviewready` event with a 300ms fallback
- Log history metadata is stored in `localStorage` as `"md_converter_logs"` (capped at 50 entries), while the raw converted Markdown text is saved locally on disk under `~/.md-converter/history/` to prevent `localStorage` limits (5MB) from being exceeded.
- Markdown-to-HTML preview powered by [marked.js](https://github.com/markedjs/marked) v18 (UMD build bundled at `frontend/marked.umd.js`); custom renderer blocks `javascript:`/`data:`/`vbscript:` link schemes and renders images as text references

**JS↔Python Bridge**
- File data travels as `FileReader.readAsDataURL` (base64) — ~33% size overhead
- `Api._window` is prefixed with `_` so pywebview's introspector skips it (prevents WebView2 hang)

## CSS/JS Cache Busting

WebView2 caches aggressively. When updating styles or scripts, use versioned filenames (`style.v2.css`, `app.v2.js`) and update the `<link>` / `<script>` tags in `index.html` to match.

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Escape` | Clear selected file or clear preview |
| `Ctrl+Enter` | Submit selected file for conversion |
| `Ctrl+C` | Copy markdown (when no text is selected) |

## Key Constraints

- No network calls — `enable_plugins=False` on MarkItDown, no `llm_client` attached
- Audio transcription is intentionally excluded (Google's Speech API is not offline)
- Max file size: 80 MB (set in `converter.py`; enforced client-side and server-side)
- Error log written to `~/.md-converter/error.log` for diagnosing packaged-build crashes
