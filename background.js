/**
 * background.js — Service Worker (Manifest V3)
 *
 * Zentrale API-Kommunikation mit Proxmox VE (PVE 9, /api2/json).
 * Empfängt Messages vom Popup/Options-Page, führt API-Calls aus,
 * gibt Ergebnisse zurück.
 *
 * PVE 9 Besonderheiten (live verifiziert):
 *   - Token-Auth via Authorization-Header funktioniert
 *   - storage?type=backup existiert NICHT in PVE 9 → stattdessen
 *     /storage listen und per content-Filter "backup" filtern
 *   - vzdump-Parameter heißt "vmid" (Singular, komma-separiert)
 */

// --- Default-Config ---
// Bewusst leer: keine Defaults für URLs/Nodes — User konfiguriert seine eigene
// PVE-Instanz in den Options (AMO-tauglich, nichts hardcoded).
const DEFAULT_CONFIG = {
  pveUrl: "",         // z.B. "https://pve.example.com:8006"
  apiTokenId: "",     // Format: USER@REALM!TOKENID
  apiTokenSecret: "",
  backupStorage: "",  // PVE Storage Name für vzdump
  theme: "dark",      // "dark" | "light"
  sortBy: "name",    // "name" (alphabetisch) | "vmid" (nach ID) | "status" (nach Status)
  statusFirst: true   // laufende Gäste zuerst sortieren
};

/**
 * Config-Cache mit Fallback — umgeht das MV3-Event-Page-Problem:
 * Nach dem Idle-Timeout (~30s) wacht die Background-Page beim nächsten
 * Message-Handler auf. Storage-Reads beim Kaltstart können stale/leer
 * sein → Auth-Header fehlt → PVE antwortet 401 (User-Feld im Log leer).
 * Lösung: Config beim Aufwachen neu cachen + bei 401 einmal mit frischer
 * Config wiederholen.
 */
let configCache = null;
const DEBUG = false; // true = Console-Logs im Background-Worker (about:debugging → Inspect)

function debugLog(...args) {
  if (DEBUG) console.log("[QA]", ...args);
}

/**
 * Lädt die gespeicherte Konfiguration aus browser.storage.local.
 * Fällt zurück auf DEFAULT_CONFIG bei fehlenden Werten.
 * @param {boolean} [forceRefresh=true] - Cache ignorieren und neu laden
 * @returns {Promise<Object>}
 */
async function getConfig(forceRefresh = true) {
  if (!forceRefresh && configCache) return configCache;
  const stored = await browser.storage.local.get("pveConfig");
  configCache = { ...DEFAULT_CONFIG, ...(stored.pveConfig || {}) };
  return configCache;
}

// Config-Cache beim Aufwachen der Event-Page neu laden
browser.runtime.onStartup.addListener(() => { configCache = null; });
// Patrol: auch bei jedem Top-Level-Message-Empfang den Cache neu laden,
// da die Page zwischen Messages schlafen kann (siehe Message-Handler unten).

/**
 * Prüft, ob die Konfiguration für API-Calls ausreichend ist.
 * @param {Object} config
 * @returns {boolean}
 */
function isConfigured(config) {
  return Boolean(config.pveUrl && config.apiTokenId && config.apiTokenSecret);
}

/**
 * Baut den Authorization-Header für Proxmox API Token Auth.
 * @param {Object} config
 * @returns {string} - "PVEAPIToken=USER@REALM!TOKENID=SECRET"
 */
function buildAuthHeader(config) {
  return `PVEAPIToken=${config.apiTokenId}=${config.apiTokenSecret}`;
}

/**
 * Zentrale Fetch-Funktion für Proxmox API — mit 401-Retry:
 * Bei Auth-Fehlern wird die Config einmal frisch aus storage geladen
 * (umgeht MV3-Kaltstart-Stale-Reads) und der Request wiederholt.
 * @param {string} path - API-Pfad (ohne Base-URL), z.B. "/api2/json/cluster/resources"
 * @param {Object} options - fetch() options (method, body, etc.)
 * @param {Object} config - Konfiguration (PVE URL, Token)
 * @param {boolean} [isRetry=false] - interner Retry-Marker
 * @returns {Promise<Object>} - Parsed JSON Response (data-Wert)
 * @throws {Error} - Bei Config-Fehlern, Netzwerk- oder API-Fehlern
 */
async function pveApiCall(path, options = {}, config, isRetry = false) {
  if (!isConfigured(config)) {
    throw new Error("Nicht konfiguriert — bitte in den Einstellungen PVE URL und API Token hinterlegen");
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
    // credentials: 'omit' — bewusst KEINE Cookies mitschicken!
    // Sonst authentifiziert sich das Addon still über die PVE-WebUI-Session
    // (Cookie-Auth), was GETs durchlässt, POSTs aber ohne CSRF-Token mit 401
    // ablehnt. Das Addon soll NUR über den API Token authentifizieren.
    response = await fetch(url, { ...options, headers, credentials: "omit" });
  } catch (err) {
    // fetch wirft bei Netzwerk-Fehlern (inkl. TLS-Problemen).
    // Häufigste Ursache: self-signed Zertifikat ohne akzeptierte Exception
    // im Firefox-Profil (URL muss einmal im Browser geöffnet worden sein).
    throw new Error(`Verbindung zu ${config.pveUrl} fehlgeschlagen: ${err.message}. ` +
      "Hinweis: Bei self-signed Zertifikat muss die URL einmal im Browser geöffnet und akzeptiert worden sein.");
  }

  if (response.status === 401 || response.status === 403) {
    // Einmal mit frisch geladener Config wiederholen (MV3-Kaltstart-Fix)
    if (!isRetry) {
      const freshConfig = await getConfig(true);
      debugLog("401 — retry mit frischer Config",
        "tokenLen:", (freshConfig.apiTokenId || "").length,
        "secretLen:", (freshConfig.apiTokenSecret || "").length);
      return pveApiCall(path, options, freshConfig, true);
    }
    throw new Error("Authentifizierung fehlgeschlagen (401/403) — API Token ID oder Secret prüfen");
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
 * Lädt alle VMs/LXCs mit Status.
 * @param {Object} config
 * @returns {Promise<Array>}
 */
async function getResources(config) {
  return pveApiCall("/api2/json/cluster/resources?type=vm", {}, config);
}

/**
 * Lädt alle Storages und filtert auf Backup-fähige (content enthält "backup").
 * PVE 9: /storage?type=backup existiert nicht mehr — stattdessen content-Filter.
 * @param {Object} config
 * @returns {Promise<Array>}
 */
async function getBackupStorages(config) {
  const storages = await pveApiCall("/api2/json/storage", {}, config);
  return storages.filter(s => (s.content || "").includes("backup"));
}

/**
 * Führt eine Power-Action aus (start/stop/reboot/shutdown).
 * @param {Object} config
 * @param {string} node
 * @param {string} type - "lxc" oder "qemu"
 * @param {number} vmid
 * @param {string} cmd - "start" | "stop" | "reboot" | "shutdown"
 */
async function doPowerAction(config, node, type, vmid, cmd) {
  await pveApiCall(`/api2/json/nodes/${node}/${type}/${vmid}/status/${cmd}`, { method: "POST" }, config);
}

/**
 * Erstellt einen Snapshot mit Auto-Name — inkl. Kollisions-Retry.
 * Proxmox erlaubt keine doppelten Snapshot-Namen pro VM/LXC.
 * Bei Kollision (gleiche Sekunde) wird ein Suffix -1, -2, ... angehängt.
 * @param {Object} config
 * @param {string} node
 * @param {string} type
 * @param {number} vmid
 * @param {string} snapname - z.B. "qa-20260910-143000"
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
      return; // Erfolg
    } catch (err) {
      // Kollision erkennen: PVE meldet 500 mit "snapshot name already in use"
      const isCollision = err.message.includes("already in use") ||
                          err.message.includes("exist");
      if (isCollision && attempt < maxRetries) {
        currentName = `${snapname}-${attempt + 1}`;
        continue;
      }
      throw err; // Anderer Fehler oder Retries aufgebraucht
    }
  }
}

/**
 * Triggert ad-hoc vzdump Backups — gruppiert VMIDs nach Node
 * (Cluster-safe: vzdump ist ein Node-Endpoint, jede VM liegt auf einem Node).
 * @param {Object} config
 * @param {Array<{node: string, vmid: number}>} vmList - [{node, vmid}, ...]
 * @param {string} storage - PVE Storage Name
 */
async function triggerBackup(config, vmList, storage) {
  // Nach Node gruppieren
  const byNode = {};
  for (const { node, vmid } of vmList) {
    (byNode[node] = byNode[node] || []).push(vmid);
  }
  // Pro Node ein vzdump — PVE 9: Parameter heißt "vmid" (Singular, komma-separiert)
  for (const [node, vmids] of Object.entries(byNode)) {
    await pveApiCall(`/api2/json/nodes/${node}/vzdump`, {
      method: "POST",
      body: `vmid=${encodeURIComponent(vmids.join(","))}&storage=${encodeURIComponent(storage)}&mode=snapshot&compress=zstd`
    }, config);
  }
}

// --- Message Handler ---
// Popup und Options-Page schicken Messages an den Service Worker.
// Jede Message hat eine `action`-Property, die den Handler auswählt.

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Async handler — muss true zurückgeben für asynchrone Antwort
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
          // Secret nicht mitschicken — nur für PreFill der Options-Page nötig wäre es;
          // Options-Page braucht es aber, um es unverändert lassen zu können.
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
