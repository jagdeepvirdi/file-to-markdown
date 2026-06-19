# File → Markdown

A local-first, fully offline desktop app: drop a file, get clean Markdown back.
Powered by Microsoft's [MarkItDown](https://github.com/microsoft/markitdown).
No AI, no uploads, no internet required.

[![Latest Release](https://img.shields.io/github/v/release/jagdeepvirdi/file-to-markdown)](https://github.com/jagdeepvirdi/file-to-markdown/releases/latest)

**[⬇ Download for Windows (x64)](https://github.com/jagdeepvirdi/file-to-markdown/releases/latest/download/FileToMarkdown-windows-x64.exe)**

```
┌──────────────────┬──────────────────┬──────────────────────────────┐
│   Input File     │     Action       │       Output Preview         │
│                  │                  │                              │
│  ┌────────────┐  │  [ Convert  ▶ ]  │  # Document Title            │
│  │ Drop file  │  │                  │  Body text extracted as      │
│  │ or browse  │  │  Log History     │  clean Markdown…             │
│  └────────────┘  │  ✓ report.pdf    │                              │
│                  │  ✓ notes.docx    │  [Clear] [Copy] [Download]   │
└──────────────────┴──────────────────┴──────────────────────────────┘
```

## Supported file types

| Format | Extensions |
|--------|-----------|
| PDF | `.pdf` |
| Word | `.docx` |
| PowerPoint | `.pptx` |
| Excel | `.xlsx`, `.xls` |
| Data | `.csv`, `.json`, `.jsonl` |
| Text / Markup | `.txt`, `.text`, `.md`, `.markdown`, `.html`, `.htm` |
| eBook | `.epub` |
| Notebook | `.ipynb` |
| Email | `.msg` |
| Archive | `.zip` (converts all supported files inside) |
| Images | `.jpg`, `.jpeg`, `.png` (EXIF metadata + any embedded/OCR text) |

Audio (`.wav`/`.mp3`/`.m4a`) is **not** included by default — MarkItDown's audio converter calls Google's Web Speech API, which breaks the offline guarantee. See [Optional: audio support](#optional-audio-support).

## How it works

```
file (drag/drop or file picker)
    │  browser reads bytes, base64-encodes them
    ▼
window.pywebview.api.convert_file(name, data)   ← network-free Python bridge
    │  Python writes temp file → MarkItDown converts → temp file deleted
    ▼
markdown text returned to the frontend
    │
    ├─ Copy button      → pyperclip (native OS clipboard)
    ├─ Download button  → native "Save As" dialog
    └─ Log History      → metadata in localStorage; content in ~/.md-converter/history/
```

Everything runs in a single process on your machine. The "desktop app" is [pywebview](https://pywebview.flowrl.com/), which wraps your OS's built-in web renderer — WebView2 on Windows, WKWebView on macOS, GTK/WebKit on Linux. No Chromium, no Electron.

## Features

- **Three-column workspace** — file picker, conversion controls + log history, and live Markdown preview side by side
- **Persistent log history** — past conversions survive app restarts; click any entry to reload its output. Large markdown files are stored on disk (`~/.md-converter/history/`) rather than in localStorage to avoid the 5 MB cap
- **Markdown preview** — rendered via [marked.js](https://github.com/markedjs/marked) v18, bundled locally (no CDN). XSS-safe: `javascript:`, `data:`, and `vbscript:` link schemes are blocked
- **Keyboard shortcuts**

  | Shortcut | Action |
  |----------|--------|
  | `Escape` | Clear selected file or clear preview |
  | `Ctrl+Enter` | Submit selected file for conversion |
  | `Ctrl+C` | Copy Markdown (when no text is selected) |

- **80 MB file cap** — enforced client-side and server-side; raise `MAX_FILE_SIZE_BYTES` in `converter.py` if you need more headroom
- **No network calls** — `enable_plugins=False` on MarkItDown, no `llm_client` attached, no telemetry

## Project layout

```
md-converter/
├── app.py               # pywebview entry point + Python API exposed to JS
├── converter.py         # MarkItDown wrapper, supported-extension registry
├── requirements.txt
├── build.py             # PyInstaller packaging script
├── tests/
│   └── test_converter.py
└── frontend/
    ├── index.html
    ├── style.v2.css
    ├── app.v2.js        # drag/drop, state, API calls, log history
    └── marked.umd.js    # marked v18 UMD build (bundled, no CDN)
```

## Run in development

```bash
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

## Run tests

```bash
python -m unittest tests/test_converter.py
```

## Build a standalone executable

Run this **on the target OS** — PyInstaller does not cross-compile:

```bash
pip install -r requirements.txt
python build.py
```

Output:
- Windows → `dist/FileToMarkdown.exe`
- macOS   → `dist/FileToMarkdown.app`
- Linux   → `dist/FileToMarkdown`

Drop an `icon.ico` (Windows) or `icon.icns` (macOS) next to `build.py` before building to get a custom app icon — `build.py` picks it up automatically.

> **Binary size note:** First builds land in the 60–150 MB range. Most of that is `onnxruntime`, a dependency of MarkItDown's file-type sniffer (`magika`). It runs a tiny local classifier to detect MIME types from file bytes — nothing AI-related, nothing leaves your machine.

### Windows — WebView2

`pywebview` uses Microsoft Edge WebView2, which ships with Windows 10/11. If targeting an older or stripped-down image, bundle the [WebView2 Runtime installer](https://developer.microsoft.com/microsoft-edge/webview2/) with your `.exe`.

### Linux — GTK + WebKit

```bash
sudo apt install python3-gi gir1.2-gtk-3.0 gir1.2-webkit2-4.1
```

## Optional: audio support

```bash
pip install markitdown[audio-transcription]
```

Then add to `SUPPORTED_EXTENSIONS` in `converter.py`:

```python
".wav": "Audio (speech-to-text)",
".mp3": "Audio (speech-to-text)",
".m4a": "Audio (speech-to-text)",
```

> **Note:** The default recognizer sends audio to Google's free Web Speech API — this breaks the offline guarantee.

## Design notes

- **No server, no AI.** MarkItDown is deterministic format-conversion code (parsers + rule-based extraction), not a language model. No `llm_client` is ever attached, so the optional AI image-captioning and Bing-search converters in upstream MarkItDown are never reachable here.
- **Bytes over paths.** The frontend reads dropped/picked files as bytes in JS and ships them across the bridge as base64. This means drag-and-drop "just works" without relying on pywebview's more fragile native file-path APIs.
- **Cache busting.** WebView2 caches aggressively. CSS/JS files use versioned names (`style.v2.css`, `app.v2.js`). Bump the version suffix when making breaking frontend changes.

## License

MIT
