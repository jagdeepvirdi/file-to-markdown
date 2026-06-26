# Tasks

## [x] Add Tesseract OCR for Image Text Extraction

**Goal:** Enable the app to extract text from images (JPG, JPEG, PNG) via OCR, fully offline, and continue working as a standalone `.exe`.

**Background:**
MarkItDown's image handler without an `llm_client` only pulls EXIF metadata — it does not perform OCR. Real text extraction from images requires Tesseract (C++ binary) via the `pytesseract` Python wrapper.

---

### Subtasks

- [x] **`requirements.txt`** — Add `pytesseract>=0.3.10` and `Pillow>=10.0` as dependencies.
- [x] **`converter.py`** — For image extensions (`.jpg`, `.jpeg`, `.png`), intercept before calling MarkItDown and run `pytesseract.image_to_string()` instead. Wrap the OCR result in plain text. If Tesseract is not available (not installed / not in PATH), fall back gracefully and surface a clear error/installation instruction message to the user.
- [x] **`converter.py`** — Add PyInstaller bundle detection: if `sys._MEIPASS` is set (running as a packaged `.exe`), point `pytesseract.pytesseract.tesseract_cmd` to the bundled binary path (`<_MEIPASS>/tesseract/tesseract.exe` on Windows).
- [x] **`build.py`** — Add PyInstaller flags to bundle the Tesseract binary, its DLLs, and tessdata into the `.exe`:
  - `--collect-all=pytesseract` and `--hidden-import=PIL`
- [x] **`CLAUDE.md`** — Update the Architecture section and Key Constraints to document the Tesseract dependency and bundling approach.
- [x] **`tests/test_converter.py`** — Add unit tests for the OCR path: test with a simple synthetic image containing known text, and test the graceful fallback when Tesseract is absent.

---

### Notes

- Target tessdata language: **English only** for now. Multi-language can be added later.
- Preferred tessdata model: `eng.traineddata` fast model to keep `.exe` size manageable.
- Expected `.exe` size increase: **+50–80 MB** (Tesseract binary + DLLs + tessdata).
- End-user experience stays the same — no separate Tesseract install required.
- Only the developer running `build.py` needs Tesseract installed locally (as the bundle source).

## [x] Add Offline Audio & Video Transcription via FFmpeg and PocketSphinx

**Goal:** Enable the app to transcribe audio and video files (MP3, WAV, MP4, MKV) to text, fully offline, and run as a standalone `.exe`.

**Background:**
MarkItDown's audio transcription by default relies on Google's online cloud speech API. To support fully offline, privacy-focused transcription, media files must be converted, segmented, and decoded locally.

---

### Subtasks

- [x] **`requirements.txt`** — Add `pocketsphinx>=5.0.0` as a dependency.
- [x] **`converter.py`** — Identify and route audio/video extensions (`.mp3`, `.wav`, `.mp4`, `.mkv`) to the offline processor in `media_handlers.py`.
- [x] **`media_handlers.py`** — Write a robust pipeline that uses `ffmpeg` via Python subprocess to downmix/convert files to mono 16kHz PCM WAV format and segment them into 60-second chunks to make processing linear and memory-safe.
- [x] **`media_handlers.py`** — Use `pocketsphinx` offline model to transcribe individual chunks and stitch the output back together with minute markers (e.g. `### Minute 1`) and paragraph indentation for better legibility.
- [x] **`build.py`** — Include PocketSphinx assets and models wholesale in PyInstaller bundler configuration using `--collect-all=pocketsphinx`.
- [x] **`tests/test_converter.py`** — Write mock-based unit tests asserting that media chunking, processing, and chronological stitching function correctly under the test suite without calling actual system binaries.

## [ ] Fix Memory Handling for Large Audio/Video Files

**Goal:** Reduce peak RAM usage and eliminate session-level memory accumulation when processing large media files (e.g. 900 MB MP4).

**Background:**
Five distinct issues were identified by tracing the full memory lifecycle for a large file conversion. Two are significant; three are low-severity. No issue causes a crash today, but issues #1 and #3 will degrade performance noticeably for long files or repeated conversions in a single session.

---

### Issue #1 — PocketSphinx model loaded fresh per worker (Python, **High**)

**What happens:** Each `AudioFile(path)` call inside `_transcribe_one` loads the full PocketSphinx acoustic + language model (~150–250 MB). With `max_workers=4`, up to four models are alive simultaneously — a 600 MB–1 GB spike on top of base memory. Models are freed when each worker returns (CPython ref counting), but they are never shared or cached across workers, so the same model data is loaded and unloaded repeatedly for every chunk.

**Fix:**
- [x] **`media_handlers.py`** — Load the PocketSphinx decoder once per worker thread (not once per chunk) by restructuring the executor to use a `threading.local`-backed decoder cache or an initialiser function (`initializer=` arg on `ThreadPoolExecutor`). Each worker initialises its own decoder once on first use and reuses it for all chunks it processes.
- [x] **`media_handlers.py`** — Reduce default `max_workers` from 4 to 2 as a conservative default; document that lowering it trades speed for RAM (each worker holds ~200 MB of model data).

---

### Issue #2 — `results` dict and `transcript_parts` overlap with joined string during assembly (Python, **Low**)

**What happens:** After the executor finishes, `results` (all segment lists) and `transcript_parts` (all formatted chunk strings) are both in memory while `"\n\n".join(transcript_parts)` builds the final `md_text`. At that moment three representations of the same text coexist: raw segments, formatted parts, and the joined string. For typical sparse PocketSphinx output this is a few hundred KB total — low severity, but unnecessary.

**Fix:**
- [x] **`media_handlers.py`** — Add `del results` immediately after the assembly loop finishes consuming it, and `del transcript_parts` immediately after `md_text = "\n\n".join(transcript_parts)`. CPython's reference counting will free them before the function returns.

---

### Issue #3 — `logs[i].markdown` accumulates transcript text in JS heap for the session (JavaScript, **Medium**)

**What happens:** In `__onConvertResult`, `logItem.markdown = result.markdown` is set and `logs.unshift(logItem)` stores it. `saveLogs` strips markdown from localStorage, but the **in-memory `logs` array keeps `.markdown` alive permanently**. Every conversion during a session, and every history entry clicked by the user, adds its full text to the heap. For 10 large video transcripts in one session, this is 10× (transcript size) sitting in JS memory with no way to reclaim it while the app is open.

**Fix:**
- [x] **`frontend/app.v4.js`** — In `addLog`, after `save_history_file` succeeds, null out `logItem.markdown` (`logItem.markdown = null`). The text is already on disk and `currentMarkdown` holds the active copy.
- [x] **`frontend/app.v4.js`** — In `loadLogItem`, after `renderResult` is called (which sets `currentMarkdown`), null out `item.markdown` again so reopening a history entry doesn't permanently pin its text to the log entry. `currentMarkdown` is the single live copy; disk is the persistent store.

---

### Issue #4 — FFmpeg stderr buffered in Python RAM for the full conversion duration (Python, **Low**)

**What happens:** `subprocess.run(..., stderr=subprocess.PIPE)` accumulates all of FFmpeg's stderr output (frame stats, timing, progress lines) in a `bytes` object in Python memory for the entire duration of the FFmpeg run — several minutes for a 2-hour video. This can reach a few MB. On the success path the bytes are discarded unused; only on `CalledProcessError` are they decoded and shown.

**Fix:**
- [x] **`media_handlers.py`** — Capture stderr to a `tempfile.TemporaryFile()` instead of `subprocess.PIPE`. On success, close and discard the file. On `CalledProcessError`, seek to 0, read, and decode for the error message. This keeps stderr off the Python heap entirely during the subprocess run.

---

### Issue #5 — FileReader base64 string doubles memory for ≤80MB drag-and-drop files (JavaScript, **Low**)

**What happens:** `reader.readAsDataURL(file)` stores the base64 data URL in `reader.result` (~33% larger than the original). When passed to `convert_file`, the pywebview bridge serialises it as JSON — creating a second copy. Peak JS heap for an 80 MB file: ~214 MB simultaneously. GC timing for the reader closure is non-deterministic.

**Fix:**
- [x] **`frontend/app.v4.js`** — After calling `window.pywebview.api.convert_file(...)`, set `reader.onload = null` and allow the enclosing closure to go out of scope promptly. The base64 string itself is owned by the browser engine and cannot be nulled, but eliminating the closure reference allows the reader to become GC-eligible sooner.
- [ ] *(Longer term)* Consider chunked upload over the bridge for the base64 path, sending the data in segments rather than one large string. This would cap peak JS memory to one chunk at a time.

---

### Notes

- Issues #1 and #3 are the most impactful: #1 caps throughput on RAM-constrained machines; #3 grows unboundedly with session length.
- Issues #2, #4, and #5 are low-severity optimisations — worthwhile but not urgent.
- None of these issues cause crashes today; the 80 MB base64 cap and the path-bridge for larger files already prevent the most dangerous out-of-memory scenario.

