# Proxmox QuickActions

A Firefox extension that puts your entire Proxmox VE cluster in your toolbar — see the status of all your VMs and containers at a glance and control them with one click.

![Dark Theme](screenshots/popup-dark.png)

## Features

- **Live overview** — All guests of your Proxmox cluster with status, uptime, CPU and RAM usage
- **Power actions** — Start, reboot and shutdown directly from the popup (with confirmation dialog)
- **Snapshots** — One click creates a snapshot with automatic naming
- **Backup (vzdump)** — Select guests via checkbox and back them up to your configured storage
- **Cluster support** — Multi-node environments (backups are grouped per node automatically)
- **Dark & Light theme** — Switchable in the settings
- **Flexible sorting** — Alphabetically, by ID or by status, with running guests first (optional)

![Light Theme](screenshots/popup-light.png)

## Setup

### 1. Create an API token in Proxmox

In your Proxmox web interface:

1. Go to **Datacenter → Permissions → API Tokens**
2. Click **Add**, choose a user and a token name (e.g. `quickactions`)
3. Note the full token ID — it looks like `user@realm!tokenname`
4. Copy the token secret (shown only once)

The token needs permissions for: `VM.Audit`, `VM.PowerMgmt`, `VM.Snapshot`, `VM.Backup` and `Datastore.AllocateSpace` (the built-in `PVEAdmin` role covers all of these).

### 2. Configure the extension

1. Open the extension options (right-click the toolbar icon → *Manage Extension* → *Extension Options*)
2. Enter your Proxmox URL, token ID and token secret
3. Click **Test connection** — Firefox will ask for permission to access your Proxmox server (this happens only once)
4. Select your backup storage from the dropdown

> **Note:** If your Proxmox server uses a self-signed certificate, open the URL once in a regular browser tab and accept the certificate before testing the connection.

## Requirements

- Proxmox VE 7+ (tested with PVE 9.2)
- Firefox 140+
- An API token with the permissions listed above

## Privacy

This extension collects and transmits **no data**. All credentials stay locally in your browser (`browser.storage.local`). Communication happens exclusively between your browser and your Proxmox server — no third parties involved.

## Development

```bash
npm install -g web-ext
web-ext lint    # validate
web-ext run     # test in Firefox (hot reload)
web-ext sign    # sign for distribution
```

## License

[Apache License 2.0](LICENSE)
