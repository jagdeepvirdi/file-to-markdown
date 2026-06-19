"use strict";

/* ---------------------------------------------------------------
   Elements
--------------------------------------------------------------- */
const dropZone  = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");
const extToggle = document.getElementById("extToggle");
const extList   = document.getElementById("extList");

const selectedCard  = document.getElementById("selectedCard");
const readyFilename = document.getElementById("readyFilename");

const convertBtn        = document.getElementById("convertBtn");
const convertBtnText    = document.getElementById("convertBtnText");
const convertSpinner    = document.getElementById("convertSpinner");

const logList           = document.getElementById("logList");
const clearLogsBtn      = document.getElementById("clearLogsBtn");

const resultContainer    = document.getElementById("resultContainer");
const resultFilename     = document.getElementById("resultFilename");
const resultMeta         = document.getElementById("resultMeta");
const previewView        = document.getElementById("previewView");

const clearBtn       = document.getElementById("clearBtn");
const copyBtn        = document.getElementById("copyBtn");
const downloadBtn    = document.getElementById("downloadBtn");
const toast          = document.getElementById("toast");

/* ---------------------------------------------------------------
   State Variables
--------------------------------------------------------------- */
let currentMarkdown  = "";
let currentBaseName  = "output";
let pendingFilename  = "";
let pendingFile      = null;   // File object held between selection and Convert click
let apiReady         = false;
let supportedExtensions = new Set();
let maxFileSizeBytes    = 80 * 1024 * 1024;
let isConverting        = false;

// Log history array
let logs = [];

// Initialize
try {
  const savedLogs = localStorage.getItem("md_converter_logs");
  if (savedLogs) {
    logs = JSON.parse(savedLogs);
  }
} catch (e) {
  logs = [];
}

// Active log item ID being viewed
let activeLogId = null;

// Render logs and clear preview state on load
renderLogs();
clearPreview();

/* ---------------------------------------------------------------
   Toast Notifications
--------------------------------------------------------------- */
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

// Global drag/drop: prevent navigation, allow dropping anytime if not converting.
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => {
  e.preventDefault();
  if (isConverting) return;
  const files = e.dataTransfer && e.dataTransfer.files;
  if (files && files[0]) handleFile(files[0]);
});

/* ---------------------------------------------------------------
   Keyboard shortcuts
--------------------------------------------------------------- */
document.addEventListener("keydown", (e) => {
  // Escape: clear selection or clear active preview
  if (e.key === "Escape") {
    if (pendingFile) {
      clearSelection();
    } else if (currentMarkdown) {
      clearPreview();
    }
    return;
  }
  // Ctrl/Cmd+Enter: trigger Convert when a file is selected
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && pendingFile && !isConverting) {
    convertBtn.click();
    return;
  }
  // Ctrl/Cmd+C: copy markdown when a preview is active and no text selection is active
  if ((e.ctrlKey || e.metaKey) && e.key === "c" && currentMarkdown) {
    if (!window.getSelection().toString()) {
      e.preventDefault();
      copyBtn.click();
    }
  }
});

/* ---------------------------------------------------------------
   File handling
--------------------------------------------------------------- */
function handleFile(file) {
  if (!apiReady) {
    showToast("Still starting up — try again in a moment");
    return;
  }

  // Client-side validation before touching the bridge
  const dotIdx = file.name.lastIndexOf(".");
  const ext = dotIdx !== -1 ? file.name.slice(dotIdx).toLowerCase() : "";
  if (supportedExtensions.size > 0 && !supportedExtensions.has(ext)) {
    showToast(`Unsupported file type '${ext || "unknown"}'.\n\nDrop a supported file to convert.`, 4000);
    return;
  }
  if (file.size > maxFileSizeBytes) {
    const limitMb = (maxFileSizeBytes / (1024 * 1024)).toFixed(0);
    const fileMb  = (file.size  / (1024 * 1024)).toFixed(1);
    showToast(`File is too large (${fileMb} MB). Limit is ${limitMb} MB.`, 4000);
    return;
  }

  // File is valid
  pendingFile = file;
  readyFilename.textContent = file.name;
  
  // Show selected file card, hide dropzone
  dropZone.hidden = true;
  selectedCard.hidden = false;
  
  // Enable convert button
  convertBtn.disabled = false;
}



function clearSelection() {
  fileInput.value = "";
  pendingFile = null;
  readyFilename.textContent = "";
  
  dropZone.hidden = false;
  selectedCard.hidden = true;
  
  convertBtn.disabled = true;
}

/* ---------------------------------------------------------------
   Conversion Flow
--------------------------------------------------------------- */
convertBtn.addEventListener("click", () => {
  if (pendingFile) startConversion(pendingFile);
});

function startConversion(file) {
  isConverting = true;
  pendingFilename = file.name;
  
  // Update button loading state
  convertBtn.disabled = true;
  convertBtnText.textContent = "Converting...";
  convertSpinner.hidden = false;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      window.pywebview.api.convert_file(file.name, reader.result);
    } catch (e) {
      onConversionError(String((e && e.message) || e));
    }
  };
  reader.onerror = () => onConversionError("Could not read the file from disk.");
  reader.readAsDataURL(file);
}

// Python posts the conversion result here via window.evaluate_js().
window.__onConvertResult = function (result) {
  isConverting = false;
  convertBtnText.textContent = "Convert";
  convertSpinner.hidden = true;
  
  if (pendingFile) {
    convertBtn.disabled = false;
  }

  if (result && result.success) {
    const logItem = {
      id: Date.now().toString(),
      filename: pendingFilename,
      success: true,
      markdown: result.markdown,
      title: result.title || pendingFilename,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    addLog(logItem);
    loadLogItem(logItem);
    clearSelection();
  } else {
    const errMsg = (result && result.error) || "Unknown error during conversion.";
    onConversionError(errMsg);
  }
};

function onConversionError(msg) {
  isConverting = false;
  convertBtnText.textContent = "Convert";
  convertSpinner.hidden = true;
  if (pendingFile) {
    convertBtn.disabled = false;
  }
  
  showToast(msg, 5000);
  
  const logItem = {
    id: Date.now().toString(),
    filename: pendingFilename,
    success: false,
    error: msg,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  };
  addLog(logItem);
}

/* ---------------------------------------------------------------
   Log History Management
--------------------------------------------------------------- */
function addLog(logItem) {
  logs.unshift(logItem);
  
  // Cap history at 50 entries to avoid localStorage overflow
  if (logs.length > 50) {
    logs.pop();
  }
  
  saveLogs();
  renderLogs();
}

function saveLogs() {
  try {
    localStorage.setItem("md_converter_logs", JSON.stringify(logs));
  } catch (e) {
    /* localStorage full - remove oldest entries and retry */
    if (logs.length > 5) {
      logs = logs.slice(0, logs.length - 5);
      saveLogs();
    }
  }
}

function renderLogs() {
  logList.innerHTML = "";
  if (logs.length === 0) {
    logList.innerHTML = `<div class="log-empty">No files converted yet.</div>`;
    return;
  }

  logs.forEach((item) => {
    const div = document.createElement("div");
    div.className = `log-item ${item.id === activeLogId ? "active" : ""}`;
    div.dataset.id = item.id;
    
    const icon = item.success ? "✓" : "✗";
    const iconClass = item.success ? "success" : "error";
    
    div.innerHTML = `
      <div class="log-item-info">
        <span class="log-item-icon ${iconClass}">${icon}</span>
        <span class="log-item-name" title="${item.filename}">${item.filename}</span>
      </div>
      <span class="log-item-time">${item.timestamp}</span>
    `;
    
    div.addEventListener("click", () => {
      if (item.success) {
        loadLogItem(item);
      } else {
        showToast(`Failed: ${item.error}`, 4000);
      }
    });
    
    logList.appendChild(div);
  });
}

function loadLogItem(item) {
  activeLogId = item.id;
  
  // Highlight active item
  document.querySelectorAll(".log-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.id === item.id);
  });
  
  renderResult(item.filename, item.markdown, item.title);
}

clearLogsBtn.addEventListener("click", () => {
  logs = [];
  saveLogs();
  renderLogs();
  clearPreview();
});

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

  previewView.innerHTML = renderMarkdownPreview(markdown);
  
  // Enable toolbar actions
  clearBtn.disabled = false;
  copyBtn.disabled = false;
  downloadBtn.disabled = false;
}

function clearPreview() {
  currentMarkdown = "";
  activeLogId = null;
  
  previewView.innerHTML = "";
  resultFilename.textContent = "";
  resultMeta.textContent = "";
  
  document.querySelectorAll(".log-item").forEach((el) => {
    el.classList.remove("active");
  });
  
  // Disable toolbar actions
  clearBtn.disabled = true;
  copyBtn.disabled = true;
  downloadBtn.disabled = true;
}

/* ---------------------------------------------------------------
   Toolbar Actions (Clear / Copy / Download)
--------------------------------------------------------------- */
clearBtn.addEventListener("click", clearPreview);

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
      } else if (res && res.cancelled) {
        /* user cancelled save dialog */
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
