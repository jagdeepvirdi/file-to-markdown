"""
app.py
------
Desktop entry point. Opens a native window via pywebview and exposes a
small Python API to the page's JavaScript through `window.pywebview.api`.

No web server, no internet access required to run.
"""

import base64
import json
import logging
import os
import sys
import threading

import webview
import pyperclip

from converter import convert_bytes, SUPPORTED_EXTENSIONS, MAX_FILE_SIZE_BYTES


# Write errors to ~/.md-converter/error.log so crashes are diagnosable
# in packaged builds where there is no visible console.
_log_dir = os.path.join(os.path.expanduser("~"), ".md-converter")
os.makedirs(_log_dir, exist_ok=True)
logging.basicConfig(
    filename=os.path.join(_log_dir, "error.log"),
    level=logging.ERROR,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger(__name__)


def resource_path(relative_path: str) -> str:
    """Resolve a path that works both in dev and inside a PyInstaller bundle."""
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, relative_path)


class Api:
    """Methods here are callable from JS as window.pywebview.api.<name>(...)"""

    def __init__(self):
        self._window = None  # prefixed with _ so pywebview's introspector skips it

    def get_supported_extensions(self):
        return sorted(SUPPORTED_EXTENSIONS.items())

    def get_max_file_size_mb(self):
        return MAX_FILE_SIZE_BYTES // (1024 * 1024)

    def convert_file(self, filename: str, base64_data: str) -> None:
        """Start conversion in a background thread; post result via evaluate_js.

        Returning immediately keeps the pywebview bridge thread free so the UI
        stays responsive during heavy conversions (large PDFs, etc.).
        The result arrives in JS through window.__onConvertResult().
        """
        def _run():
            try:
                raw = base64_data.split(",")[-1]
                data = base64.b64decode(raw)
            except Exception as e:
                log.error("base64 decode failed", exc_info=True)
                self._post_result({"success": False, "error": f"Could not read file data: {e}"})
                return
            result = convert_bytes(filename, data)
            self._post_result(result)

        threading.Thread(target=_run, daemon=True).start()

    def _post_result(self, result: dict):
        try:
            payload = json.dumps(result)
            self._window.evaluate_js(f"window.__onConvertResult({payload})")
        except Exception:
            log.error("evaluate_js failed posting conversion result", exc_info=True)

    def copy_to_clipboard(self, text: str) -> dict:
        try:
            pyperclip.copy(text)
            return {"success": True}
        except Exception as e:
            log.error("clipboard copy failed", exc_info=True)
            return {"success": False, "error": str(e)}

    def save_file(self, content: str, suggested_name: str) -> dict:
        try:
            result = self._window.create_file_dialog(
                webview.SAVE_DIALOG,
                save_filename=suggested_name,
                file_types=("Markdown Files (*.md)", "Text Files (*.txt)", "All files (*.*)"),
            )
            if not result:
                return {"success": False, "cancelled": True}
            path = result if isinstance(result, str) else result[0]
            with open(path, "w", encoding="utf-8") as f:
                f.write(content)
            return {"success": True, "path": path}
        except Exception as e:
            log.error("save_file failed", exc_info=True)
            return {"success": False, "error": str(e)}


def main():
    api = Api()
    window = webview.create_window(
        "File → Markdown",
        resource_path("frontend/index.html"),
        js_api=api,
        width=1000,
        height=740,
        min_size=(720, 560),
        resizable=True,
    )
    api._window = window
    webview.start()


if __name__ == "__main__":
    main()
