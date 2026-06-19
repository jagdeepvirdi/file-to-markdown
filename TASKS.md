# Task List: File → Markdown Converter Improvements

This checklist outlines the actionable tasks identified in the [code_review_report.md](file:///C:/Users/ASUS/.gemini/antigravity-cli/brain/9340a892-7afe-4dcd-b23f-ad7f2613d74a/code_review_report.md) to secure, clean up, and polish the codebase before uploading it to GitHub.

---

## 🟥 High Priority: Security & Integrity

- [x] **Fix XSS Vulnerability in Link Parser**
  * **File:** [`frontend/app.v2.js`](file:///D:/Project/md-converter/frontend/app.v2.js) inside the [`renderInline`](file:///D:/Project/md-converter/frontend/app.v2.js#L504-L516) function.
  * **Task:** Add URL scheme validation to the link regex replacement. Specifically, do not render links that start with `javascript:` or `data:`.
  * **Success Criteria:** Malicious links like `[RCE](javascript:...)` are safely rendered as text/invalid link wrappers instead of active anchor tags.

---

## 🟨 Medium Priority: State & Storage Reliability

- [x] **Refactor History Storage to Avoid `localStorage` Overflow**
  * **Files:** [`frontend/app.v2.js`](file:///D:/Project/md-converter/frontend/app.v2.js) (`addLog` and `saveLogs`) and [`app.py`](file:///D:/Project/md-converter/app.py).
  * **Task:** Instead of storing raw markdown text in the browser's `localStorage` (capped at 5MB), save the converted markdown outputs to the local disk cache (e.g. `~/.md-converter/history/`) via Python, and only store metadata + file IDs in `localStorage`. Create a Python-JS bridge method to fetch the content when requested.
  * **Success Criteria:** Conversions of large files do not crash the log history storage.

- [x] **Add Guard to `dropZone` Drag/Drop Listener**
  * **File:** [`frontend/app.v2.js`](file:///D:/Project/md-converter/frontend/app.v2.js) inside the `dropZone` drop event listener.
  * **Task:** Add `if (isConverting) return;` check at the beginning of the listener.
  * **Success Criteria:** Dragging a file during an active conversion does not overwrite the UI or pending state.

---

## 🟩 Low Priority: Code Cleanup & Professionalism

- [x] **Clean Up Dead Code in Converter Engine**
  * **File:** [`converter.py`](file:///D:/Project/md-converter/converter.py).
  * **Task:** Remove the unused [`is_supported`](file:///D:/Project/md-converter/converter.py#L67-L69) function.
  * **Success Criteria:** Codebase is free of dead/unused API functions.

- [x] **Add a Local Unit Test Suite**
  * **File:** Create a new file `tests/test_converter.py`.
  * **Task:** Write standard unit tests for `convert_bytes` to check conversions for empty files, unsupported extensions, plain text files, and HTML files.
  * **Success Criteria:** Running `python -m unittest tests/test_converter.py` executes successfully.

- [x] **Replace Custom Markdown Preview Parser with marked.js**
  * **Files:** [`frontend/index.html`](file:///D:/Project/md-converter/frontend/index.html) and [`frontend/app.v2.js`](file:///D:/Project/md-converter/frontend/app.v2.js).
  * **Task:** Replaced the regex-based preview parser with [marked](https://github.com/markedjs/marked) v18 UMD build, stored locally at `frontend/marked.umd.js`. Custom renderer preserves XSS-safe link handling (blocks `javascript:`, `data:`, `vbscript:` schemes) and renders images as text references.
  * **Success Criteria:** Rendered markdown blocks, nested code fences, and complex tables render perfectly without layout breaks.
