/**
 * popup.js — popup logic
 *
 * Renders the resource list in the flyout, handles button clicks
 * and sends messages to the service worker (background.js).
 *
 * Specification: AI-HELPER.md — popup layout, quick actions
 *
 * UX decisions (agreed with Andi):
 *   - Backup via checkbox selection (not all guests at once)
 *   - All actions with a confirm dialog (shutdown/reboot/start/snapshot/backup)
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
 * Sends a message to the service worker and returns the result.
 * @param {Object} message
 * @returns {Promise<Object>} - { success: boolean, data?: any, error?: string }
 */
function sendMessage(message) {
  return browser.runtime.sendMessage(message);
}

// --- Confirm overlay (replaces window.confirm — the native dialog breaks the popup) ---

const elConfirmOverlay = document.getElementById("confirm-overlay");
const elConfirmMessage = document.getElementById("confirm-message");
const elConfirmOk = document.getElementById("confirm-ok");
const elConfirmCancel = document.getElementById("confirm-cancel");

/**
 * Shows a confirmation dialog as an overlay in the popup.
 * @param {string} title - action, e.g. "Shutdown", "Backup"
 * @param {string} [detail] - extra info (guest name, snapshot name, guest list)
 * @returns {Promise<boolean>} - true if confirmed
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
 * Formats seconds of uptime as "Xd Yh" or "Yh Zm".
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
 * RAM percentage from mem/maxmem.
 * @param {number} mem
 * @param {number} maxmem
 * @returns {number} - 0-100, 0 if no data
 */
function memPercent(mem, maxmem) {
  if (!mem || !maxmem) return 0;
  return Math.round((mem / maxmem) * 100);
}

/**
 * Generates a snapshot name with a timestamp.
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
 * Builds a CPU/RAM bar group via the DOM API (no innerHTML — lint clean).
 * @param {string} label - "CPU", "RAM", "TEMP" or "DISK"
 * @param {number} pct - 0-100
 * @param {string} fillClass - CSS class for the fill color
 * @param {string} [unit="%"] - unit suffix for the text (TEMP uses "°")
 * @returns {HTMLElement}
 */
function buildBarGroup(label, pct, fillClass, unit = "%") {
  const group = document.createElement("div");
  group.className = "bar-group";

  const labelEl = document.createElement("span");
  labelEl.className = "bar-label";
  labelEl.textContent = label;

  const track = document.createElement("div");
  track.className = "bar-track";
  const fill = document.createElement("div");
  // >100% (e.g. RAM ballooning beyond the assigned limit): mark red, clamp width
  fill.className = `bar-fill ${fillClass}${pct > 100 ? " over" : ""}`;
  fill.style.width = `${Math.min(pct, 100)}%`;
  track.appendChild(fill);

  const text = document.createElement("span");
  text.className = "bar-text";
  text.textContent = fillClass === "na" ? "—" : `${pct}${unit}`;

  group.append(labelEl, track, text);
  return group;
}

/**
 * Renders a single resource row (including the backup checkbox).
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

  // --- Row 1: checkbox + dot + name + meta ---
  const row = document.createElement("div");
  row.className = "resource-row";

  // Backup checkbox
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "backup-checkbox";
  checkbox.title = "Select for backup";
  checkbox.addEventListener("change", updateBackupButton);
  row.appendChild(checkbox);

  const dot = document.createElement("span");
  dot.className = `resource-dot ${res.status}`;
  dot.title = isRunning
    ? `Uptime: ${formatUptime(res.uptime)}`
    : "Stopped";
  row.appendChild(dot);

  const name = document.createElement("span");
  name.className = "resource-name";
  name.textContent = resName;
  name.title = `${node} / ${type}/${vmid}`;
  row.appendChild(name);

  const meta = document.createElement("span");
  meta.className = "resource-meta";
  meta.textContent = isRunning && res.uptime
    ? `${typeLabel} ${vmid} · ↑ ${formatUptime(res.uptime)}`
    : `${typeLabel} ${vmid}`;
  row.appendChild(meta);

  entry.appendChild(row);

  // --- Row 2: CPU/RAM bars (only when running, otherwise N/A) ---
  const bars = document.createElement("div");
  bars.className = "resource-bars";

  if (isRunning && res.maxmem) {
    const cpuPct = Math.round((res.cpu || 0) * 100);
    const ramPct = memPercent(res.mem, res.maxmem);
    bars.appendChild(buildBarGroup("CPU", cpuPct, "cpu"));
    bars.appendChild(buildBarGroup("RAM", ramPct, "ram"));
  } else {
    // Gotcha #7: stopped VMs do not show "0% full" bars — N/A style
    bars.appendChild(buildBarGroup("CPU", 0, "na"));
    bars.appendChild(buildBarGroup("RAM", 0, "na"));
  }
  entry.appendChild(bars);

  // --- Row 3: action buttons (shared with the status-change update) ---
  entry.appendChild(buildActionButtons(res));

  entry.dataset.status = res.status;
  return entry;
}

/**
 * Updates an existing resource entry in place (auto-refresh v2):
 * status dot, uptime tooltip, CPU/RAM bars and — only on status change —
 * the action buttons. Buttons in a loading state (action in progress) are
 * left untouched so the feedback is preserved.
 * @param {HTMLElement} entry - the existing .resource-entry
 * @param {Object} res - new Proxmox resource data
 */
function updateResourceEntry(entry, res) {
  const isRunning = res.status === "running";
  const wasRunning = entry.dataset.status === "running";
  const { node, type, vmid } = res;
  const resName = res.name || `VM ${vmid}`;

  // --- Row 1: update dot + name ---
  const dot = entry.querySelector(".resource-dot");
  if (dot) {
    dot.className = `resource-dot ${res.status}`;
    dot.title = isRunning
      ? `Uptime: ${formatUptime(res.uptime)}`
      : "Stopped";
  }

  const name = entry.querySelector(".resource-name");
  if (name) {
    name.textContent = resName;
    name.title = `${node} / ${type}/${vmid}`;
  }

  // Meta line: keep uptime live (auto-refresh)
  const meta = entry.querySelector(".resource-meta");
  if (meta) {
    meta.textContent = isRunning && res.uptime
      ? `${type === "lxc" ? "lxc" : "vm"} ${vmid} · ↑ ${formatUptime(res.uptime)}`
      : `${type === "lxc" ? "lxc" : "vm"} ${vmid}`;
  }

  // --- Row 2: update bars in place (no rebuild) ---
  const bars = entry.querySelector(".resource-bars");
  if (bars) {
    if (isRunning && res.maxmem) {
      const cpuPct = Math.round((res.cpu || 0) * 100);
      const ramPct = memPercent(res.mem, res.maxmem);

      const groups = bars.querySelectorAll(".bar-group");
      if (groups.length === 2) {
        // Update existing bars: fill width + percentage text
        updateBarGroup(groups[0], cpuPct, false);
        updateBarGroup(groups[1], ramPct, false);
      } else {
        // Was N/A (stopped) → now running: rebuild bars
        bars.replaceChildren(
          buildBarGroup("CPU", cpuPct, "cpu"),
          buildBarGroup("RAM", ramPct, "ram")
        );
      }
    } else {
      // Stopped → N/A bars (if not already)
      const groups = bars.querySelectorAll(".bar-group");
      if (groups.length === 2 && !groups[0].querySelector(".bar-fill.na")) {
        bars.replaceChildren(
          buildBarGroup("CPU", 0, "na"),
          buildBarGroup("RAM", 0, "na")
        );
      }
    }
  }

  // --- Row 3: rebuild buttons ONLY on status change ---
  if (isRunning !== wasRunning) {
    const actions = entry.querySelector(".resource-actions");
    if (actions) {
      // Do not overwrite loading buttons — the running action takes precedence
      const hasLoading = actions.querySelector(".action-btn.loading");
      if (!hasLoading) {
        entry.replaceChild(buildActionButtons(res), actions);
      }
    }
  }

  entry.dataset.status = res.status;
}

/**
 * Updates an existing bar group in place.
 * @param {HTMLElement} group - .bar-group
 * @param {number} pct - 0-100
 * @param {boolean} na - N/A style
 */
function updateBarGroup(group, pct, na) {
  const fill = group.querySelector(".bar-fill");
  const text = group.querySelector(".bar-text");
  if (!fill || !text) return;

  if (na) {
    fill.className = "bar-fill na";
    fill.style.width = "100%";
    text.textContent = "—";
  } else {
    fill.className = fill.className.replace(" na", "");
    // >100%: mark red (" over"), clamp width to 100% — text shows the real value
    if (pct > 100) {
      if (!fill.classList.contains("over")) fill.classList.add("over");
      fill.style.width = "100%";
    } else {
      fill.classList.remove("over");
      fill.style.width = `${pct}%`;
    }
    text.textContent = `${pct}%`;
  }
}

/**
 * Builds the action button row for a guest (on status change).
 * @param {Object} res - Proxmox resource data
 * @returns {HTMLElement} - .resource-actions div
 */
function buildActionButtons(res) {
  const isRunning = res.status === "running";
  const { node, type, vmid } = res;
  const resName = res.name || `VM ${vmid}`;

  const actions = document.createElement("div");
  actions.className = "resource-actions";

  // Snapshot (always)
  const snapBtn = document.createElement("button");
  snapBtn.className = "action-btn";
  snapBtn.title = "Create snapshot";
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

  return actions;
}

/**
 * Shows the "not configured" state with a link to the options.
 */
function renderNotConfigured() {
  elStatus.className = "status-unknown";
  elLoading.classList.add("hidden");
  elList.innerHTML = "";

  const box = document.createElement("div");
  box.className = "not-configured";

  const text = document.createElement("p");
  text.textContent = "Not configured yet — enter the PVE URL and API token in the settings.";

  const btn = document.createElement("button");
  btn.className = "btn-primary";
  btn.textContent = "⚙ Open settings";
  btn.addEventListener("click", () => {
    browser.runtime.openOptionsPage();
    window.close();
  });

  box.append(text, btn);
  elList.appendChild(box);
}

/**
 * Updates the backup button state based on the checkbox selection.
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
 * Puts an action button into the loading state (spinner instead of icon).
 * @param {HTMLElement} btn - the clicked button
 * @returns {Function} - restore() to restore it
 */
function setButtonLoading(btn) {
  if (!btn) return () => {};
  // Save child nodes for restore (DOM clones, no innerHTML)
  const originalChildren = Array.from(btn.childNodes).map(n => n.cloneNode(true));
  btn.disabled = true;
  btn.classList.add("loading");

  // Spinner via DOM API
  const spinner = document.createElement("span");
  spinner.className = "btn-spinner";
  btn.replaceChildren(spinner);

  return () => {
    // If the button was removed from the DOM (the entry was rebuilt),
    // the restore is a no-op — the new button already has the right state.
    if (!btn.isConnected) return;
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
      // Update path (no full render) — this entry gets fresh buttons on status change;
      // the loading button stays in place as feedback until then
      await loadResources(true);
      restoreBtn(); // in case the entry was not rebuilt (status unchanged)
    } else {
      restoreBtn();
      showError(`${labels[powerAction]} failed: ${res.error}`);
    }
  } catch (err) {
    restoreBtn();
    showError(`${labels[powerAction]} failed: ${err.message}`);
  }
}

async function handleSnapshot(node, type, vmid, resName, btn) {
  const snapname = generateSnapshotName();

  if (!(await confirmAction("Snapshot", `"${resName}" — Name: ${snapname}`))) return;

  const restoreBtn = setButtonLoading(btn);
  try {
    const res = await sendMessage({ action: "createSnapshot", node, type, vmid, snapname });
    if (res.success) {
      restoreBtn(); // a snapshot does not change the status — restore the button
    } else {
      restoreBtn();
      showError(`Snapshot failed: ${res.error}`);
    }
  } catch (err) {
    restoreBtn();
    showError(`Snapshot failed: ${err.message}`);
  }
}

async function handleBackup() {
  // Collect selected guests from the checkboxes
  const selected = document.querySelectorAll(".backup-checkbox:checked");
  if (selected.length === 0) return;

  // Read the vmid from the parent .resource-entry dataset
  const selectedVmids = new Set(
    Array.from(selected).map(cb => Number(cb.closest(".resource-entry").dataset.vmid))
  );
  const selectedResources = currentResources.filter(r => selectedVmids.has(r.vmid));

  if (selectedResources.length === 0) return;

  const detail = `${selectedResources.length} guests: ${selectedResources.map(r => r.name).join(", ")}`;
  if (!(await confirmAction("Backup", detail))) return;

  const restoreBtn = setButtonLoading(elBackup);
  try {
    const config = await sendMessage({ action: "getConfig" });
    if (!config.success) {
      restoreBtn();
      showError("Could not load the config");
      return;
    }
    const storage = config.data.backupStorage;
    if (!storage) {
      restoreBtn();
      showError("No backup storage configured — please choose one in the settings");
      return;
    }

    // VM list with node per VM (cluster-safe, background.js groups by node)
    const vmList = selectedResources.map(r => ({ node: r.node, vmid: r.vmid }));
    const res = await sendMessage({ action: "triggerBackup", vmList, storage });
    if (res.success) {
      // Reset the checkboxes after the backup
      document.querySelectorAll(".backup-checkbox:checked").forEach(cb => { cb.checked = false; });
      updateBackupButton();
    } else {
      restoreBtn();
      showError(`Backup failed: ${res.error}`);
    }
  } catch (err) {
    restoreBtn();
    showError(`Backup failed: ${err.message}`);
  }
}

// --- Host (PVE node) monitor entry ---

/**
 * CPU temperature bar fill class: green below 60 °C, yellow below 75 °C,
 * red from 75 °C — traffic-light style independent of the theme accent color.
 * @param {number} temp - °C
 * @returns {string} - "temp-cool" | "temp-warm" | "temp-hot"
 */
function tempClass(temp) {
  if (temp >= 75) return "temp-hot";
  if (temp >= 60) return "temp-warm";
  return "temp-cool";
}

/**
 * Formats bytes human-readable (binary units: KiB…TiB).
 * @param {number} bytes
 * @returns {string} - e.g. "13.0 GiB", "2.6 TiB"
 */
function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let val = bytes;
  let unit = 0;
  while (val >= 1024 && unit < units.length - 1) {
    val /= 1024;
    unit++;
  }
  return `${val >= 100 ? Math.round(val) : val.toFixed(1)} ${units[unit]}`;
}

/**
 * Percentage for display: one decimal place below 1% (a rootfs that is
 * 0.5% full would otherwise round to a useless "0%"), integer above.
 * @param {number} raw - 0-100 (float)
 * @returns {number} - formatted for display
 */
function displayPct(raw) {
  if (raw < 1) return Math.round(raw * 10) / 10;
  return Math.round(raw);
}

/**
 * Builds the 4 system-monitor bars for the host entry:
 * CPU %, RAM %, CPU temp °C, disk usage % — 2 per row (CSS grid).
 * @param {Object} host - host data from getHostStatus()
 * @returns {HTMLElement} - .resource-bars div with 4 bar groups
 */
function buildHostBars(host) {
  const bars = document.createElement("div");
  bars.className = "resource-bars";

  const online = host.status === "online";

  if (online) {
    const cpuPct = displayPct((host.cpu || 0) * 100);
    bars.appendChild(buildBarGroup("CPU", cpuPct, "cpu"));

    const ramPct = displayPct(memPercent(host.mem, host.maxmem));
    bars.appendChild(buildBarGroup("RAM", ramPct, "ram"));

    if (host.cpuTemp !== null && host.cpuTemp !== undefined) {
      const temp = Math.round(host.cpuTemp);
      // Bar scaled: 100 °C = full track (temps above 100 are clamped, marked red)
      bars.appendChild(buildBarGroup("TEMP", Math.min(temp, 100), tempClass(temp), "°"));
    } else {
      // lm-sensors without a CPU chip (or not installed) → N/A
      bars.appendChild(buildBarGroup("TEMP", 0, "na"));
    }

    if (host.disk && host.disk.total) {
      const diskRaw = (host.disk.used / host.disk.total) * 100;
      const diskPct = displayPct(diskRaw);
      const diskGroup = buildBarGroup("DISK", diskPct, "disk");
      // Absolute values as tooltip — "0.5%" alone is meaningless
      diskGroup.title = `${formatBytes(host.disk.used)} / ${formatBytes(host.disk.total)}`;
      bars.appendChild(diskGroup);
    } else {
      bars.appendChild(buildBarGroup("DISK", 0, "na"));
    }
  } else {
    // Node offline/unknown → all N/A
    bars.appendChild(buildBarGroup("CPU", 0, "na"));
    bars.appendChild(buildBarGroup("RAM", 0, "na"));
    bars.appendChild(buildBarGroup("TEMP", 0, "na"));
    bars.appendChild(buildBarGroup("DISK", 0, "na"));
  }

  return bars;
}

/**
 * Renders a host entry (PVE node itself) — display only, no controls:
 * no backup checkbox, no action buttons. Sorted and pinned above the guests.
 * @param {Object} host - host data from getHostStatus()
 * @returns {HTMLElement}
 */
function renderHostEntry(host) {
  const entry = document.createElement("div");
  entry.className = "resource-entry host-entry";
  entry.dataset.node = host.node;

  const row = document.createElement("div");
  row.className = "resource-row";

  // Status dot (no checkbox — the host is not backup-selectable)
  const dot = document.createElement("span");
  dot.className = `resource-dot ${host.status === "online" ? "running" : "stopped"}`;
  dot.title = host.status === "online" ? `Uptime: ${formatUptime(host.uptime)}` : host.status;
  row.appendChild(dot);

  // Server icon + node name — visually distinct from the guests
  const icon = createIcon("host");
  icon.classList.add("host-icon");
  row.appendChild(icon);

  const name = document.createElement("span");
  name.className = "resource-name";
  name.textContent = host.node;
  name.title = host.pveversion || host.node;
  row.appendChild(name);

  // Meta line: uptime live, like the guests
  const meta = document.createElement("span");
  meta.className = "resource-meta";
  meta.textContent = host.status === "online" && host.uptime
    ? `host · ↑ ${formatUptime(host.uptime)}`
    : `host · ${host.status}`;
  row.appendChild(meta);

  entry.appendChild(row);
  entry.appendChild(buildHostBars(host));

  // Partial data (e.g. /status call failed): indicate via title, do not block
  if (host.statusError) {
    entry.title = `Partial data: ${host.statusError}`;
  }

  entry.dataset.status = host.status;
  return entry;
}

/**
 * Updates an existing host entry in place (auto-refresh): status dot,
 * uptime, version tooltip and the 4 bars.
 * @param {HTMLElement} entry - the existing .host-entry
 * @param {Object} host - new host data
 */
function updateHostEntry(entry, host) {
  const dot = entry.querySelector(".resource-dot");
  if (dot) {
    dot.className = `resource-dot ${host.status === "online" ? "running" : "stopped"}`;
    dot.title = host.status === "online" ? `Uptime: ${formatUptime(host.uptime)}` : host.status;
  }

  const name = entry.querySelector(".resource-name");
  if (name) name.title = host.pveversion || host.node;

  const meta = entry.querySelector(".resource-meta");
  if (meta) {
    meta.textContent = host.status === "online" && host.uptime
      ? `host · ↑ ${formatUptime(host.uptime)}`
      : `host · ${host.status}`;
  }

  const bars = entry.querySelector(".resource-bars");
  if (bars) bars.replaceWith(buildHostBars(host));

  if (host.statusError) {
    entry.title = `Partial data: ${host.statusError}`;
  } else {
    entry.removeAttribute("title");
  }

  entry.dataset.status = host.status;
}

/**
 * Loads the host monitor data and renders/updates the host entries
 * at the top of the resource list. Failures are non-fatal — the guest
 * list works without host data (error via title on the entry).
 * @returns {Promise<void>}
 */
async function loadHostEntries() {
  try {
    const res = await sendMessage({ action: "getHostStatus" });
    if (!res.success || !Array.isArray(res.data) || res.data.length === 0) return;

    const hostList = document.getElementById("host-list");
    if (!hostList) return;

    const existing = new Map();
    hostList.querySelectorAll(".host-entry").forEach(e => existing.set(e.dataset.node, e));

    const frag = document.createDocumentFragment();
    for (const host of res.data) {
      const entry = existing.get(host.node);
      if (entry && entry.dataset.status === host.status) {
        updateHostEntry(entry, host);
        frag.appendChild(entry); // keep position, update in place
      } else {
        frag.appendChild(renderHostEntry(host)); // new or status changed → rebuild
      }
    }
    hostList.replaceChildren(frag);
  } catch {
    /* Host data is a bonus — errors do not affect the guest list */
  }
}

/**
 * Sorts resources according to the configured sorting.
 * @param {Array} resources
 * @param {string} sortBy - "name" | "vmid" | "status"
 * @param {boolean} statusFirst - group running guests first
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

  // Status grouping as the outer sort (stable, preserves the inner order)
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

/**
 * Rotates the refresh icon in the footer briefly — feedback for the
 * auto-refresh tick without a big loading spinner.
 */
function pulseRefreshIcon() {
  const icon = elRefresh.querySelector(".icon svg");
  if (!icon) return;
  icon.classList.remove("refresh-pulse");
  // Force a reflow so the animation restarts
  void icon.offsetWidth;
  icon.classList.add("refresh-pulse");
}

async function loadResources(isAutoRefresh = false) {
  // No loading spinner on auto-refresh (flickers) — instead
  // the refresh icon in the footer rotates briefly as tick feedback
  if (isAutoRefresh) {
    pulseRefreshIcon();
  } else {
    elLoading.classList.remove("hidden");
  }
  elError.classList.add("hidden");

  try {
    // Config check first — without config, go straight to the options hint
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

    const res = await sendMessage({ action: "getResources" });

    if (!res.success) {
      showError(res.error || "Unknown error");
      elStatus.className = "status-stopped";
      return;
    }

    elStatus.className = "status-running";
    elLoading.classList.add("hidden");

    // Host monitor (parallel to the guest list — failures are non-fatal there)
    loadHostEntries();

    // Sorting from config (sortBy + statusFirst)
    const sorted = sortResources(res.data, cfg.data.sortBy || "name", cfg.data.statusFirst !== false);

    currentResources = sorted;

    if (sorted.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-list";
      empty.textContent = "No resources found";
      elList.replaceChildren(empty);
      return;
    }

    // --- V2 update path: update existing entries in place ---
    const existingEntries = new Map();
    document.querySelectorAll("#resource-list .resource-entry").forEach(e => {
      existingEntries.set(Number(e.dataset.vmid), e);
    });

    const hasListStructure = existingEntries.size > 0;
    const newVmids = new Set(sorted.map(r => r.vmid));
    const structureChanged =
      !hasListStructure ||
      existingEntries.size !== sorted.length ||
      [...existingEntries.keys()].some(vmid => !newVmids.has(vmid));

    if (hasListStructure && !structureChanged) {
      // Pure data update: refresh values in the existing entries.
      // Order/checkboxes/loading buttons remain untouched.
      sorted.forEach(r => {
        const entry = existingEntries.get(r.vmid);
        if (entry) updateResourceEntry(entry, r);
      });
      updateBackupButton();
      return;
    }

    // --- Full render (first load or structure changed: VMs added/removed) ---
    const frag = document.createDocumentFragment();
    sorted.forEach(r => frag.appendChild(renderResource(r)));
    elList.replaceChildren(frag);
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

// Theme + auto-refresh interval from config (before the first render, no flicker)
(async () => {
  try {
    const cfg = await sendMessage({ action: "getConfig" });
    if (cfg.success) {
      if (cfg.data.theme === "light") {
        document.body.classList.add("theme-light");
      } else if (cfg.data.theme === "nord") {
        document.body.classList.add("theme-nord");
      } else if (cfg.data.theme === "oled") {
        document.body.classList.add("theme-oled");
      } else if (cfg.data.theme === "dracula") {
        document.body.classList.add("theme-dracula");
      } else if (cfg.data.theme === "catppuccin") {
        document.body.classList.add("theme-catppuccin");
      } else if (cfg.data.theme === "tokyo-night") {
        document.body.classList.add("theme-tokyo-night");
      } else if (cfg.data.theme === "solarized-dark") {
        document.body.classList.add("theme-solarized-dark");
      } else if (cfg.data.theme === "monochrome") {
        document.body.classList.add("theme-monochrome");
      }
      // Auto-refresh: interval in seconds, 0 = disabled
      const interval = Number(cfg.data.refreshInterval !== undefined ? cfg.data.refreshInterval : 30);
      if (interval > 0) {
        window.setInterval(() => loadResources(true), interval * 1000);
      }
    }
  } catch { /* Default: dark, no auto-refresh error */ }
})();

// Fill the footer buttons with icons (text comes via updateBackupButton)
elRefresh.appendChild(createIcon("refresh"));
elRefresh.append(" Refresh");
updateBackupButton();
loadResources();
