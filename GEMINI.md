# Gemini Developer Guide: File → Markdown Converter

This guide outlines the architecture, state machine flow, API integration, and frontend components of the local-first desktop **File → Markdown** converter. Use this document as a quick reference for understanding code structure, refactoring, and debugging.

---

## 📂 Project Structure

```text
md-converter/
├── app.py                 # Application entry point & webview window lifecycle
├── converter.py           # Microsoft MarkItDown local conversion engine wrapper
├── media_handlers.py      # Offline media processor (OCR and audio/video transcription)
├── requirements.txt       # Python runtime dependencies
├── requirements-build.txt # Build-only dependency (PyInstaller)
├── build.py               # Packaging script (PyInstaller config)
├── FileToMarkdown.spec    # PyInstaller build specification (generated)
├── TASKS.md               # Backlog of improvements and future tasks
├── frontend/
│   ├── index.html         # Single Page Application HTML structure
│   ├── app.v5.js          # Drag/drop, validation, API integration, UI handlers
│   ├── style.v2.css       # CSS variable stylesheet (cache-busted)
│   └── marked.umd.js      # Marked.js Markdown parser library (local, offline)
├── tests/
│   └── test_converter.py  # Unit tests for the local conversion engine
└── GEMINI.md              # This developer guide
```

*   [app.py](file:///D:/Project/md-converter/app.py): Launches the PyWebView UI shell, handles the local state cache directory creation, and hosts the JS-to-Python execution API.
*   [converter.py](file:///D:/Project/md-converter/converter.py): Integrates Microsoft's MarkItDown library offline, validating input size and extension types.
*   [media_handlers.py](file:///D:/Project/md-converter/media_handlers.py): Implements local image OCR text extraction and audio/video wav downmixing and speech transcription using OpenAI Whisper and FFmpeg.
*   [build.py](file:///D:/Project/md-converter/build.py): Script to build a standalone platform binary using PyInstaller.
*   [frontend/index.html](file:///D:/Project/md-converter/frontend/index.html): Defines the structured Single Page Application interface.
*   [frontend/app.v5.js](file:///D:/Project/md-converter/frontend/app.v5.js): Handles GUI bindings, drag-and-drop, state orchestration, history list views, and clipboard/download API links.
*   [frontend/style.v2.css](file:///D:/Project/md-converter/frontend/style.v2.css): Contains layout variables, layout grid rules, scrollbar customizations, dark themes, and responsive queries.
*   [frontend/marked.umd.js](file:///D:/Project/md-converter/frontend/marked.umd.js): Renders raw Markdown parsed as structured HTML fully client-side.
*   [tests/test_converter.py](file:///D:/Project/md-converter/tests/test_converter.py): Validates basic engine functions, offline image OCR fallbacks, and the audio/video transcription chunking/stitching pipelines.

---

## ⚙️ Core Architecture & Flow

The app operates fully offline using a native browser window managed by `pywebview` in Python (using WebView2 on Windows).

```mermaid
graph TD
    A["index.html"] -->|Drag & Drop File| B("app.v5.js")
    B -->|Client-side validation size/type| C{"Valid?"}
    C -->|No| D["showToast error alert"]
    C -->|Yes| E["Show Input Info Card"]
    E -->|User clicks Convert| F["Loading Spinner + Disable Button"]
    F -->|FileReader readAsDataURL| G["pywebview API bridge"]
    G -->|Threaded Conversion| H("converter.py wrapper")
    H -->|MarkItDown execution| I{"Success?"}
    I -->|Yes| J["window.__onConvertResult success"]
    I -->|No| K["window.__onConvertResult error"]
    J --> L["Add to Log History & Display Markdown Preview"]
    K --> M["Add to Log History & showToast Alert"]
```

---

## 🐍 Backend API & Execution ([app.py](file:///D:/Project/md-converter/app.py) & [converter.py](file:///D:/Project/md-converter/converter.py))

*   **API Bridge:** The [Api](file:///D:/Project/md-converter/app.py#L43) class is exposed to JavaScript as `window.pywebview.api`.
*   **Introspector Safety:** The webview reference on the API class is stored as `self._window` (prefixed with `_`). This prevents the `pywebview` introspector from recursively analyzing the window object and causing WebView2 to hang.
*   **Background Threads:** Conversions are run inside a python `threading.Thread(daemon=True)`. This keeps the API bridge thread free so the frontend remains completely responsive (with loading animations) during CPU-heavy conversions.
*   **Whisper Transcription:** Audio/video transcription uses OpenAI Whisper (`base` model, ~290 MB, downloaded on first use). The model is loaded once per conversion call with `fp16=False` (forces FP32 to avoid a warning on CPU-only machines), and chunks are transcribed sequentially — no thread pool or `signal` patching required.
*   **MarkItDown Configurations:** Uses `MarkItDown(enable_plugins=False)` as the engine inside [converter.py](file:///D:/Project/md-converter/converter.py). `enable_plugins=False` prevents third-party plugins from loading or making network calls. Audio transcription via MarkItDown is intentionally omitted because it defaults to Google's online speech API — audio/video is handled offline by [media_handlers.py](file:///D:/Project/md-converter/media_handlers.py) instead.
*   **Temp File Requirement:** Because MarkItDown requires a physical disk path to determine the converter engine type (e.g. `.docx`, `.xlsx`, `.pdf`), file contents are written to a secure, temporary file via `tempfile.mkstemp()`, parsed, and then instantly deleted in a `finally` block inside [convert_bytes](file:///D:/Project/md-converter/converter.py#L67).
*   **Offline Media Handlers:** Intercepts media files in [converter.py](file:///D:/Project/md-converter/converter.py) to route them to custom offline modules in [media_handlers.py](file:///D:/Project/md-converter/media_handlers.py):
    *   **Images (`.png`, `.jpg`, `.jpeg`):** Opens with `Pillow` and processes using `pytesseract` OCR to extract formatted layout blocks.
    *   **Audio/Video (`.mp3`, `.wav`, `.mp4`, `.mkv`):** Uses `ffmpeg` to downmix to single-channel 16kHz PCM WAV format, segments into 60-second chunks, then transcribes each chunk sequentially via OpenAI Whisper (`base` model). FFmpeg stderr is streamed to a `tempfile.TemporaryFile()` rather than buffered in RAM. The final transcript is assembled in chronological order with minute markers.

---

## 🎨 Unified Three-Column Workspace Layout

Instead of a multi-stage wizard, the UI uses a desktop-grade side-by-side workspace:

1.  **Left Column (Input File / Selection):**
    *   Shows a dashed drop zone for file selection or dropping when no file is selected.
    *   Displays a compact `selected-card` with `[filename] -> [.md]` preview badges once a file is selected.
    *   Resets selection automatically upon a successful conversion, or updates when a new file is dropped.
2.  **Middle Column (Conversion Control & Log History):**
    *   Contains the centered primary **Convert** button.
    *   Underneath the Convert button, displays a persistent **Log History** block showing a scrollable list of recent conversion runs.
    *   Conversion results (success/failure status and conversion times) are captured and saved.
    *   Clicking a successful history item reloads its markdown contents into the preview area. Clicking a failed item toasts the conversion error.
    *   Includes a "Clear" link to empty the log history.
3.  **Right Column (Output Preview):**
    *   Displays the toolbar and HTML preview container directly on startup (with Copy and Download buttons disabled initially).
    *   Loads metadata and renders the HTML preview in the output panel once a conversion is loaded or selected from history.
    *   Provides standard action buttons to Clear the active preview panel, Copy the raw markdown text in memory, or Download it as a `.md` file (in the order: `[Clear]`, `[Copy]`, `[Download .md]`).

---

## 💾 State & Log Persistence

*   **Logs Array:** Log history items are stored in a JavaScript array `logs` containing metadata. To prevent browser `localStorage` capacity limits (5MB) from being exceeded, raw markdown output text is omitted from the saved JSON string in `localStorage`.
*   **Disk Cache Integration:** Converted markdown files are saved locally to the user's home directory (`~/.md-converter/history/<id>.md`) using Python's [save_history_file](file:///D:/Project/md-converter/app.py#L107) API.
*   **Log Loading:** Clicking a history log invokes [read_history_file](file:///D:/Project/md-converter/app.py#L120) to load contents from the local cache file, updating the HTML preview viewer dynamically.
*   **LocalStorage Sync:** The history metadata list (filename, timestamp, success/error state, and file ID) is saved to the browser's database as `"md_converter_logs"`. It is loaded automatically on startup, preserving past entries across sessions.
*   **Cap Limits:** History is capped at `50` items. Old items are deleted from both the `localStorage` metadata list and the local disk cache directory automatically by invoking [delete_history_file](file:///D:/Project/md-converter/app.py#L133).

---

## 🛡️ Client-Side Security & XSS Prevention

*   **HTML Sanitization:** To block potential cross-site scripting (XSS) payloads injected into source documents, a custom renderer override is registered on `marked` (the HTML builder in [app.v4.js](file:///D:/Project/md-converter/frontend/app.v4.js)).
*   **Scheme Validation:** Links matching `javascript:`, `data:`, or `vbscript:` schemes are parsed and stripped into inert `<span>` wrappers rather than clickable anchors.
*   **Outbound Privacy Rules:** To prevent telemetry tracking, unauthorized server connections, or local file inclusion exploits via standard image markup, images are rendered visually as plain text descriptors (`[image: <description>]`) instead of active `<img>` nodes.
*   **Directory Traversal Prevention:** The file ID parameter passed to [save_history_file](file:///D:/Project/md-converter/app.py#L107), [read_history_file](file:///D:/Project/md-converter/app.py#L120), and [delete_history_file](file:///D:/Project/md-converter/app.py#L133) is validated on the backend. Only alphanumeric characters, dashes, and underscores are allowed (`safe_id = "".join(c for c in file_id if c.isalnum() or c in ("-", "_"))`), keeping the operations isolated to the designated history directory.

---

## 🧪 Verification & Testing

The converter engine features unit tests configured in [test_converter.py](file:///D:/Project/md-converter/tests/test_converter.py) to assert conversion safety constraints.

### Running Unit Tests
Test coverage can be verified by running the unit tests:
```bash
python -m unittest tests/test_converter.py
```

### Coverage Scope
*   **Plain Text Processing:** Validates that clean input formats convert with success statuses and exact content matching.
*   **Type Guard Verification:** Assures that attempting to convert unsupported types (e.g. `.exe`) raises an expected type failure.
*   **Empty Boundaries:** Asserts empty files fail gracefully with explicit empty indicators rather than causing downstream interpreter crashes.
*   **Offline OCR (Image Routing):** Verifies that processing image file types (.jpg, .jpeg, .png) triggers offline OCR routing, and gracefully returns formatted fallback dependency error descriptions if Tesseract is missing.
*   **Offline Audio/Video Transcription:** Verifies that processing audio/video file types (.mp3, .wav, .mp4, .mkv) triggers background transcription via pocketsphinx and ffmpeg, returning proper fallback screens on dependency error.
*   **Minute-by-Minute Transcription Chunking & Stitching:** Validates that audio/video files are downmixed, segmented, processed, and successfully stitched into a chronological markdown transcript complete with minute headers (e.g., `### Minute 1`).
*   **Direct Path Conversion:** Validates that files converted using the disk-path bridge (`convert_file_at_path`) successfully convert without copying to a temporary file.

---

## 🛠️ Packaging & Standalone Builds

Building is managed by [build.py](file:///D:/Project/md-converter/build.py) using PyInstaller to package the app into a single executable binary.

### How to Build
1. Make sure Python 3.10+ and requirements in [requirements.txt](file:///D:/Project/md-converter/requirements.txt) are installed.
2. Execute the script:
   ```bash
   pip install -r requirements.txt -r requirements-build.txt
   python build.py
   ```
3. Find your packaged binary inside the `dist/` directory.

### Build Implementation & Bundling Decisions
*   **Resource Resolution:** The `resource_path` function in [app.py](file:///D:/Project/md-converter/app.py#L37) handles resolving resource references correctly both in standard python execution and within PyInstaller's extracted bundle directory (`sys._MEIPASS`).
*   **Magika, MarkItDown & Whisper Assets:** Since `markitdown`, `magika`, `whisper`, and `pytesseract` rely on built-in binary models and configuration data that standard static analysis packages omit, we declare `--collect-all=magika`, `--collect-all=markitdown`, `--collect-all=whisper`, and `--collect-all=pytesseract` explicitly in PyInstaller arguments inside [build.py](file:///D:/Project/md-converter/build.py). `--hidden-import=tiktoken_ext.openai_public` is also declared for Whisper's BPE tokenizer data (missed by static analysis).
*   **Dynamic / Hidden Imports:** PyInstaller cannot automatically detect dependencies loaded dynamically at runtime based on file types. To prevent runtime crash errors during file conversion inside the packaged build, the following dependencies are explicitly collected:
    *   `pyperclip` (clipboard operations)
    *   `mammoth` (Word `.docx` format support)
    *   `openpyxl` & `xlrd` (Excel `.xlsx` and `.xls` formats)
    *   `olefile` (legacy compound file formats)
    *   `pdfminer` & `pdfplumber` (PDF document extraction)
    *   `pptx` (PowerPoint presentations)
    *   `PIL` (Pillow image processing library)

---

## 🛡️ Cache Bypassing

WebView2 stores aggressive browser caches for CSS/JS resources. To deploy style or script updates safely:
*   Modify layout code in [style.v2.css](file:///D:/Project/md-converter/frontend/style.v2.css) and scripting in [app.v5.js](file:///D:/Project/md-converter/frontend/app.v5.js).
*   Maintain the cache-busting filename structure (`style.vN.css` and `app.vN.js`) in [index.html](file:///D:/Project/md-converter/frontend/index.html) loader tags:
    ```html
    <link rel="stylesheet" href="style.v2.css" />
    <script src="app.v5.js"></script>
    ```

---

## ⌨️ Global Keyboard Shortcuts

| Shortcut | Context | Description |
| :--- | :--- | :--- |
| **`Escape`** | Selection active / Preview active | Clears the selected file card or resets the active markdown preview. |
| **`Ctrl / Cmd + Enter`** | File selected | Submits the file for conversion immediately. |
| **`Ctrl / Cmd + C`** | Markdown preview active | Copies the raw markdown contents to the clipboard (only when no text selection is active). |
