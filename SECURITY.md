# Security policy

RepoLens is in early development. The Electron boundary and local-first behavior are being established before repository analysis is added.

## Reporting a vulnerability

Please do not publish sensitive vulnerability details in a public issue. Use GitHub's private vulnerability reporting for this repository when available. Include affected versions, reproduction steps, and impact. Do not include private source code or credentials in a report.

## Current security controls

- Electron uses context isolation, a sandboxed preload, and `nodeIntegration: false`.
- The renderer receives a narrow API; raw `ipcRenderer`, filesystem access, and shell commands are not exposed.
- Main-process IPC channels are explicitly allowlisted, payloads are validated, and sender origins/frames are checked.
- Renderer navigation and new windows are restricted; a restrictive Content Security Policy is installed.
- No project scripts, dependency installation, source uploads, AI calls, or external service calls are performed by this foundation.

These controls are not a security audit or a guarantee of safety. Future import, archive, scanning, database, and export functionality must treat its inputs as untrusted and receive dedicated review and tests.
