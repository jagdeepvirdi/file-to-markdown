# File → Markdown

A tiny, offline desktop app: give it a file, it converts it to Markdown
using Microsoft's [MarkItDown](https://github.com/microsoft/markitdown),
you copy or download the result. No AI, no upload, no internet required
to run.

```
┌─────────────────────────────┐        ┌─────────────────────────────┐
│       Drop a file here        │  ──▶   │  # Heading                   │
│        or click to browse     │        │  Body text extracted as      │
│                                │        │  clean markdown...           │
│  [Show supported file types]  │        │  [Copy]  [Download .md]      │
└─────────────────────────────┘        └─────────────────────────────┘
```

## What it supports

PDF, Word (`.docx`), PowerPoint (`.pptx`), Excel (`.xlsx`/`.xls`),
CSV, JSON/JSONL, plain text/Markdown, HTML, EPUB, Jupyter notebooks
(`.ipynb`), Outlook `.msg`, ZIP archives (converts everything inside),
and images (`.jpg`/`.png` — extracts EXIF metadata and any embedded/OCR
text MarkItDown can find).

Click "Show supported file types" in the app to see the live list
(it's read straight from `converter.py`, so it can't drift out of sync).

Audio transcription is deliberately **not** included by default — MarkItDown's
audio converter calls Google's free Web Speech API, which isn't offline.
See "Optional: audio support" below if you want it anyway.

## How it works

```
file bytes (drag/drop or file picker)
        │  JS reads the file, base64-encodes it
        ▼
window.pywebview.api.convert_file(name, data)   <- the only network-free "bridge"
        │  Python writes a temp file, calls MarkItDown, deletes the temp file
        ▼
markdown text returned to the page
        │
        ├─ Copy button   -> pyperclip (native OS clipboard)
        └─ Download button -> native OS "Save As" dialog
```

Everything runs in a single process on your machine. The "desktop app" part is
[pywebview](https://pywebview.flowrl.com/), which just opens a native window
around your OS's built-in web renderer (WebView2 on Windows, WKWebView on
macOS, GTK/WebKit on Linux) — no Chromium bundling, no Electron weight.

## Project layout

```
md-converter/
├── app.py              # pywebview entry point + Python API exposed to JS
├── converter.py         # MarkItDown wrapper, supported-extension registry
├── frontend/
│   ├── index.html
│   ├── style.css
│   └── app.js           # drag/drop, state machine, tiny MD previewer
├── requirements.txt
├── build.py              # PyInstaller packaging script
└── README.md
```

## Run it (development)

```bash
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

A window opens. Drop a file in, review the output, copy or download it.

## Build a standalone executable

Run this **on the OS you want to ship for** (PyInstaller doesn't cross-compile):

```bash
pip install -r requirements.txt
python build.py
```

Output:
- Windows → `dist/FileToMarkdown.exe`
- macOS → `dist/FileToMarkdown.app`
- Linux → `dist/FileToMarkdown` (ELF binary)

Drop an `icon.ico` (Windows) or `icon.icns` (macOS) next to `build.py`
before building if you want a custom app icon — `build.py` picks it up
automatically.

> First build can take a minute or two and produce a binary in the
> 60–150MB range — most of that is `onnxruntime`, a dependency of
> MarkItDown's file-type sniffer (`magika`), not anything AI-related.
> It runs a tiny local classifier to guess MIME types from file bytes,
> nothing leaves your machine.

### Windows note (WebView2)

`pywebview` on Windows uses Microsoft Edge WebView2, which ships with
Windows 10/11 by default. If you're targeting an older or stripped-down
Windows image, bundle the
[WebView2 Runtime installer](https://developer.microsoft.com/microsoft-edge/webview2/)
alongside your `.exe`.

### Linux note (GTK)

`pywebview` on Linux needs GTK + WebKit2:
```bash
sudo apt install python3-gi gir1.2-gtk-3.0 gir1.2-webkit2-4.1
```

## Optional: audio support

Want `.wav`/`.mp3`/`.m4a` → transcript too? It works, but note the default
recognizer phones home to Google:

```bash
pip install markitdown[audio-transcription]
```

Then in `converter.py`, add to `SUPPORTED_EXTENSIONS`:
```python
".wav": "Audio (speech-to-text)",
".mp3": "Audio (speech-to-text)",
".m4a": "Audio (speech-to-text)",
```

## Design notes / why these choices

- **No server, no AI.** MarkItDown is deterministic format-conversion code
  (parsers + rule-based extraction), not a language model. No `llm_client`
  is ever attached, so the optional AI-image-captioning and Bing-search
  converters in upstream MarkItDown are simply never reachable here.
- **Bytes over paths.** The frontend never needs a real filesystem path —
  it reads the dropped/picked file as bytes in JS and ships those across
  the bridge. That's what makes drag-and-drop "just work" without relying
  on pywebview's more fragile native drag-and-drop file-path APIs.
- **80MB size cap.** The JS↔Python bridge round-trips everything as a
  base64 string; very large files would make the UI feel like it hung.
  Raise `MAX_FILE_SIZE_BYTES` in `converter.py` if you need more headroom.
- **Raw/Preview toggle.** The preview renderer is a ~120-line dependency-free
  subset parser (headings, lists, tables, code fences, links/images, bold/
  italic, blockquotes) — enough to sanity-check MarkItDown's actual output
  without pulling in a full CommonMark library for a single-purpose tool.
