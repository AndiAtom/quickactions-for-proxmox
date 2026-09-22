# Changelog

## v0.3.0 — Public AMO Release (2026-09-19)

- **Published on the Firefox Add-ons (AMO) store** as a listed add-on — approved 2026-09-22.
  Store page: <https://addons.mozilla.org/firefox/addon/52707fd186ef4ffdb449/>
- **Theme pack — 6 new themes:** OLED (True Black), Dracula, Catppuccin Mocha, Tokyo Night, Solarized Dark and Monochrome — that's 9 themes total (Dark, Light, Nord + the six above), all switchable in the settings
- **Uptime in the guest list** — running guests show their uptime compactly in the meta line (e.g. `lxc 100 · ↑ 37d 12h`), updated live on auto-refresh
- **Overload indicator** — CPU/RAM bars turn red when usage exceeds 100% (e.g. a VM ballooning past its assigned RAM limit); bar width is clamped, the text still shows the real value
- Added `amo-metadata.json` (license + category) and `.web-extignore` for the listed submission
- Apache-2.0

> **Note:** v0.3.1 is an unlisted self-distribution build with code identical to v0.3.0 — it is not part of the store release.

## v0.2.8 (2026-09-19)

- **Uptime at a glance** — running guests show uptime in the meta line, stopped guests show type/ID only
- Uptime updates live on auto-refresh
- Updated all theme screenshots

## v0.2.7 (2026-09-19)

- **Overload indicator** — bars turn red above 100%, bar width clamped to the track
- Fixed Nord theme screenshot (no stale error banner, guest list identical across theme screenshots)
- Screenshot mock harness added to the repo for reproducible theme screenshots

## v0.2.6 (2026-09-14)

- **Nord theme** — polar-night + frost palette as third selectable theme (Dark, Light, Nord)
- Nord screenshot added to the README

## v0.2.5 — Initial Release (2026-09-10)

First public-ready release (unlisted self-distribution):

- **Live overview** — all guests of your Proxmox cluster with status, uptime, CPU and RAM usage
- **Power actions** — start, reboot and shutdown directly from the popup (with confirmation dialog)
- **Snapshots** — one click with automatic naming (`qa-YYYYMMDD-HHMMSS`)
- **Backups (vzdump)** — select guests via checkbox, backup to your configured storage, grouped per node
- **Auto-refresh** — configurable 5–60s or disabled, updates values in-place without flicker
- **Dark & Light theme** — Proxmox brand colors, switchable in settings
- **Flexible sorting** — alphabetically, by ID or by status, running guests first (optional)
- **Cluster support** — multi-node environments
