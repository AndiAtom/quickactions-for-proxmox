/**
 * popup.js — Popup-Logik
 *
 * Rendert die Ressourcen-Liste im Flyout, behandelt Button-Klicks
 * und schickt Messages an den Service Worker (background.js).
 *
 * Spezifikation: AI-HELPER.md — Popup-Layout, Quick-Actions
 *
 * UX-Entscheidungen (mit Andi abgestimmt):
 *   - Backup per Checkbox-Auswahl (nicht alle Gäste auf einmal)
 *   - Alle Aktionen mit Confirm-Dialog (Shutdown/Reboot/Start/Snapshot/Backup)
 */

// --- DOM References ---
const elLoading = document.getElementById("loading");
const elError = document.getElementById("error");
const elList = document.getElementById("resource-list");
const elStatus = document.getElementById("status-indicator");
const elRefresh = document.getElementById("refresh-btn");
const elBackup = document.getElementById("backup-btn");

// --- State ---
let currentResources = [];

// --- Helpers ---

/**
 * Schickt eine Message an den Service Worker und gibt das Ergebnis zurück.
 * @param {Object} message
 * @returns {Promise<Object>} - { success: boolean, data?: any, error?: string }
 */
function sendMessage(message) {
  return browser.runtime.sendMessage(message);
}

// --- Confirm-Overlay (ersetzt window.confirm — nativer Dialog sprengt das Popup) ---

const elConfirmOverlay = document.getElementById("confirm-overlay");
const elConfirmMessage = document.getElementById("confirm-message");
const elConfirmOk = document.getElementById("confirm-ok");
const elConfirmCancel = document.getElementById("confirm-cancel");

/**
 * Zeigt einen Bestätigungsdialog als Overlay im Popup.
 * @param {string} title - Aktion, z.B. "Shutdown", "Backup"
 * @param {string} [detail] - Zusatzinfo (Gästename, Snapshot-Name, Gäste-Liste)
 * @returns {Promise<boolean>} - true wenn bestätigt
 */
function confirmAction(title, detail) {
  return new Promise((resolve) => {
    elConfirmMessage.textContent = detail
      ? `${title}: ${detail}`
      : title;

    elConfirmOverlay.classList.remove("hidden");

    const cleanup = (result) => {
      elConfirmOverlay.classList.add("hidden");
      elConfirmOk.removeEventListener("click", onOk);
      elConfirmCancel.removeEventListener("click", onCancel);
      resolve(result);
    };
    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);

    elConfirmOk.addEventListener("click", onOk);
    elConfirmCancel.addEventListener("click", onCancel);
  });
}

/**
 * Formatiert Sekunden-Uptime in "Xd Yh" oder "Yh Zm".
 * @param {number} seconds
 * @returns {string}
 */
function formatUptime(seconds) {
  if (!seconds || seconds <= 0) return "—";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

/**
 * RAM-Prozentsatz aus mem/maxmem.
 * @param {number} mem
 * @param {number} maxmem
 * @returns {number} - 0-100, 0 wenn keine Daten
 */
function memPercent(mem, maxmem) {
  if (!mem || !maxmem) return 0;
  return Math.round((mem / maxmem) * 100);
}

/**
 * Generiert einen Snapshot-Namen mit Timestamp.
 * Format: qa-YYYYMMDD-HHMMSS
 * @returns {string}
 */
function generateSnapshotName() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `qa-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

// --- Rendering ---

/**
 * Baut eine CPU/RAM-Bar-Group per DOM-API (kein innerHTML — Lint-sauber).
 * @param {string} label - "CPU" oder "RAM"
 * @param {number} pct - 0-100
 * @param {string} fillClass - CSS-Klasse für die Fill-Farbe
 * @returns {HTMLElement}
 */
function buildBarGroup(label, pct, fillClass) {
  const group = document.createElement("div");
  group.className = "bar-group";

  const labelEl = document.createElement("span");
  labelEl.className = "bar-label";
  labelEl.textContent = label;

  const track = document.createElement("div");
  track.className = "bar-track";
  const fill = document.createElement("div");
  fill.className = `bar-fill ${fillClass}`;
  fill.style.width = `${pct}%`;
  track.appendChild(fill);

  const text = document.createElement("span");
  text.className = "bar-text";
  text.textContent = fillClass === "na" ? "—" : `${pct}%`;

  group.append(labelEl, track, text);
  return group;
}

/**
 * Rendert eine einzelne Resource-Zeile (inkl. Backup-Checkbox).
 * @param {Object} res - Proxmox resource object
 * @returns {HTMLElement}
 */
function renderResource(res) {
  const isRunning = res.status === "running";
  const typeLabel = res.type === "lxc" ? "lxc" : "vm";
  const { node, type, vmid } = res;
  const resName = res.name || `VM ${vmid}`;

  const entry = document.createElement("div");
  entry.className = "resource-entry";
  entry.dataset.vmid = vmid;

  // --- Row 1: Checkbox + Dot + Name + Meta ---
  const row = document.createElement("div");
  row.className = "resource-row";

  // Backup-Checkbox
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "backup-checkbox";
  checkbox.title = "Für Backup auswählen";
  checkbox.addEventListener("change", updateBackupButton);
  row.appendChild(checkbox);

  const dot = document.createElement("span");
  dot.className = `resource-dot ${res.status}`;
  dot.title = isRunning
    ? `Uptime: ${formatUptime(res.uptime)}`
    : "Gestoppt";
  row.appendChild(dot);

  const name = document.createElement("span");
  name.className = "resource-name";
  name.textContent = resName;
  name.title = `${node} / ${type}/${vmid}`;
  row.appendChild(name);

  const meta = document.createElement("span");
  meta.className = "resource-meta";
  meta.textContent = `${typeLabel} ${vmid}`;
  row.appendChild(meta);

  entry.appendChild(row);

  // --- Row 2: CPU/RAM Bars (nur wenn running, sonst N/A) ---
  const bars = document.createElement("div");
  bars.className = "resource-bars";

  if (isRunning && res.maxmem) {
    const cpuPct = Math.round((res.cpu || 0) * 100);
    const ramPct = memPercent(res.mem, res.maxmem);
    bars.appendChild(buildBarGroup("CPU", cpuPct, "cpu"));
    bars.appendChild(buildBarGroup("RAM", ramPct, "ram"));
  } else {
    // Gotcha #7: stopped VMs zeigen keine "0% voll"-Bars — N/A-Style
    bars.appendChild(buildBarGroup("CPU", 0, "na"));
    bars.appendChild(buildBarGroup("RAM", 0, "na"));
  }
  entry.appendChild(bars);

  // --- Row 3: Action-Buttons ---
  const actions = document.createElement("div");
  actions.className = "resource-actions";

  // Snapshot (immer)
  const snapBtn = document.createElement("button");
  snapBtn.className = "action-btn";
  snapBtn.title = "Snapshot erstellen";
  snapBtn.appendChild(createIcon("snapshot"));
  snapBtn.addEventListener("click", () => handleSnapshot(node, type, vmid, resName, snapBtn));
  actions.appendChild(snapBtn);

  if (isRunning) {
    const rebootBtn = document.createElement("button");
    rebootBtn.className = "action-btn";
    rebootBtn.title = "Reboot";
    rebootBtn.appendChild(createIcon("reboot"));
    rebootBtn.addEventListener("click", () => handlePowerAction(node, type, vmid, "reboot", resName, rebootBtn));
    actions.appendChild(rebootBtn);

    const shutdownBtn = document.createElement("button");
    shutdownBtn.className = "action-btn danger";
    shutdownBtn.title = "Shutdown";
    shutdownBtn.appendChild(createIcon("shutdown"));
    shutdownBtn.addEventListener("click", () => handlePowerAction(node, type, vmid, "shutdown", resName, shutdownBtn));
    actions.appendChild(shutdownBtn);
  } else {
    const startBtn = document.createElement("button");
    startBtn.className = "action-btn";
    startBtn.title = "Start";
    startBtn.appendChild(createIcon("start"));
    startBtn.addEventListener("click", () => handlePowerAction(node, type, vmid, "start", resName, startBtn));
    actions.appendChild(startBtn);
  }

  entry.appendChild(actions);
  return entry;
}

/**
 * Zeigt den "Nicht konfiguriert"-Zustand mit Link zu den Options.
 */
function renderNotConfigured() {
  elStatus.className = "status-unknown";
  elLoading.classList.add("hidden");
  elList.innerHTML = "";

  const box = document.createElement("div");
  box.className = "not-configured";

  const text = document.createElement("p");
  text.textContent = "Noch nicht konfiguriert — PVE URL und API Token in den Einstellungen hinterlegen.";

  const btn = document.createElement("button");
  btn.className = "btn-primary";
  btn.textContent = "⚙ Einstellungen öffnen";
  btn.addEventListener("click", () => {
    browser.runtime.openOptionsPage();
    window.close();
  });

  box.append(text, btn);
  elList.appendChild(box);
}

/**
 * Aktualisiert den Backup-Button-Zustand anhand der Checkbox-Auswahl.
 */
function updateBackupButton() {
  const selected = document.querySelectorAll(".backup-checkbox:checked");
  if (selected.length > 0) {
    elBackup.innerHTML = "";
    elBackup.appendChild(createIcon("backup"));
    elBackup.append(` Backup (${selected.length})`);
    elBackup.disabled = false;
  } else {
    elBackup.innerHTML = "";
    elBackup.appendChild(createIcon("backup"));
    elBackup.append(" Backup");
    elBackup.disabled = true;
  }
}

// --- Action Handlers ---

/**
 * Setzt einen Action-Button in den Loading-Zustand (Spinner statt Icon).
 * @param {HTMLElement} btn - der geklickte Button
 * @returns {Function} - restore() zum Wiederherstellen
 */
function setButtonLoading(btn) {
  if (!btn) return () => {};
  // Child-Nodes für Restore sichern (DOM-Klone, kein innerHTML)
  const originalChildren = Array.from(btn.childNodes).map(n => n.cloneNode(true));
  btn.disabled = true;
  btn.classList.add("loading");

  // Spinner per DOM-API
  const spinner = document.createElement("span");
  spinner.className = "btn-spinner";
  btn.replaceChildren(spinner);

  return () => {
    btn.classList.remove("loading");
    btn.disabled = false;
    btn.replaceChildren(...originalChildren);
  };
}

async function handlePowerAction(node, type, vmid, powerAction, resName, btn) {
  const labels = { start: "Start", reboot: "Reboot", shutdown: "Shutdown", stop: "Stop" };

  if (!(await confirmAction(labels[powerAction], `"${resName}"`))) return;

  const restoreBtn = setButtonLoading(btn);
  try {
    const res = await sendMessage({ action: "powerAction", node, type, vmid, powerAction });
    if (res.success) {
      await loadResources(); // Refresh nach Action — baut Buttons neu
    } else {
      restoreBtn();
      showError(`${labels[powerAction]} fehlgeschlagen: ${res.error}`);
    }
  } catch (err) {
    restoreBtn();
    showError(`${labels[powerAction]} fehlgeschlagen: ${err.message}`);
  }
}

async function handleSnapshot(node, type, vmid, resName, btn) {
  const snapname = generateSnapshotName();

  if (!(await confirmAction("Snapshot", `"${resName}" — Name: ${snapname}`))) return;

  const restoreBtn = setButtonLoading(btn);
  try {
    const res = await sendMessage({ action: "createSnapshot", node, type, vmid, snapname });
    if (!res.success) {
      restoreBtn();
      showError(`Snapshot fehlgeschlagen: ${res.error}`);
    }
  } catch (err) {
    restoreBtn();
    showError(`Snapshot fehlgeschlagen: ${err.message}`);
  }
}

async function handleBackup() {
  // Ausgewählte Gäste aus Checkboxen sammeln
  const selected = document.querySelectorAll(".backup-checkbox:checked");
  if (selected.length === 0) return;

  // vmid aus dem parent .resource-entry dataset lesen
  const selectedVmids = new Set(
    Array.from(selected).map(cb => Number(cb.closest(".resource-entry").dataset.vmid))
  );
  const selectedResources = currentResources.filter(r => selectedVmids.has(r.vmid));

  if (selectedResources.length === 0) return;

  const detail = `${selectedResources.length} Gäste: ${selectedResources.map(r => r.name).join(", ")}`;
  if (!(await confirmAction("Backup", detail))) return;

  const restoreBtn = setButtonLoading(elBackup);
  try {
    const config = await sendMessage({ action: "getConfig" });
    if (!config.success) {
      restoreBtn();
      showError("Config konnte nicht geladen werden");
      return;
    }
    const storage = config.data.backupStorage;
    if (!storage) {
      restoreBtn();
      showError("Kein Backup-Storage konfiguriert — bitte in den Einstellungen wählen");
      return;
    }

    // VM-Liste mit Node pro VM (Cluster-safe, background.js gruppiert nach Node)
    const vmList = selectedResources.map(r => ({ node: r.node, vmid: r.vmid }));
    const res = await sendMessage({ action: "triggerBackup", vmList, storage });
    if (res.success) {
      // Checkboxen nach Backup zurücksetzen
      document.querySelectorAll(".backup-checkbox:checked").forEach(cb => { cb.checked = false; });
      updateBackupButton();
    } else {
      restoreBtn();
      showError(`Backup fehlgeschlagen: ${res.error}`);
    }
  } catch (err) {
    restoreBtn();
    showError(`Backup fehlgeschlagen: ${err.message}`);
  }
}

/**
 * Sortiert Ressourcen nach der konfigurierten Sortierung.
 * @param {Array} resources
 * @param {string} sortBy - "name" | "vmid" | "status"
 * @param {boolean} statusFirst - laufende Gäste zuerst gruppieren
 * @returns {Array}
 */
function sortResources(resources, sortBy, statusFirst) {
  const sorted = [...resources];

  switch (sortBy) {
    case "vmid":
      sorted.sort((a, b) => a.vmid - b.vmid);
      break;
    case "status":
      sorted.sort((a, b) => (a.status || "").localeCompare(b.status || ""));
      break;
    case "name":
    default:
      sorted.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      break;
  }

  // Status-Gruppierung als äußere Sortierung (stabil, erhält innere Ordnung)
  if (statusFirst) {
    sorted.sort((a, b) => {
      const aRunning = a.status === "running" ? 0 : 1;
      const bRunning = b.status === "running" ? 0 : 1;
      return aRunning - bRunning;
    });
  }

  return sorted;
}

// --- Load & Render ---

async function loadResources() {
  elLoading.classList.remove("hidden");
  elError.classList.add("hidden");

  try {
    // Config-Check zuerst — ohne Config direkt Options-Hinweis
    const cfg = await sendMessage({ action: "getConfig" });
    if (!cfg.success) {
      showError(cfg.error);
      return;
    }
    const { pveUrl, apiTokenId, apiTokenSecret } = cfg.data;
    if (!pveUrl || !apiTokenId || !apiTokenSecret) {
      renderNotConfigured();
      return;
    }

    elList.innerHTML = "";
    const res = await sendMessage({ action: "getResources" });

    if (!res.success) {
      showError(res.error || "Unbekannter Fehler");
      elStatus.className = "status-stopped";
      return;
    }

    elStatus.className = "status-running";
    elLoading.classList.add("hidden");

    // Sortierung aus Config (sortBy + statusFirst)
    const sorted = sortResources(res.data, cfg.data.sortBy || "name", cfg.data.statusFirst !== false);

    currentResources = sorted;

    if (sorted.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-list";
      empty.textContent = "Keine Ressourcen gefunden";
      elList.appendChild(empty);
      return;
    }

    const frag = document.createDocumentFragment();
    sorted.forEach(r => frag.appendChild(renderResource(r)));
    elList.appendChild(frag);
    updateBackupButton();
  } catch (err) {
    showError(err.message);
    elStatus.className = "status-stopped";
  }
}

function showError(msg) {
  elError.textContent = `⚠ ${msg}`;
  elError.classList.remove("hidden");
  elLoading.classList.add("hidden");
}

// --- Event Listeners ---

elRefresh.addEventListener("click", loadResources);
elBackup.addEventListener("click", handleBackup);

// --- Init ---

// Theme aus Config anwenden (vor dem ersten Render, damit kein Flackern entsteht)
(async () => {
  try {
    const cfg = await sendMessage({ action: "getConfig" });
    if (cfg.success && cfg.data.theme === "light") {
      document.body.classList.add("theme-light");
    }
  } catch { /* Default: dark */ }
})();

// Footer-Buttons mit Icons befüllen (Text kommt via updateBackupButton)
elRefresh.appendChild(createIcon("refresh"));
elRefresh.append(" Refresh");
updateBackupButton();
loadResources();
