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

