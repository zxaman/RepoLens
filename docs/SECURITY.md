# Security notes

RepoLens is in early development. The Electron boundary and local-first behavior are established before each repository-analysis capability is exposed.

## Reporting a vulnerability

Please do not publish sensitive vulnerability details in a public issue. Use GitHub's private vulnerability reporting for this repository when available. Include affected versions, reproduction steps, and impact. Do not include private source code or credentials in a report.

## Current security controls

- Electron uses context isolation, a sandboxed preload, and `nodeIntegration: false`.
- The renderer receives a narrow typed API; raw `ipcRenderer`, filesystem access, arbitrary paths, and shell commands are not exposed.
- Main-process IPC channels are explicitly allowlisted, payloads and responses are runtime-validated, and sender frames are checked. Scan progress is the only new event and is schema-validated; the preload returns a cleanup function.
- Renderer navigation and new windows are restricted; a restrictive Content Security Policy is installed.
- Project import uses Electron's native folder picker. Electron resolves symlinks, rejects filesystem roots and known system locations, checks directory access, and inspects only an allowlist of direct-entry marker names. Marker contents are not read during import.
- The reusable scanner in `packages/core` has no Angular/Electron dependency and receives filesystem access only through a narrow adapter owned by Electron. The renderer passes a project UUID and bounded options, never a path.
- Scans run in a cancellable worker thread. The scanner canonicalizes the selected root and candidate files, checks path containment before reads/hashes, skips links resolving outside the root, de-duplicates in-root targets, and detects directory cycles. Final-file reads/hashes use no-follow opens where the platform supports them.
- Ignore and package manifests are capped at 1 MiB each. SHA-256 is streamed in bounded chunks; the default per-file hash limit is 50 MiB (configurable up to 1 GiB). Oversized files receive metadata but are not hashed.
- Sensitive-looking paths (common environment, credential, and private-key names/directories) are excluded by default. Enabling them requires a scan-specific opt-in and a separate risk acknowledgement. Mandatory `.git` and `node_modules` exclusions cannot be overridden.
- RepoLens does not execute imported-project code, package scripts, shell commands, dependency managers, or installers. It does not initialize Git, modify/delete imported repository files, upload contents, or make backend/cloud/AI calls.
- The scanner reads only root `.gitignore`/`.repolensignore` and `package.json` manifests (capped at 1 MiB each) for allowlisted package evidence; other configuration evidence is filename-based. Eligible file bytes may be read for hashing, but raw file contents are not returned to the renderer or persisted.
- Phase 4 static analysis runs the TypeScript Compiler API in a separate worker. It accepts only the latest validated in-memory scan inventory, reads only normalized paths in that inventory under the registered root, bounds concurrent parsing to 4, source files to 10,000, individual source/config sizes, aggregate source/config bytes, TypeScript path mappings, and result collections, and discards source text when the worker exits. It parses syntax only: project code/plugins/scripts are never loaded or executed.
- Analysis result data and source text are not written to the registry, settings, or scan-history files. `analysis.start` requires the exact scan ID still held by the main-process scan manager; a saved summary cannot be used as a substitute.
- The scanner still has no total file/directory-count ceiling or result pagination; the scan result and worker input size can therefore scale with the included repository before static-analysis source limits are applied. Very large repositories still need performance testing.
- Project registrations, settings, and at most 50 scan summaries per project are stored locally in Electron `userData`. Full file inventories, hashes, and contents are not written to scan history. JSON writes use restrictive permissions, atomic replacement, and quarantine of malformed data.

## Ignore compatibility and limitations

`.gitignore` and `.repolensignore` support is a tested root-level subset, not full Git compatibility. Nested ignore files, every quoting/escaping rule, global excludes, Git index state, and all Git edge cases are not implemented. Precedence is documented in [Scanner](SCANNING.md). Sensitive protection is path/name based and cannot detect secrets embedded in ordinary source files. Technology detection records package/config evidence; it does not prove that dependencies are installed or used at runtime.

These controls are not a security audit or a guarantee of safety. The filesystem layer must continue to treat imported repositories as untrusted. Phase 4 AST parsing is syntax-only and covered by bounded-input, worker, IPC, and UI tests, but it still needs supported-platform Electron smoke testing. Archives, export, SQLite persistence, dependency graphs, and deeper analysis require dedicated review and tests before they are enabled.
