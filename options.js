/**
 * options.js — settings page logic
 *
 * - Loads/saves the configuration (browser.storage.local)
 * - Requests host permission for the entered PVE URL
 *   (optional_host_permissions → browser.permissions.request)
 * - Connection test against PVE
 * - Backup storage dropdown from PVE (content filter "backup")
 */

// --- DOM References ---
const elPveUrl = document.getElementById("pve-url");
const elTokenId = document.getElementById("api-token-id");
const elTokenSecret = document.getElementById("api-token-secret");
const elBackupStorage = document.getElementById("backup-storage");
const elTheme = document.getElementById("theme");
const elSortBy = document.getElementById("sort-by");
const elStatusFirst = document.getElementById("status-first");
const elRefreshInterval = document.getElementById("refresh-interval");
const elTestConnection = document.getElementById("test-connection");
const elTestResult = document.getElementById("test-result");
const elSave = document.getElementById("save");
const elSaveStatus = document.getElementById("save-status");

/**
 * Sends a message to the service worker.
 * @param {Object} message
 * @returns {Promise<Object>}
 */
function sendMessage(message) {
  return browser.runtime.sendMessage(message);
}

/**
 * Extracts the origin (scheme + host + port) from a URL.
 * @param {string} url
 * @returns {string|null} - e.g. "https://pve.example.com:8006"
 */
function extractOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Requests the host permission for the specified PVE URL.
 * Must be called from a user gesture (click).
 * @param {string} pveUrl
 * @returns {Promise<boolean>} - true if the permission is granted
 */
async function requestHostPermission(pveUrl) {
  const origin = extractOrigin(pveUrl);
  if (!origin) return false;

  const granted = await browser.permissions.request({ origins: [origin + "/*"] });
  return granted;
}

/**
 * Revokes all currently granted optional host permissions.
 * (Future URL changes get their own permission.)
 */
async function revokeAllHostPermissions() {
  const current = await browser.permissions.getAll();
  if (current.origins && current.origins.length > 0) {
    await browser.permissions.remove({ origins: current.origins });
  }
}

/**
 * Loads the stored config and fills the form fields.
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
      elStatusFirst.checked = config.statusFirst !== false; // default: true
      elRefreshInterval.value = String(config.refreshInterval !== undefined ? config.refreshInterval : 30);

      // Enable the storage dropdown if already configured
      if (config.pveUrl && config.apiTokenId && config.apiTokenSecret) {
        elBackupStorage.disabled = false;
        await loadBackupStorages(config.backupStorage);
      }
    }
  } catch (err) {
    showStatus(`Loading failed: ${err.message}`, "error");
  }
}

/**
 * Tests the connection to PVE (query resources).
 */
async function testConnection() {
  elTestConnection.disabled = true;
  elTestConnection.textContent = "Testing...";
  elTestResult.textContent = "";

  const pveUrl = elPveUrl.value.trim();
  const tokenId = elTokenId.value.trim();
  const tokenSecret = elTokenSecret.value.trim();

  if (!pveUrl || !tokenId || !tokenSecret) {
    showTestResult("Please fill in all connection details", "error");
    return;
  }

  // 1. Request the host permission (user gesture = this click)
  const granted = await requestHostPermission(pveUrl);
  if (!granted) {
    showTestResult("Host permission denied — the add-on does not work without access to the PVE URL", "error");
    return;
  }

  // 2. Test the connection with the current form values
  //    (temporarily save the config, then load resources)
  await sendMessage({
    action: "saveConfig",
    config: {
      pveUrl,
      apiTokenId: tokenId,
      apiTokenSecret: tokenSecret,
      backupStorage: elBackupStorage.value || "",
      theme: elTheme.value,
      sortBy: elSortBy.value,
      statusFirst: elStatusFirst.checked,
      refreshInterval: Number(elRefreshInterval.value)
    }
  });

  const res = await sendMessage({ action: "getResources" });
  if (res.success) {
    const count = Array.isArray(res.data) ? res.data.length : 0;
    showTestResult(`✓ Connection OK — ${count} resources found`, "success");
    elBackupStorage.disabled = false;
    await loadBackupStorages(elBackupStorage.value);
  } else {
    showTestResult(`✗ ${res.error}`, "error");
  }
}

/**
 * Loads available backup storages from PVE and fills the dropdown.
 * @param {string} [currentVal] - restore the currently selected value
 */
async function loadBackupStorages(currentVal) {
  try {
    const res = await sendMessage({ action: "getBackupStorages" });
    if (res.success) {
      elBackupStorage.innerHTML = '<option value="">— Please choose —</option>';
      res.data.forEach(storage => {
        const opt = document.createElement("option");
        opt.value = storage.storage;
        opt.textContent = `${storage.storage} (${storage.type})`;
        elBackupStorage.appendChild(opt);
      });
      elBackupStorage.value = currentVal || "";
    } else {
      showStatus(`Loading storages failed: ${res.error}`, "error");
    }
  } catch (err) {
    showStatus(`Loading storages failed: ${err.message}`, "error");
  }
}

/**
 * Saves the current configuration (+ host permission for the URL).
 */
async function saveConfig() {
  const pveUrl = elPveUrl.value.trim();
  const tokenId = elTokenId.value.trim();
  const tokenSecret = elTokenSecret.value.trim();

  if (!pveUrl || !tokenId || !tokenSecret) {
    showStatus("Please fill in all connection details", "error");
    return;
  }

  // Validate the URL
  if (!extractOrigin(pveUrl)) {
    showStatus("Invalid PVE URL", "error");
    return;
  }

  // Request the host permission for the URL (if not done yet)
  const granted = await requestHostPermission(pveUrl);
  if (!granted) {
    showStatus("Host permission denied — configuration not saved", "error");
    return;
  }

  const config = {
    pveUrl,
    apiTokenId: tokenId,
    apiTokenSecret: tokenSecret,
    backupStorage: elBackupStorage.value,
    theme: elTheme.value,
    sortBy: elSortBy.value,
    statusFirst: elStatusFirst.checked,
    refreshInterval: Number(elRefreshInterval.value)
  };

  try {
    const res = await sendMessage({ action: "saveConfig", config });
    if (res.success) {
      showStatus("Saved ✓", "success");
    } else {
      showStatus(`Saving failed: ${res.error}`, "error");
    }
  } catch (err) {
    showStatus(`Saving failed: ${err.message}`, "error");
  }
}

/**
 * Shows a status message.
 * @param {string} msg
 * @param {string} type - "success" or "error"
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
 * Shows the connection test result.
 * @param {string} msg
 * @param {string} type
 */
function showTestResult(msg, type) {
  elTestResult.textContent = msg;
  elTestResult.className = `test-result ${type || ""}`;
  elTestConnection.disabled = false;
  elTestConnection.textContent = "🔌 Test connection";
}

/**
 * Applies the theme to the options page.
 * @param {string} theme - "dark" | "light" | "nord" | "oled" | "dracula" |
 *                         "catppuccin" | "tokyo-night" | "solarized-dark" |
 *                         "monochrome"
 */
function applyTheme(theme) {
  document.body.classList.toggle("theme-light", theme === "light");
  document.body.classList.toggle("theme-nord", theme === "nord");
  document.body.classList.toggle("theme-oled", theme === "oled");
  document.body.classList.toggle("theme-dracula", theme === "dracula");
  document.body.classList.toggle("theme-catppuccin", theme === "catppuccin");
  document.body.classList.toggle("theme-tokyo-night", theme === "tokyo-night");
  document.body.classList.toggle("theme-solarized-dark", theme === "solarized-dark");
  document.body.classList.toggle("theme-monochrome", theme === "monochrome");
}

// --- Event Listeners ---
elSave.addEventListener("click", saveConfig);
elTestConnection.addEventListener("click", testConnection);

// Live theme preview when the dropdown changes
elTheme.addEventListener("change", () => applyTheme(elTheme.value));

// --- Init ---
loadConfig();
