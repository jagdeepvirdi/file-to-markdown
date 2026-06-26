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

from converter import convert_bytes, convert_file_at_path, SUPPORTED_EXTENSIONS, MAX_FILE_SIZE_BYTES


# Write errors to ~/.md-converter/error.log so crashes are diagnosable
# in packaged builds where there is no visible console.
_log_dir = os.path.join(os.path.expanduser("~"), ".md-converter")
os.makedirs(_log_dir, exist_ok=True)
_history_dir = os.path.join(_log_dir, "history")
os.makedirs(_history_dir, exist_ok=True)
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

    def select_file_dialog(self) -> dict:
        try:
            # Build file types list from SUPPORTED_EXTENSIONS
            # e.g., "Supported Files (*.pdf;*.docx;...)"
            ext_list = ";*".join(SUPPORTED_EXTENSIONS.keys())
            file_types = (
                f"Supported Files (*{ext_list})",
                "All Files (*.*)"
            )
            result = self._window.create_file_dialog(
                webview.FileDialog.OPEN,
                allow_multiple=False,
                file_types=file_types
            )
            if not result:
                return {"success": False, "cancelled": True}
            path = result if isinstance(result, str) else result[0]
            # Get file size and name to return to frontend
            size = os.path.getsize(path)
            name = os.path.basename(path)
            return {"success": True, "path": path, "name": name, "size": size}
        except Exception as e:
            log.error("select_file_dialog failed", exc_info=True)
            return {"success": False, "error": str(e)}

    def convert_file_path(self, file_path: str) -> None:
        """Start conversion of a file on disk in a background thread.

        The result arrives in JS through window.__onConvertResult().
        Progress (for audio/video) arrives through window.__onConvertProgress().
        """
        def _progress(stage, completed, total):
            self._post_progress(stage, completed, total)

        def _run():
            try:
                result = convert_file_at_path(file_path, progress_callback=_progress)
            except Exception as e:
                log.error("convert_file_path failed", exc_info=True)
                result = {"success": False, "error": f"Failed to read file path: {e}"}
            self._post_result(result)

        threading.Thread(target=_run, daemon=True).start()

    def convert_file(self, filename: str, base64_data: str) -> None:
        """Start conversion in a background thread; post result via evaluate_js.

        Returning immediately keeps the pywebview bridge thread free so the UI
        stays responsive during heavy conversions (large PDFs, etc.).
        The result arrives in JS through window.__onConvertResult().
        Progress (for audio/video) arrives through window.__onConvertProgress().
        """
        def _progress(stage, completed, total):
            self._post_progress(stage, completed, total)

        def _run():
            try:
                raw = base64_data.split(",")[-1]
                data = base64.b64decode(raw)
            except Exception as e:
                log.error("base64 decode failed", exc_info=True)
                self._post_result({"success": False, "error": f"Could not read file data: {e}"})
                return
            result = convert_bytes(filename, data, progress_callback=_progress)
            self._post_result(result)

        threading.Thread(target=_run, daemon=True).start()

    def _post_result(self, result: dict):
        try:
            payload = json.dumps(result)
            self._window.evaluate_js(f"window.__onConvertResult({payload})")
        except Exception:
            log.error("evaluate_js failed posting conversion result", exc_info=True)

    def _post_progress(self, stage: str, completed: int, total: int):
        try:
            payload = json.dumps({"stage": stage, "completed": completed, "total": total})
            self._window.evaluate_js(f"window.__onConvertProgress({payload})")
        except Exception:
            pass

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

    def save_history_file(self, file_id: str, content: str) -> dict:
        try:
            safe_id = "".join(c for c in file_id if c.isalnum() or c in ("-", "_"))
            if not safe_id:
                return {"success": False, "error": "Invalid ID"}
            path = os.path.join(_history_dir, f"{safe_id}.md")
            with open(path, "w", encoding="utf-8") as f:
                f.write(content)
            return {"success": True}
        except Exception as e:
            log.error(f"save_history_file failed for {file_id}", exc_info=True)
            return {"success": False, "error": str(e)}

    def read_history_file(self, file_id: str) -> dict:
        try:
            safe_id = "".join(c for c in file_id if c.isalnum() or c in ("-", "_"))
            path = os.path.join(_history_dir, f"{safe_id}.md")
            if not os.path.exists(path):
                return {"success": False, "error": "History file not found"}
            with open(path, "r", encoding="utf-8") as f:
                content = f.read()
            return {"success": True, "content": content}
        except Exception as e:
            log.error(f"read_history_file failed for {file_id}", exc_info=True)
            return {"success": False, "error": str(e)}

    def delete_history_file(self, file_id: str) -> dict:
        try:
            safe_id = "".join(c for c in file_id if c.isalnum() or c in ("-", "_"))
            path = os.path.join(_history_dir, f"{safe_id}.md")
            if os.path.exists(path):
                os.remove(path)
            return {"success": True}
        except Exception as e:
            log.error(f"delete_history_file failed for {file_id}", exc_info=True)
            return {"success": False, "error": str(e)}

    def clear_history_files(self) -> dict:
        try:
            for name in os.listdir(_history_dir):
                path = os.path.join(_history_dir, name)
                if os.path.isfile(path):
                    os.remove(path)
            return {"success": True}
        except Exception as e:
            log.error("clear_history_files failed", exc_info=True)
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
