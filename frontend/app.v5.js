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

const progressWrap     = document.getElementById("progressWrap");
const progressLabel    = document.getElementById("progressLabel");
const progressBarFill  = document.getElementById("progressBarFill");

/* ---------------------------------------------------------------
   State Variables
--------------------------------------------------------------- */
let currentMarkdown  = "";
let currentBaseName  = "output";
let pendingFilename  = "";
let pendingFile      = null;   // File object held between selection and Convert click
let pendingFilePath  = "";     // File path on disk held for native conversions
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
   Progress bar (audio/video transcription only)
--------------------------------------------------------------- */
function resetProgress() {
  progressWrap.hidden = true;
  progressBarFill.classList.remove("indeterminate");
  progressBarFill.style.width = "0%";
  progressLabel.textContent = "";
}

// Called from Python via evaluate_js during audio/video transcription.
window.__onConvertProgress = function(data) {
  if (!data) return;
  progressWrap.hidden = false;

  if (data.stage === "preparing") {
    progressLabel.textContent = "Preparing audio…";
    progressBarFill.style.width = "0%";
    progressBarFill.classList.add("indeterminate");
  } else if (data.stage === "transcribing") {
    progressBarFill.classList.remove("indeterminate");
    const pct = data.total > 0 ? Math.round((data.completed / data.total) * 100) : 0;
    progressBarFill.style.width = pct + "%";
    progressLabel.textContent =
      `Transcribing: ${data.completed} / ${data.total} chunks (${pct}%)`;
  }
};

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
dropZone.addEventListener("click", async () => {
  if (isConverting) return;
  if (window.pywebview && window.pywebview.api) {
    try {
      const res = await window.pywebview.api.select_file_dialog();
      if (res && res.success) {
        handleNativeFile(res.path, res.name, res.size);
      } else if (res && res.error) {
        showToast("Error selecting file: " + res.error);
      }
    } catch (e) {
      fileInput.click();
    }
  } else {
    fileInput.click();
  }
});
dropZone.addEventListener("keydown", async (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    if (isConverting) return;
    if (window.pywebview && window.pywebview.api) {
      try {
        const res = await window.pywebview.api.select_file_dialog();
        if (res && res.success) {
          handleNativeFile(res.path, res.name, res.size);
        } else if (res && res.error) {
          showToast("Error selecting file: " + res.error);
        }
      } catch (e) {
        fileInput.click();
      }
    } else {
      fileInput.click();
    }
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
  if (isConverting) return;
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
    if (pendingFile || pendingFilePath) {
      clearSelection();
    } else if (currentMarkdown) {
      clearPreview();
    }
    return;
  }
  // Ctrl/Cmd+Enter: trigger Convert when a file is selected
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && (pendingFile || pendingFilePath) && !isConverting) {
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

  // Files sent via drag-and-drop or fileInput must be loaded into browser memory
  // and base64-encoded, which fails/hangs for huge files. We limit this to 80 MB.
  const MAX_BASE64_SIZE_BYTES = 80 * 1024 * 1024;
  if (file.size > MAX_BASE64_SIZE_BYTES) {
    showToast(`Files larger than 80 MB must be selected by clicking to browse (using the native picker).`, 5000);
    return;
  }

  // File is valid
  pendingFile = file;
  pendingFilePath = "";
  readyFilename.textContent = file.name;
  
  // Show selected file card, hide dropzone
  dropZone.hidden = true;
  selectedCard.hidden = false;
  
  // Enable convert button
  convertBtn.disabled = false;
}

function handleNativeFile(path, name, size) {
  if (!apiReady) {
    showToast("Still starting up — try again in a moment");
    return;
  }

  // Client-side validation before touching the bridge
  const dotIdx = name.lastIndexOf(".");
  const ext = dotIdx !== -1 ? name.slice(dotIdx).toLowerCase() : "";
  if (supportedExtensions.size > 0 && !supportedExtensions.has(ext)) {
    showToast(`Unsupported file type '${ext || "unknown"}'.\n\nDrop a supported file to convert.`, 4000);
    return;
  }
  if (size > maxFileSizeBytes) {
    const limitMb = (maxFileSizeBytes / (1024 * 1024)).toFixed(0);
    const fileMb  = (size  / (1024 * 1024)).toFixed(1);
    showToast(`File is too large (${fileMb} MB). Limit is ${limitMb} MB.`, 4000);
    return;
  }

  // File is valid
  pendingFile = null;
  pendingFilePath = path;
  readyFilename.textContent = name;
  
  // Show selected file card, hide dropzone
  dropZone.hidden = true;
  selectedCard.hidden = false;
  
  // Enable convert button
  convertBtn.disabled = false;
}

function clearSelection() {
  fileInput.value = "";
  pendingFile = null;
  pendingFilePath = "";
  readyFilename.textContent = "";
  
  dropZone.hidden = false;
  selectedCard.hidden = true;
  
  convertBtn.disabled = true;
}

/* ---------------------------------------------------------------
   Conversion Flow
--------------------------------------------------------------- */
convertBtn.addEventListener("click", () => {
  if (pendingFilePath) {
    startConversionPath(pendingFilePath, readyFilename.textContent);
  } else if (pendingFile) {
    startConversion(pendingFile);
  }
});

function startConversionPath(path, filename) {
  isConverting = true;
  pendingFilename = filename;

  convertBtn.disabled = true;
  convertBtnText.textContent = "Converting...";
  convertSpinner.hidden = false;
  resetProgress();

  try {
    window.pywebview.api.convert_file_path(path);
  } catch (e) {
    onConversionError(String((e && e.message) || e));
  }
}

// Maximum raw bytes per chunk sent over the bridge.
// 4 MB raw → ~5.3 MB base64; only one chunk lives in JS memory at a time.
const CHUNK_BYTES = 4 * 1024 * 1024;

async function startConversion(file) {
  isConverting = true;
  pendingFilename = file.name;

  convertBtn.disabled = true;
  convertBtnText.textContent = "Converting...";
  convertSpinner.hidden = false;
  resetProgress();

  const uploadId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_BYTES));

  try {
    for (let i = 0; i < totalChunks; i++) {
      const slice = file.slice(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES);
      const b64 = await readSliceAsBase64(slice);
      const res = await window.pywebview.api.send_chunk(uploadId, b64);
      if (!res || !res.success) {
        throw new Error(res?.error || "Chunk upload failed");
      }
    }
    window.pywebview.api.convert_file_chunked(uploadId, file.name);
  } catch (e) {
    onConversionError(String((e && e.message) || e));
  }
}

function readSliceAsBase64(slice) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const b64 = reader.result.split(",")[1] || "";
      reader.onload = null;
      resolve(b64);
    };
    reader.onerror = () => reject(new Error("Could not read file chunk from disk."));
    reader.readAsDataURL(slice);
  });
}

// Python posts the conversion result here via window.evaluate_js().
window.__onConvertResult = async function (result) {
  isConverting = false;
  convertBtnText.textContent = "Convert";
  convertSpinner.hidden = true;
  resetProgress();

  if (pendingFile || pendingFilePath) {
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
    await addLog(logItem);
    await loadLogItem(logItem);
    clearSelection();
  } else {
    const errMsg = (result && result.error) || "Unknown error during conversion.";
    await onConversionError(errMsg);
  }
};

async function onConversionError(msg) {
  isConverting = false;
  convertBtnText.textContent = "Convert";
  convertSpinner.hidden = true;
  resetProgress();
  if (pendingFile || pendingFilePath) {
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
  await addLog(logItem);
}

/* ---------------------------------------------------------------
   Log History Management
--------------------------------------------------------------- */
async function addLog(logItem) {
  if (logItem.success && logItem.markdown) {
    try {
      if (window.pywebview && window.pywebview.api) {
        await window.pywebview.api.save_history_file(logItem.id, logItem.markdown);
        logItem.markdown = null; // disk is the store; don't pin transcript text in the logs array
      }
    } catch (e) {
      console.error("Failed to save log to disk cache", e);
    }
  }

  logs.unshift(logItem);
  
  // Cap history at 50 entries to avoid localStorage overflow
  if (logs.length > 50) {
    const popped = logs.pop();
    if (popped && popped.success) {
      try {
        if (window.pywebview && window.pywebview.api) {
          await window.pywebview.api.delete_history_file(popped.id);
        }
      } catch (e) {
        console.error("Failed to delete old log from disk", e);
      }
    }
  }
  
  saveLogs();
  renderLogs();
}

function saveLogs() {
  try {
    // Strip markdown content when writing to localStorage to prevent 5MB limit overflow
    const strippedLogs = logs.map(item => {
      const copy = { ...item };
      if (copy.success) {
        delete copy.markdown;
      }
      return copy;
    });
    localStorage.setItem("md_converter_logs", JSON.stringify(strippedLogs));
  } catch (e) {
    /* localStorage full - remove oldest entries and retry */
    if (logs.length > 5) {
      const popped = logs.slice(logs.length - 5);
      popped.forEach(item => {
        if (item.success) {
          try {
            if (window.pywebview && window.pywebview.api) {
              window.pywebview.api.delete_history_file(item.id);
            }
          } catch (e) {}
        }
      });
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
    
    const escapedFilename = escapeHtml(item.filename);
    div.innerHTML = `
      <div class="log-item-info">
        <span class="log-item-icon ${iconClass}">${icon}</span>
        <span class="log-item-name" title="${escapedFilename}">${escapedFilename}</span>
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

async function loadLogItem(item) {
  activeLogId = item.id;
  
  // Highlight active item
  document.querySelectorAll(".log-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.id === item.id);
  });
  
  if (item.success) {
    if (!item.markdown) {
      try {
        if (window.pywebview && window.pywebview.api) {
          const res = await window.pywebview.api.read_history_file(item.id);
          if (res && res.success) {
            item.markdown = res.content;
          } else {
            showToast("Couldn't read log history from disk.");
            return;
          }
        }
      } catch (e) {
        showToast("Error loading log history.");
        return;
      }
    }
    renderResult(item.filename, item.markdown, item.title);
    item.markdown = null; // currentMarkdown is the single live copy; disk is the persistent store
  }
}

clearLogsBtn.addEventListener("click", async () => {
  logs = [];
  try {
    if (window.pywebview && window.pywebview.api) {
      await window.pywebview.api.clear_history_files();
    }
  } catch (e) {}
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

  previewView.innerHTML = marked.parse(markdown);
  
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
   Markdown -> HTML preview renderer (marked.js v18, bundled locally)
--------------------------------------------------------------- */
function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

marked.use({
  renderer: {
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      const cleanHref = (href || "").replace(/[\s\x00-\x1F\x7F-\x9F\u200B-\u200D\uFEFF]/g, "");
      if (/^(javascript|data|vbscript):/i.test(cleanHref)) {
        return `<span>${text}</span>`;
      }
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
      return `<a href="${escapeHtml(cleanHref)}"${titleAttr} target="_blank" rel="noopener">${text}</a>`;
    },
    image({ text }) {
      return text ? `<span class="img-ref">[image: ${escapeHtml(text)}]</span>` : "";
    },
  },
});
