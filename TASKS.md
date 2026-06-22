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
