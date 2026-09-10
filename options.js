/**
 * options.js — Settings-Page Logik
 *
 * - Lädt/speichert Konfiguration (browser.storage.local)
 * - Fordert Host-Permission für die eingegebene PVE-URL an
 *   (optional_host_permissions → browser.permissions.request)
 * - Test-Verbindung gegen PVE
 * - Backup-Storage-Dropdown aus PVE (content-Filter "backup")
 */

// --- DOM References ---
const elPveUrl = document.getElementById("pve-url");
const elTokenId = document.getElementById("api-token-id");
const elTokenSecret = document.getElementById("api-token-secret");
const elBackupStorage = document.getElementById("backup-storage");
const elTheme = document.getElementById("theme");
const elSortBy = document.getElementById("sort-by");
const elStatusFirst = document.getElementById("status-first");
const elTestConnection = document.getElementById("test-connection");
const elTestResult = document.getElementById("test-result");
const elSave = document.getElementById("save");
const elSaveStatus = document.getElementById("save-status");

/**
 * Schickt eine Message an den Service Worker.
 * @param {Object} message
 * @returns {Promise<Object>}
 */
function sendMessage(message) {
  return browser.runtime.sendMessage(message);
}

/**
 * Extrahiert die Origin (scheme + host + port) aus einer URL.
 * @param {string} url
 * @returns {string|null} - z.B. "https://pve.example.com:8006"
 */
function extractOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Fordert die Host-Permission für die angegebene PVE-URL an.
 * Muss aus einem User-Geste (Klick) aufgerufen werden.
 * @param {string} pveUrl
 * @returns {Promise<boolean>} - true wenn Permission erteilt
 */
async function requestHostPermission(pveUrl) {
  const origin = extractOrigin(pveUrl);
  if (!origin) return false;

  const granted = await browser.permissions.request({ origins: [origin + "/*"] });
  return granted;
}

/**
 * Widerruft alle aktuell erteilten optional Host-Permissions.
 * (Zukünftige URL-Wechsel bekommen ihre eigene Permission.)
 */
async function revokeAllHostPermissions() {
  const current = await browser.permissions.getAll();
  if (current.origins && current.origins.length > 0) {
    await browser.permissions.remove({ origins: current.origins });
  }
}

/**
 * Lädt die gespeicherte Config und befüllt die Formular-Felder.
 */
async function loadConfig() {
  try {
    const res = await sendMessage({ action: "getConfig" });
    if (res.success) {
      const config = res.data;
      elPveUrl.value = config.pveUrl || "";
      elTokenId.value = config.apiTokenId || "";
      elTokenSecret.value = config.apiTokenSecret || "";
      elBackupStorage.value = config.backupStorage || "";
      elTheme.value = config.theme || "dark";
      applyTheme(elTheme.value);
      elSortBy.value = config.sortBy || "name";
      elStatusFirst.checked = config.statusFirst !== false; // Default: true

      // Storage-Dropdown aktivieren, wenn schon konfiguriert
      if (config.pveUrl && config.apiTokenId && config.apiTokenSecret) {
        elBackupStorage.disabled = false;
        await loadBackupStorages(config.backupStorage);
      }
    }
  } catch (err) {
    showStatus(`Laden fehlgeschlagen: ${err.message}`, "error");
  }
}

/**
 * Testet die Verbindung zur PVE (Resources abfragen).
 */
async function testConnection() {
  elTestConnection.disabled = true;
  elTestConnection.textContent = "Teste...";
  elTestResult.textContent = "";

  const pveUrl = elPveUrl.value.trim();
  const tokenId = elTokenId.value.trim();
  const tokenSecret = elTokenSecret.value.trim();

  if (!pveUrl || !tokenId || !tokenSecret) {
    showTestResult("Bitte alle Verbindungsdaten ausfüllen", "error");
    return;
  }

  // 1. Host-Permission einholen (User-Geste = dieser Klick)
  const granted = await requestHostPermission(pveUrl);
  if (!granted) {
    showTestResult("Host-Permission abgelehnt — ohne Zugriff auf die PVE-URL funktioniert das Addon nicht", "error");
    return;
  }

  // 2. Verbindung mit den aktuellen Formular-Werten testen
  //    (Config temporär speichern, dann Resources laden)
  await sendMessage({
    action: "saveConfig",
    config: {
      pveUrl,
      apiTokenId: tokenId,
      apiTokenSecret: tokenSecret,
      backupStorage: elBackupStorage.value || "",
      theme: elTheme.value,
      sortBy: elSortBy.value,
      statusFirst: elStatusFirst.checked
    }
  });

  const res = await sendMessage({ action: "getResources" });
  if (res.success) {
    const count = Array.isArray(res.data) ? res.data.length : 0;
    showTestResult(`✓ Verbindung OK — ${count} Ressourcen gefunden`, "success");
    elBackupStorage.disabled = false;
    await loadBackupStorages(elBackupStorage.value);
  } else {
    showTestResult(`✗ ${res.error}`, "error");
  }
}

/**
 * Lädt verfügbare Backup-Storages aus PVE und befüllt das Dropdown.
 * @param {string} [currentVal] - aktuell gewählter Wert wiederherstellen
 */
async function loadBackupStorages(currentVal) {
  try {
    const res = await sendMessage({ action: "getBackupStorages" });
    if (res.success) {
      elBackupStorage.innerHTML = '<option value="">— Bitte wählen —</option>';
      res.data.forEach(storage => {
        const opt = document.createElement("option");
        opt.value = storage.storage;
        opt.textContent = `${storage.storage} (${storage.type})`;
        elBackupStorage.appendChild(opt);
      });
      elBackupStorage.value = currentVal || "";
    } else {
      showStatus(`Storage-Laden fehlgeschlagen: ${res.error}`, "error");
    }
  } catch (err) {
    showStatus(`Storage-Laden fehlgeschlagen: ${err.message}`, "error");
  }
}

/**
 * Speichert die aktuelle Konfiguration (+ Host-Permission für URL).
 */
async function saveConfig() {
  const pveUrl = elPveUrl.value.trim();
  const tokenId = elTokenId.value.trim();
  const tokenSecret = elTokenSecret.value.trim();

  if (!pveUrl || !tokenId || !tokenSecret) {
    showStatus("Bitte alle Verbindungsdaten ausfüllen", "error");
    return;
  }

  // URL validieren
  if (!extractOrigin(pveUrl)) {
    showStatus("Ungültige PVE URL", "error");
    return;
  }

  // Host-Permission für die URL einholen (falls noch nicht geschehen)
  const granted = await requestHostPermission(pveUrl);
  if (!granted) {
    showStatus("Host-Permission abgelehnt — Konfiguration nicht gespeichert", "error");
    return;
  }

  const config = {
    pveUrl,
    apiTokenId: tokenId,
    apiTokenSecret: tokenSecret,
    backupStorage: elBackupStorage.value,
    theme: elTheme.value,
    sortBy: elSortBy.value,
    statusFirst: elStatusFirst.checked
  };

  try {
    const res = await sendMessage({ action: "saveConfig", config });
    if (res.success) {
      showStatus("Gespeichert ✓", "success");
    } else {
      showStatus(`Speichern fehlgeschlagen: ${res.error}`, "error");
    }
  } catch (err) {
    showStatus(`Speichern fehlgeschlagen: ${err.message}`, "error");
  }
}

/**
 * Zeigt eine Statusmeldung an.
 * @param {string} msg
 * @param {string} type - "success" oder "error"
 */
function showStatus(msg, type) {
  elSaveStatus.textContent = msg;
  elSaveStatus.className = `save-status ${type || ""}`;
  setTimeout(() => {
    elSaveStatus.textContent = "";
    elSaveStatus.className = "save-status";
  }, 4000);
}

/**
 * Zeigt das Verbindungs-Test-Ergebnis an.
 * @param {string} msg
 * @param {string} type
 */
function showTestResult(msg, type) {
  elTestResult.textContent = msg;
  elTestResult.className = `test-result ${type || ""}`;
  elTestConnection.disabled = false;
  elTestConnection.textContent = "🔌 Verbindung testen";
}

/**
 * Wendet das Theme auf die Options-Page an.
 * @param {string} theme - "dark" | "light"
 */
function applyTheme(theme) {
  document.body.classList.toggle("theme-light", theme === "light");
}

// --- Event Listeners ---
elSave.addEventListener("click", saveConfig);
elTestConnection.addEventListener("click", testConnection);

// Theme-Live-Vorschau beim Wechsel des Dropdowns
elTheme.addEventListener("change", () => applyTheme(elTheme.value));

// --- Init ---
loadConfig();
