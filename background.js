/**
 * background.js — Service Worker (Manifest V3)
 *
 * Central API communication with Proxmox VE (PVE 9, /api2/json).
 * Receives messages from the popup/options page, executes API calls,
 * returns the results.
 *
 * PVE 9 specifics (verified live):
 *   - Token-Auth via Authorization-Header funktioniert
 *   - storage?type=backup does NOT exist in PVE 9 → instead,
 *     list /storage and filter by content "backup"
 *   - the vzdump parameter is called "vmid" (singular, comma-separated)
 */

// --- Default config ---
// Deliberately empty: no defaults for URLs/nodes — the user configures their own
// PVE instance in the options (AMO-compliant, nothing hardcoded).
const DEFAULT_CONFIG = {
  pveUrl: "",         // e.g. "https://pve.example.com:8006"
  apiTokenId: "",     // Format: USER@REALM!TOKENID
  apiTokenSecret: "",
  backupStorage: "",  // PVE storage name for vzdump
  theme: "dark",      // "dark" | "light"
  sortBy: "name",    // "name" (alphabetical) | "vmid" (by ID) | "status" (by status)
  statusFirst: true,  // sort running guests first
  refreshInterval: 30 // auto-refresh in seconds; 0 = off
};

/**
 * Config cache with fallback — works around the MV3 event page problem:
 * After the idle timeout (~30s) the background page wakes up on the next
 * message handler. Storage reads on a cold start can be stale/empty
 * → auth header missing → PVE answers 401 (user field empty in the log).
 * Solution: re-cache the config on wake-up + retry once on 401 with a fresh
 * config.
 */
let configCache = null;
const DEBUG = false; // true = console logs in the background worker (about:debugging → Inspect)

function debugLog(...args) {
  if (DEBUG) console.log("[QA]", ...args);
}

/**
 * Loads the stored configuration from browser.storage.local.
 * Falls back to DEFAULT_CONFIG for missing values.
 * @param {boolean} [forceRefresh=true] - ignore the cache and reload
 * @returns {Promise<Object>}
 */
async function getConfig(forceRefresh = true) {
  if (!forceRefresh && configCache) return configCache;
  const stored = await browser.storage.local.get("pveConfig");
  configCache = { ...DEFAULT_CONFIG, ...(stored.pveConfig || {}) };
  return configCache;
}

// Reload the config cache when the event page wakes up
browser.runtime.onStartup.addListener(() => { configCache = null; });
// Patrol: also reload the cache on every top-level message received,
// since the page can sleep between messages (see the message handler below).

/**
 * Checks whether the configuration is sufficient for API calls.
 * @param {Object} config
 * @returns {boolean}
 */
function isConfigured(config) {
  return Boolean(config.pveUrl && config.apiTokenId && config.apiTokenSecret);
}

/**
 * Builds the Authorization header for Proxmox API token auth.
 * @param {Object} config
 * @returns {string} - "PVEAPIToken=USER@REALM!TOKENID=SECRET"
 */
function buildAuthHeader(config) {
  return `PVEAPIToken=${config.apiTokenId}=${config.apiTokenSecret}`;
}

/**
 * Central fetch function for the Proxmox API — with 401 retry:
 * On auth errors the config is loaded fresh from storage once
 * (works around MV3 cold-start stale reads) and the request is retried.
 * @param {string} path - API path (without base URL), e.g. "/api2/json/cluster/resources"
 * @param {Object} options - fetch() options (method, body, etc.)
 * @param {Object} config - configuration (PVE URL, token)
 * @param {boolean} [isRetry=false] - internal retry marker
 * @returns {Promise<Object>} - parsed JSON response (data value)
 * @throws {Error} - on config, network, or API errors
 */
async function pveApiCall(path, options = {}, config, isRetry = false) {
  if (!isConfigured(config)) {
    throw new Error("Not configured — please enter the PVE URL and API token in the settings");
  }

  const url = `${config.pveUrl}${path}`;
  const headers = {
    "Authorization": buildAuthHeader(config),
    "Content-Type": "application/x-www-form-urlencoded"
  };

  debugLog("pveApiCall", options.method || "GET", path,
    "retry:", isRetry,
    "tokenLen:", (config.apiTokenId || "").length,
    "secretLen:", (config.apiTokenSecret || "").length);

  let response;
  try {
    // credentials: 'omit' — deliberately NOT sending any cookies!
    // Otherwise the add-on silently authenticates via the PVE web UI session
    // (cookie auth), which lets GETs through but rejects POSTs with 401
    // without a CSRF token. The add-on shall authenticate via the API token ONLY.
    response = await fetch(url, { ...options, headers, credentials: "omit" });
  } catch (err) {
    // fetch throws on network errors (including TLS problems).
    // Most common cause: self-signed certificate without an accepted exception
    // in the Firefox profile (the URL must have been opened in the browser once).
    throw new Error(`Connection to ${config.pveUrl} failed: ${err.message}. ` +
      "Hint: for a self-signed certificate the URL must be opened and accepted in the browser once.");
  }

  if (response.status === 401 || response.status === 403) {
    // Retry once with a freshly loaded config (MV3 cold-start fix)
    if (!isRetry) {
      const freshConfig = await getConfig(true);
      debugLog("401 — retry with fresh config",
        "tokenLen:", (freshConfig.apiTokenId || "").length,
        "secretLen:", (freshConfig.apiTokenSecret || "").length);
      return pveApiCall(path, options, freshConfig, true);
    }
    throw new Error("Authentication failed (401/403) — check the API token ID or secret");
  }

  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.json();
      detail = body.errors
        ? Object.entries(body.errors).map(([k, v]) => `${k}: ${v}`).join("; ")
        : (body.message || JSON.stringify(body));
    } catch { /* ignore parse errors */ }
    throw new Error(`PVE API ${response.status}: ${detail || response.statusText}`);
  }

  const json = await response.json();
  // Proxmox wraps responses in { "data": [...] }
  return json.data !== undefined ? json.data : json;
}

/**
 * Loads all VMs/LXCs including status.
 * @param {Object} config
 * @returns {Promise<Array>}
 */
async function getResources(config) {
  return pveApiCall("/api2/json/cluster/resources?type=vm", {}, config);
}

/**
 * Loads all storages and filters for backup-capable ones (content contains "backup").
 * PVE 9: /storage?type=backup no longer exists — content filter instead.
 * @param {Object} config
 * @returns {Promise<Array>}
 */
async function getBackupStorages(config) {
  const storages = await pveApiCall("/api2/json/storage", {}, config);
  return storages.filter(s => (s.content || "").includes("backup"));
}

/**
 * Executes a power action (start/stop/reboot/shutdown).
 * @param {Object} config
 * @param {string} node
 * @param {string} type - "lxc" or "qemu"
 * @param {number} vmid
 * @param {string} cmd - "start" | "stop" | "reboot" | "shutdown"
 */
async function doPowerAction(config, node, type, vmid, cmd) {
  await pveApiCall(`/api2/json/nodes/${node}/${type}/${vmid}/status/${cmd}`, { method: "POST" }, config);
}

/**
 * Creates a snapshot with an auto name — including collision retry.
 * Proxmox does not allow duplicate snapshot names per VM/LXC.
 * On collision (same second) a suffix -1, -2, ... is appended.
 * @param {Object} config
 * @param {string} node
 * @param {string} type
 * @param {number} vmid
 * @param {string} snapname - e.g. "qa-20260910-143000"
 */
async function createSnapshot(config, node, type, vmid, snapname) {
  const maxRetries = 5;
  let currentName = snapname;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await pveApiCall(`/api2/json/nodes/${node}/${type}/${vmid}/snapshot`, {
        method: "POST",
        body: `snapname=${encodeURIComponent(currentName)}`
      }, config);
      return; // success
    } catch (err) {
      // Detect collision: PVE reports 500 with "snapshot name already in use"
      const isCollision = err.message.includes("already in use") ||
                          err.message.includes("exist");
      if (isCollision && attempt < maxRetries) {
        currentName = `${snapname}-${attempt + 1}`;
        continue;
      }
      throw err; // other error, or retries exhausted
    }
  }
}

/**
 * Triggers ad-hoc vzdump backups — groups VMIDs by node
 * (cluster-safe: vzdump is a node endpoint, each VM lives on one node).
 * @param {Object} config
 * @param {Array<{node: string, vmid: number}>} vmList - [{node, vmid}, ...]
 * @param {string} storage - PVE storage name
 */
async function triggerBackup(config, vmList, storage) {
  // Group by node
  const byNode = {};
  for (const { node, vmid } of vmList) {
    (byNode[node] = byNode[node] || []).push(vmid);
  }
  // One vzdump per node — PVE 9: the parameter is called "vmid" (singular, comma-separated)
  for (const [node, vmids] of Object.entries(byNode)) {
    await pveApiCall(`/api2/json/nodes/${node}/vzdump`, {
      method: "POST",
      body: `vmid=${encodeURIComponent(vmids.join(","))}&storage=${encodeURIComponent(storage)}&mode=snapshot&compress=zstd`
    }, config);
  }
}

// --- Message handler ---
// The popup and options page send messages to the service worker.
// Each message has an `action` property that selects the handler.

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Async handler — must return true for an async response
  (async () => {
    try {
      const config = await getConfig();

      switch (message.action) {
        case "getResources": {
          const data = await getResources(config);
          sendResponse({ success: true, data });
          break;
        }

        case "powerAction": {
          const { node, type, vmid, powerAction } = message;
          await doPowerAction(config, node, type, vmid, powerAction);
          sendResponse({ success: true });
          break;
        }

        case "createSnapshot": {
          const { node, type, vmid, snapname } = message;
          await createSnapshot(config, node, type, vmid, snapname);
          sendResponse({ success: true });
          break;
        }

        case "triggerBackup": {
          const { vmList, storage } = message;
          await triggerBackup(config, vmList, storage);
          sendResponse({ success: true });
          break;
        }

        case "getBackupStorages": {
          const data = await getBackupStorages(config);
          sendResponse({ success: true, data });
          break;
        }

        case "getConfig": {
          // Do not send the secret — it would only be needed to prefill the options page;
          // but the options page needs it to be able to leave it unchanged.
          sendResponse({ success: true, data: config });
          break;
        }

        case "saveConfig": {
          await browser.storage.local.set({ pveConfig: message.config });
          sendResponse({ success: true });
          break;
        }

        default:
          sendResponse({ success: false, error: `Unknown action: ${message.action}` });
      }
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
  })();

  return true; // Async response
});
