# Contributing to QuickActions for Proxmox Virtual Environment

Thanks for your interest in contributing! This is a small project, so the process is lightweight.

## Reporting Bugs

Open a [GitHub Issue](https://github.com/AndiAtom/quickactions-for-proxmox/issues) and include:

- Proxmox VE version
- Firefox version
- Steps to reproduce
- What you expected vs. what happened
- Any error messages from the extension's background console (`about:debugging` → Inspect)

## Feature Requests

Open an issue with the `enhancement` label. Keep it specific — describe the use case, not just the solution.

## Pull Requests

1. Fork the repo and create a branch from `master`
2. Make your changes — keep the code style consistent (plain JS, no build step, no `innerHTML` with dynamic values)
3. Run `web-ext lint` — it should pass with 0 errors
4. Test with `web-ext run` against a real Proxmox VE instance
5. Open a PR with a clear description of what and why

## Code Style

- **Plain JavaScript** — no TypeScript, no bundler, no transpilation
- **DOM API** for all dynamic content — no `innerHTML` with user-controlled or variable data (web-ext lint flags it)
- **CSS variables** for theming — all colors flow through `--accent`, `--bg`, etc.
- **Comments in English** for public-facing code, German is fine for internal notes

## Testing

```bash
npm install -g web-ext
web-ext lint          # must pass
web-ext run           # loads the extension in a temporary Firefox profile
```

You'll need a Proxmox VE instance and an API token to test against.
