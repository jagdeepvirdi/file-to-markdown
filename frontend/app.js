"use strict";

/* ---------------------------------------------------------------
   Elements
--------------------------------------------------------------- */
const dropStage    = document.getElementById("dropStage");
const readyStage   = document.getElementById("readyStage");
const loadingStage = document.getElementById("loadingStage");
const errorStage   = document.getElementById("errorStage");
const resultStage  = document.getElementById("resultStage");

const dropZone  = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");
const extToggle = document.getElementById("extToggle");
const extList   = document.getElementById("extList");

const readyError        = document.getElementById("readyError");
const readyErrorMessage = document.getElementById("readyErrorMessage");
const readyFilename     = document.getElementById("readyFilename");
const convertBtn        = document.getElementById("convertBtn");
const readyCancelBtn    = document.getElementById("readyCancelBtn");

const errorMessage = document.getElementById("errorMessage");

const resultFilename = document.getElementById("resultFilename");
const resultMeta     = document.getElementById("resultMeta");
const rawCode        = document.getElementById("rawCode");
const rawView        = document.getElementById("rawView");
const previewView    = document.getElementById("previewView");
const copyBtn        = document.getElementById("copyBtn");
const clearBtn       = document.getElementById("clearBtn");
const downloadBtn    = document.getElementById("downloadBtn");
const newFileBtn     = document.getElementById("newFileBtn");
const viewTabs       = document.querySelectorAll(".viewtab");
const toast          = document.getElementById("toast");

let currentMarkdown  = "";
let currentBaseName  = "output";
let pendingFilename  = "";
let pendingFile      = null;   // File object held between selection and Convert click
let apiReady         = false;
let supportedExtensions = new Set();
let maxFileSizeBytes    = 80 * 1024 * 1024;

// Always start clean on the drop zone regardless of WebView2 session state.
showStage(dropStage);
readyError.hidden = true;
readyErrorMessage.textContent = "";

/* ---------------------------------------------------------------
   State machine
--------------------------------------------------------------- */
function showStage(stage) {
  [dropStage, readyStage, loadingStage, errorStage, resultStage].forEach((s) => {
    s.hidden = s !== stage;
  });
}

function showToast(msg, ms = 2200) {
  toast.textContent = msg;
  toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => (toast.hidden = true), ms);
}

/* ---------------------------------------------------------------
   pywebview bridge readiness
--------------------------------------------------------------- */
window.addEventListener("pywebviewready", () => {
  apiReady = true;
  loadSupportedExtensions();
});

setTimeout(() => {
  if (!apiReady && window.pywebview && window.pywebview.api) {
    apiReady = true;
    loadSupportedExtensions();
  }
}, 300);

async function loadSupportedExtensions() {
  if (!(window.pywebview && window.pywebview.api)) return;
  try {
    const [pairs, maxMb] = await Promise.all([
      window.pywebview.api.get_supported_extensions(),
      window.pywebview.api.get_max_file_size_mb(),
    ]);
    supportedExtensions = new Set(pairs.map(([ext]) => ext));
    maxFileSizeBytes = maxMb * 1024 * 1024;
    extList.innerHTML = "";
    pairs.forEach(([ext, label]) => {
      const chip = document.createElement("span");
      chip.className = "ext-chip";
      chip.title = label;
      chip.textContent = ext;
      extList.appendChild(chip);
    });
  } catch (e) {
    /* non-fatal */
  }
}

extToggle.addEventListener("click", () => {
  const expanded = extToggle.getAttribute("aria-expanded") === "true";
  extToggle.setAttribute("aria-expanded", String(!expanded));
  extList.hidden = expanded;
  extToggle.textContent = expanded ? "Show supported file types" : "Hide supported file types";
});

/* ---------------------------------------------------------------
   File selection (click + drag/drop)
--------------------------------------------------------------- */
dropZone.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fileInput.click();
  }
});

fileInput.addEventListener("change", () => {
  if (fileInput.files && fileInput.files[0]) {
    handleFile(fileInput.files[0]);
  }
});

["dragenter", "dragover"].forEach((evt) =>
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add("dragover");
  })
);

["dragleave", "drop"].forEach((evt) =>
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove("dragover");
  })
);

dropZone.addEventListener("drop", (e) => {
  const files = e.dataTransfer && e.dataTransfer.files;
  if (files && files[0]) handleFile(files[0]);
});

// Global drag/drop: prevent navigation, allow dropping on any stage except loading.
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => {
  e.preventDefault();
  if (!loadingStage.hidden) return;
  const files = e.dataTransfer && e.dataTransfer.files;
  if (files && files[0]) handleFile(files[0]);
});

/* ---------------------------------------------------------------
   Keyboard shortcuts
--------------------------------------------------------------- */
document.addEventListener("keydown", (e) => {
  // Escape: return to drop zone from ready, error, or result
  if (e.key === "Escape" &&
      (!readyStage.hidden || !errorStage.hidden || !resultStage.hidden)) {
    resetToDropZone();
    return;
  }
  // Ctrl/Cmd+Enter: trigger Convert when on the ready stage
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !readyStage.hidden) {
    convertBtn.click();
    return;
  }
  // Ctrl/Cmd+C: copy markdown when on result stage with no text selected
  if ((e.ctrlKey || e.metaKey) && e.key === "c" && !resultStage.hidden) {
    if (!window.getSelection().toString()) {
      e.preventDefault();
      copyBtn.click();
    }
  }
});

/* ---------------------------------------------------------------
   File handling — two-step: select → ready stage → convert
--------------------------------------------------------------- */
function handleFile(file) {
  if (!apiReady) {
    showToast("Still starting up — try again in a moment");
    return;
  }

  // Instant client-side validation before touching the bridge
  const dotIdx = file.name.lastIndexOf(".");
  const ext = dotIdx !== -1 ? file.name.slice(dotIdx).toLowerCase() : "";
  if (supportedExtensions.size > 0 && !supportedExtensions.has(ext)) {
    renderError(`Unsupported file type '${ext || "unknown"}'.\n\nDrop a supported file to convert.`);
    return;
  }
  if (file.size > maxFileSizeBytes) {
    const limitMb = (maxFileSizeBytes / (1024 * 1024)).toFixed(0);
    const fileMb  = (file.size  / (1024 * 1024)).toFixed(1);
    renderError(`File is too large (${fileMb} MB). Limit is ${limitMb} MB.`);
    return;
  }

  // File looks good — show the ready stage for user confirmation
  pendingFile = file;
  readyFilename.textContent = file.name;
  readyError.hidden = true;
  readyErrorMessage.textContent = "";
  showStage(readyStage);
}

convertBtn.addEventListener("click", () => {
  if (pendingFile) startConversion(pendingFile);
});

function startConversion(file) {
  pendingFilename = file.name;
  showStage(loadingStage);

  const reader = new FileReader();
  reader.onload = () => {
    try {
      // Fire-and-forget: result arrives via window.__onConvertResult
      window.pywebview.api.convert_file(file.name, reader.result);
    } catch (e) {
      renderError(String((e && e.message) || e));
    }
  };
  reader.onerror = () => renderError("Could not read the file from disk.");
  reader.readAsDataURL(file);
}

// Python posts the conversion result here via window.evaluate_js().
window.__onConvertResult = function (result) {
  if (result && result.success) {
    renderResult(pendingFilename, result.markdown, result.title);
  } else {
    // Show error above the file caption on the ready stage so the user can retry
    readyErrorMessage.textContent = (result && result.error) || "Unknown error during conversion.";
    readyError.hidden = false;
    showStage(readyStage);
  }
};

function renderError(message) {
  errorMessage.textContent = message;
  showStage(errorStage);
}

readyCancelBtn.addEventListener("click", resetToDropZone);
newFileBtn.addEventListener("click", resetToDropZone);
clearBtn.addEventListener("click", resetToDropZone);

function resetToDropZone() {
  fileInput.value       = "";
  currentMarkdown       = "";
  pendingFile           = null;
  rawCode.textContent   = "";
  previewView.innerHTML = "";
  errorMessage.textContent = "";
  readyError.hidden = true;
  readyErrorMessage.textContent = "";
  readyFilename.textContent = "";
  extToggle.setAttribute("aria-expanded", "false");
  extToggle.textContent = "Show supported file types";
  extList.hidden = true;
  showStage(dropStage);
}

/* ---------------------------------------------------------------
   Result rendering
--------------------------------------------------------------- */
function renderResult(filename, markdown, title) {
  currentMarkdown = markdown;
  currentBaseName = filename.replace(/\.[^/.]+$/, "") || "output";

  resultFilename.textContent = title || filename;
  if (title) resultFilename.title = filename;

  const words = markdown.trim().split(/\s+/).filter(Boolean).length;
  resultMeta.textContent = `${markdown.length.toLocaleString()} chars · ~${words.toLocaleString()} words`;

  rawCode.textContent   = markdown;
  previewView.innerHTML = renderMarkdownPreview(markdown);

  setView("raw");
  showStage(resultStage);
}

function setView(view) {
  viewTabs.forEach((t) => t.classList.toggle("active", t.dataset.view === view));
  rawView.hidden     = view !== "raw";
  previewView.hidden = view !== "preview";
}

viewTabs.forEach((tab) =>
  tab.addEventListener("click", () => setView(tab.dataset.view))
);

/* ---------------------------------------------------------------
   Copy / Download
--------------------------------------------------------------- */
copyBtn.addEventListener("click", async () => {
  if (!currentMarkdown) return;
  try {
    let ok = false;
    if (window.pywebview && window.pywebview.api) {
      const res = await window.pywebview.api.copy_to_clipboard(currentMarkdown);
      ok = res && res.success;
    }
    if (!ok && navigator.clipboard) {
      await navigator.clipboard.writeText(currentMarkdown);
      ok = true;
    }
    if (ok) {
      copyBtn.textContent = "Copied ✓";
      copyBtn.classList.add("copied");
      setTimeout(() => {
        copyBtn.textContent = "Copy";
        copyBtn.classList.remove("copied");
      }, 1400);
    } else {
      showToast("Couldn't copy to clipboard");
    }
  } catch (e) {
    showToast("Couldn't copy to clipboard");
  }
});

downloadBtn.addEventListener("click", async () => {
  if (!currentMarkdown) return;
  const suggested = `${currentBaseName}.md`;
  try {
    if (window.pywebview && window.pywebview.api) {
      const res = await window.pywebview.api.save_file(currentMarkdown, suggested);
      if (res && res.success) {
        showToast(`Saved to ${res.path}`);
        resetToDropZone();
      } else if (res && res.cancelled) {
        /* user cancelled the save dialog — stay on result */
      } else {
        showToast((res && res.error) || "Couldn't save file");
      }
    } else {
      const blob = new Blob([currentMarkdown], { type: "text/markdown" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = suggested;
      a.click();
      URL.revokeObjectURL(url);
    }
  } catch (e) {
    showToast("Couldn't save file");
  }
});

/* ---------------------------------------------------------------
   Markdown -> HTML preview renderer
--------------------------------------------------------------- */
function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderInline(text) {
  let t = escapeHtml(text);
  t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
  t = t.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt) =>
    alt ? `<span class="img-ref">[image: ${alt}]</span>` : ""
  );
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  t = t.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  t = t.replace(/(?<!_)_([^_]+)_(?!_)/g, "<em>$1</em>");
  return t;
}

function renderMarkdownPreview(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  let html = "";
  let i = 0;
  let inCodeBlock = false;
  let codeBuffer  = [];
  let listStack   = [];
  let tableBuffer = [];

  function closeLists() {
    while (listStack.length) html += `</${listStack.pop()}>`;
  }

  function flushTable() {
    if (!tableBuffer.length) return;
    const rows = tableBuffer.filter((r) => !/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(r));
    if (!rows.length) { tableBuffer = []; return; }
    const parseRow = (r) => r.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    const header = parseRow(rows[0]);
    const body   = rows.slice(1).map(parseRow);
    html += "<table><thead><tr>";
    header.forEach((c) => (html += `<th>${renderInline(c)}</th>`));
    html += "</tr></thead><tbody>";
    body.forEach((r) => {
      html += "<tr>";
      r.forEach((c) => (html += `<td>${renderInline(c)}</td>`));
      html += "</tr>";
    });
    html += "</tbody></table>";
    tableBuffer = [];
  }

  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      if (!inCodeBlock) {
        closeLists();
        inCodeBlock = true;
        codeBuffer  = [];
      } else {
        html += `<pre><code>${escapeHtml(codeBuffer.join("\n"))}</code></pre>`;
        inCodeBlock = false;
      }
      i++;
      continue;
    }
    if (inCodeBlock) { codeBuffer.push(line); i++; continue; }

    if (/^\s*\|.*\|\s*$/.test(line) && lines[i + 1] && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      closeLists();
      tableBuffer = [line, lines[i + 1]];
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        tableBuffer.push(lines[i]);
        i++;
      }
      flushTable();
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      closeLists();
      html += `<h${h[1].length}>${renderInline(h[2])}</h${h[1].length}>`;
      i++;
      continue;
    }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      closeLists();
      html += "<hr>";
      i++;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      closeLists();
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      html += `<blockquote>${renderInline(buf.join(" "))}</blockquote>`;
      continue;
    }

    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ul) {
      if (listStack[listStack.length - 1] !== "ul") { closeLists(); listStack.push("ul"); html += "<ul>"; }
      html += `<li>${renderInline(ul[1])}</li>`;
      i++;
      continue;
    }

    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ol) {
      if (listStack[listStack.length - 1] !== "ol") { closeLists(); listStack.push("ol"); html += "<ol>"; }
      html += `<li>${renderInline(ol[1])}</li>`;
      i++;
      continue;
    }

    if (/^\s*$/.test(line)) { closeLists(); i++; continue; }

    closeLists();
    const buf = [line];
    i++;
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !/^#{1,6}\s/.test(lines[i]) &&
      !/^```/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    html += `<p>${renderInline(buf.join(" "))}</p>`;
  }

  closeLists();
  flushTable();
  return html;
}
