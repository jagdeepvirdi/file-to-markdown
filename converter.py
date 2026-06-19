"""
converter.py
------------
Thin, defensive wrapper around Microsoft's MarkItDown library
(https://github.com/microsoft/markitdown).

Design notes:
- MarkItDown needs a real file on disk (or a stream with a known
  extension) to pick the right converter, so incoming bytes are
  written to a temp file with the original extension, converted,
  then immediately deleted.
- No network calls, no LLM client is attached to MarkItDown, so this
  stays 100% local/offline. Two converters that *require* an LLM
  (image captioning, Bing SERP) are simply never invoked since we
  never pass an `llm_client`.
- enable_plugins=False keeps behavior deterministic (no 3rd-party
  MarkItDown plugins silently changing output).
"""

import os
import tempfile
from markitdown import MarkItDown

# Extension -> human readable label, used to build the UI's
# "what can I drop here" list and to validate files client + server side.
SUPPORTED_EXTENSIONS = {
    ".pdf": "PDF Document",
    ".docx": "Word Document",
    ".pptx": "PowerPoint Presentation",
    ".xlsx": "Excel Spreadsheet",
    ".xls": "Excel Spreadsheet (legacy)",
    ".csv": "CSV",
    ".json": "JSON",
    ".jsonl": "JSON Lines",
    ".txt": "Plain Text",
    ".text": "Plain Text",
    ".md": "Markdown",
    ".markdown": "Markdown",
    ".html": "HTML",
    ".htm": "HTML",
    ".epub": "EPUB eBook",
    ".ipynb": "Jupyter Notebook",
    ".msg": "Outlook Message",
    ".zip": "ZIP Archive (converts contents)",
    ".jpg": "Image (EXIF + embedded/OCR text if any)",
    ".jpeg": "Image (EXIF + embedded/OCR text if any)",
    ".png": "Image (EXIF + embedded/OCR text if any)",
}

# Audio (.wav/.mp3/.m4a) is intentionally left out of the default build:
# MarkItDown's audio converter needs the heavy `speechrecognition` +
# `pydub` stack and, by default, calls out to Google's free Web Speech
# API to transcribe -- i.e. it isn't fully offline. To enable it:
#   pip install markitdown[audio-transcription]
# and add the three extensions back to SUPPORTED_EXTENSIONS above.

# Hard ceiling so a huge file doesn't choke the JS<->Python bridge
# (everything is base64-encoded in transit, ~33% size overhead).
MAX_FILE_SIZE_BYTES = 80 * 1024 * 1024  # 80 MB

# A single shared instance is fine: MarkItDown is stateless per-call
# and we never register an llm_client, so nothing here ever leaves
# the machine.
_engine = MarkItDown(enable_plugins=False)


def is_supported(filename: str) -> bool:
    ext = os.path.splitext(filename)[1].lower()
    return ext in SUPPORTED_EXTENSIONS


def convert_bytes(filename: str, data: bytes) -> dict:
    """
    Convert raw file bytes to markdown.

    Returns a plain dict (not an object) so it serializes cleanly
    across the pywebview JS bridge:
      { "success": True,  "markdown": "...", "title": "..." }
      { "success": False, "error": "..." }
    """
    ext = os.path.splitext(filename)[1].lower()

    if ext not in SUPPORTED_EXTENSIONS:
        supported = ", ".join(sorted(SUPPORTED_EXTENSIONS))
        return {
            "success": False,
            "error": f"Unsupported file type '{ext or 'unknown'}'.\n\nSupported: {supported}",
        }

    if len(data) > MAX_FILE_SIZE_BYTES:
        mb = MAX_FILE_SIZE_BYTES // (1024 * 1024)
        return {
            "success": False,
            "error": f"File is too large ({len(data) / (1024*1024):.1f} MB). Limit is {mb} MB.",
        }

    if len(data) == 0:
        return {"success": False, "error": "File is empty."}

    tmp_path = None
    try:
        fd, tmp_path = tempfile.mkstemp(suffix=ext)
        with os.fdopen(fd, "wb") as f:
            f.write(data)

        result = _engine.convert(tmp_path)
        markdown = (result.text_content or "").strip()
        title = getattr(result, "title", None)

        if not markdown:
            return {
                "success": False,
                "error": "Conversion produced no text content. The file may be empty, "
                         "image-only without OCR-able text, or corrupted.",
            }

        return {"success": True, "markdown": markdown, "title": title}

    except Exception as e:
        return {"success": False, "error": f"{type(e).__name__}: {e}"}

    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass
