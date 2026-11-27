# Security notes

RepoLens is in early development. The Electron boundary and local-first behavior are established before recursive repository analysis is added.

## Reporting a vulnerability

Please do not publish sensitive vulnerability details in a public issue. Use GitHub's private vulnerability reporting for this repository when available. Include affected versions, reproduction steps, and impact. Do not include private source code or credentials in a report.

## Current security controls

- Electron uses context isolation, a sandboxed preload, and `nodeIntegration: false`.
- The renderer receives a narrow typed API; raw `ipcRenderer`, filesystem access, arbitrary paths, and shell commands are not exposed.
- Main-process IPC channels are explicitly allowlisted, payloads and responses are runtime-validated, and sender frames are checked.
- Renderer navigation and new windows are restricted; a restrictive Content Security Policy is installed.
- Project import uses Electron's native folder picker. Electron resolves symlinks, rejects filesystem roots and known system locations, checks directory access, and inspects only an allowlist of direct-entry marker names. Marker contents are not read.
- Project registrations and settings are persisted under Electron's local `userData` directory. Removing a registration does not delete or modify the imported folder.
- No project scripts are executed, dependencies installed, repository contents recursively scanned, source uploaded, or external service/AI calls performed in v0.2.0.

These controls are not a security audit or a guarantee of safety. Future scanning, archive import, SQLite persistence, and export functionality must treat their inputs as untrusted and receive dedicated review and tests.
