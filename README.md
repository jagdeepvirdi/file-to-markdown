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

| Format | Extensions | Notes |
|--------|-----------|-------|
| PDF | `.pdf` | |
| Word | `.docx` | |
| PowerPoint | `.pptx` | |
| Excel | `.xlsx`, `.xls` | |
| Data | `.csv`, `.json`, `.jsonl` | |
| Text / Markup | `.txt`, `.text`, `.md`, `.markdown`, `.html`, `.htm` | |
| eBook | `.epub` | |
| Notebook | `.ipynb` | |
| Email | `.msg` | |
| Archive | `.zip` | Converts all supported files inside |
| Images | `.jpg`, `.jpeg`, `.png` | Offline OCR via Tesseract — requires Tesseract in PATH |
| Audio | `.mp3`, `.wav` | Offline transcription via FFmpeg + PocketSphinx — requires FFmpeg in PATH |
| Video | `.mp4`, `.mkv` | Offline transcription via FFmpeg + PocketSphinx — requires FFmpeg in PATH |

## How it works

```
file (drag/drop or file picker)
    │  browser reads bytes, base64-encodes them
    ▼
window.pywebview.api.convert_file(name, data)   ← network-free Python bridge
    │  Python writes temp file, then routes by extension:
    │
    ├─ images (.jpg/.jpeg/.png)
    │      └─ media_handlers.process_image() → Tesseract OCR
    │
    ├─ audio/video (.mp3/.wav/.mp4/.mkv)
    │      └─ media_handlers.process_audio_video() → FFmpeg → PocketSphinx
    │
    └─ everything else → MarkItDown(enable_plugins=False) → temp file deleted
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
- **Offline image OCR** — images are processed by Tesseract locally; no cloud vision API. Requires [Tesseract OCR](https://github.com/UB-Mannheim/tesseract/wiki) installed and in PATH
- **Offline audio/video transcription** — media files are segmented into 60-second chunks by FFmpeg, then transcribed by PocketSphinx — entirely on-device. Requires [FFmpeg](https://ffmpeg.org/download.html) installed and in PATH. Both tools return a clear installation guide if missing
- **Markdown preview** — rendered via [marked.js](https://github.com/markedjs/marked) v18, bundled locally (no CDN). XSS-safe: `javascript:`, `data:`, and `vbscript:` link schemes are blocked; `href` attributes are HTML-escaped; images render as `[image: alt]` text references
- **Keyboard shortcuts**

  | Shortcut | Action |
  |----------|--------|
  | `Escape` | Clear selected file or clear preview |
  | `Ctrl+Enter` | Submit selected file for conversion |
  | `Ctrl+C` | Copy Markdown (when no text is selected) |

- **1000 MB file cap** — files up to 80 MB can be processed via drag-and-drop (base64-encoded), while files between 80 MB and 1000 MB must be opened by clicking the drop zone (which launches the native system file picker to pass the file path directly to Python, bypassing memory bottlenecks)
- **No network calls** — `MarkItDown(enable_plugins=False)`, no `llm_client` attached, Tesseract and PocketSphinx run fully on-device, no telemetry

## Project layout

```
md-converter/
├── app.py                  # pywebview entry point + Python API exposed to JS
├── converter.py            # MarkItDown wrapper, supported-extension registry
├── media_handlers.py       # Offline image OCR (Tesseract) and audio/video transcription (FFmpeg + PocketSphinx)
├── requirements.txt        # Runtime dependencies
├── requirements-build.txt  # Build-only dependency (PyInstaller)
├── build.py                # PyInstaller packaging script
├── FileToMarkdown.spec     # PyInstaller spec file (auto-generated by build.py)
├── TASKS.md                # Backlog of improvements and future tasks
├── GEMINI.md               # Gemini developer guide (architecture, flow, API reference)
├── CLAUDE.md               # Claude developer instructions/reference
├── LICENSE                 # MIT License file
├── tests/
│   └── test_converter.py   # Unit tests for convert_bytes, OCR, and transcription pipelines
└── frontend/
    ├── index.html          # HTML structure for the Single Page Application
    ├── style.v2.css        # Layout grid, responsive queries, and dark-theme CSS
    ├── app.v3.js           # Drag/drop, native file selection, API calls, log history
    └── marked.umd.js       # marked v18 UMD build (bundled locally, no CDN)
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

The test suite validates plain text conversions, type guards, empty file handling, offline OCR fallback routing, media transcription chunking and stitching, and direct disk path conversions.

## Build a standalone executable

Run this **on the target OS** — PyInstaller does not cross-compile:

```bash
pip install -r requirements.txt -r requirements-build.txt
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

## External system dependencies

Image OCR and audio/video transcription rely on two system binaries. They are **not** bundled in the Python package — install them separately and make sure they are in your `PATH`. If either is missing, the app returns a clear installation guide as the conversion output.

### Tesseract OCR (for images)

| OS | Command |
|----|---------|
| Windows | `winget install UB-Mannheim.TesseractOCR` |
| macOS | `brew install tesseract` |
| Linux | `sudo apt install tesseract-ocr` |

### FFmpeg (for audio/video)

| OS | Command |
|----|---------|
| Windows | `winget install Gyan.FFmpeg` |
| macOS | `brew install ffmpeg` |
| Linux | `sudo apt install ffmpeg` |

> Audio/video transcription uses [PocketSphinx](https://github.com/cmusphinx/pocketsphinx) — a fully offline speech recogniser. Long files are split into 60-second chunks before transcription. Accuracy is modest compared to cloud APIs, but nothing ever leaves your machine.

## Design notes

- **No server, no AI.** MarkItDown is deterministic format-conversion code (parsers + rule-based extraction), not a language model. `enable_plugins=False` is passed so third-party plugins can't load. No `llm_client` is ever attached, so the optional AI image-captioning and Bing-search converters in upstream MarkItDown are never reachable here.
- **Offline media via `media_handlers.py`.** Images, audio, and video bypass MarkItDown entirely and go through a custom offline pipeline: Tesseract for OCR, FFmpeg + PocketSphinx for transcription. If either binary is absent, the handler returns a markdown-formatted install guide rather than raising an error, so the output panel always shows something useful.
- **Bytes over paths.** The frontend reads dropped/picked files as bytes in JS and ships them across the bridge as base64. This means drag-and-drop "just works" without relying on pywebview's more fragile native file-path APIs.
- **Cache busting.** WebView2 caches aggressively. CSS/JS files use versioned names (`style.v2.css`, `app.v3.js`). Bump the version suffix when making breaking frontend changes.

## License

MIT
