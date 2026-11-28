# Architecture

## Current runtime

```text
Angular renderer (standalone, browser-only)
   │ narrow window.repolens API
   ▼
Electron preload (contextBridge; sandboxed; Zod response validation)
   │ fixed invoke channels + one validated progress event
   ▼
Electron main (sender checks, Zod request validation, CSP)
   ├── ProjectManagementService ──► native folder picker / JSON project registry
   ├── AppSettingsService ────────► JSON settings file
   └── ScanManagementService ─────► bounded JSON scan-history summaries
                  │ start/cancel
                  ▼
          Electron worker thread
                  │ narrow NodeScanFileSystem adapter
                  ▼
          @repolens/core scanner ──► @repolens/shared contracts

RepoLens CLI ─────────────────────► @repolens/core (foundation; no scan command)
Angular renderer ─────────────────► @repolens/shared
```

There is no separate backend server. The Angular dev server is used only for renderer development; the production Electron window loads static Angular assets. Browser-only renderer runs do not receive filesystem access and report project/settings/scan functions as desktop-only.

## Package boundaries

- `apps/desktop/src` is browser code. It imports neither Node.js filesystem APIs nor Electron modules. Project and scan operations go through the typed preload bridge.
- `apps/desktop/electron` is the trusted local application layer. It owns the native folder picker, path validation, worker lifecycle, Node filesystem adapter, IPC, and local persistence.
- `apps/cli` is a Node.js executable foundation; it currently exposes version/help only and does not scan projects.
- `packages/shared` owns Zod-validated project, scan, import, settings, progress, history, and result contracts. It has no application-layer dependencies.
- `packages/core` contains the reusable scanner engine and the earlier analysis-context contracts. The scanner depends on a narrow `ScanFileSystem` interface and shared schemas, not Angular, Electron, or Node APIs.
- `packages/language-support` defines a parser extension point; no AST/symbol parser is registered.
- `packages/database` defines the Drizzle/SQLite connection boundary; it has no schema, driver initialization, migrations, or persistence operations yet.
- `packages/export` defines future export contracts and stays separate from the UI.
- `packages/ai` defines an optional provider contract. It is not a startup dependency and contains no network provider.

Internal imports use workspace package names and package exports, not cross-package source-relative paths. Root build scripts build shared contracts first and then consumers.

## Project-management flow

1. The renderer calls `projects.importFolder()` without sending a path.
2. Electron main opens the native directory picker. Cancellation is a typed result.
3. Electron resolves the selected folder with `realpath`, verifies that it is an accessible directory, and rejects filesystem roots and known system locations. Symlink selections are resolved before checks.
4. Only direct, allowlisted marker names are inspected with filesystem metadata calls. Marker files are never opened or parsed; Git/package metadata is optional and is not required to register a folder.
5. A preview is returned with a short-lived selection token. The user explicitly confirms registration; Electron revalidates the folder and checks duplicates again before writing.
6. Duplicate keys use normalized canonical paths, including Windows case folding and trailing-separator normalization. The renderer cannot submit arbitrary filesystem paths.
7. Project list/get/refresh operations validate local availability and update basic metadata only. Unavailable registrations are retained. Removing a registration never deletes the imported folder.

Project registration and metadata refresh do not trigger a scan. The scan button is an explicit action from the project-details route.

## Scanner flow

1. The renderer calls `scans.start(projectId, config?)`; it cannot supply `rootPath`. Main validates the UUID and strict scan configuration, looks up the registered project, enforces one active scan, and creates a worker thread.
2. The worker validates its one-shot request, creates the Electron-owned `NodeScanFileSystem` adapter, and calls the framework-independent `scanProject` engine from `@repolens/core`.
3. The core engine canonicalizes and verifies the root, reads bounded root ignore files, walks directories iteratively, checks symlink targets against the canonical root, classifies files, computes extension-based language statistics, reads bounded `package.json` evidence, and streams eligible files through SHA-256 hashing.
4. The worker sends throttled, schema-validated progress and a schema-validated `ScanResult` back to main. Cancellation travels from a fixed IPC channel to the worker and aborts the core engine at asynchronous work boundaries.
5. Main validates the result, persists a summary to scan history, and returns the full current result to the renderer. Per-file metadata and hashes stay in memory only while the project page is open; history is summary-only.

The scanner never executes repository code, package scripts, shell commands, or dependency managers; it never modifies or uploads the imported repository. See [Scanner](SCANNING.md) for classifications, defaults, limits, ignore precedence, and known limitations.

## Persistence and settings

- `JsonProjectRepository` implements `ProjectRepository` and stores a version-1 registry at `app.getPath('userData')/project-registry.json`. The registry contains projects and the active project ID.
- `JsonSettingsRepository` implements a separate `SettingsRepository` and stores `settings.json` in the same application-data directory.
- `JsonScanHistoryRepository` stores a versioned `scan-history.json`, with at most 50 validated summary items per project. Full file lists and hashes are not persisted.
- Writes use a unique same-directory temporary file, restrictive file permissions, file sync, and rename. Malformed or schema-invalid JSON is moved to a timestamped quarantine path before the service falls back to safe defaults.
- These interfaces are the replacement seam for future persistence. SQLite/Drizzle and JSON-to-SQLite migration are not implemented.
- The saved theme is applied to the document root; a `system` preference defers to the operating system color-scheme preference. A configured default project is selected at application startup, but this does not trigger a scan.

## Shared contracts and IPC

`packages/shared` defines strict project, import-preview/result, settings, scan config/file/result/progress/history, and app-error schemas. Main validates every request; the preload validates every response and the progress event before passing it to Angular. IPC channels and payload shapes are fixed and allowlisted; sender frame and top-level main-frame URLs must match the trusted renderer.

The renderer receives only project IDs and scan options. Filesystem paths remain in the registry/main process. The progress API returns a disposer; it does not expose `ipcRenderer`, arbitrary channels, or unrestricted event listeners. See [IPC architecture](IPC_ARCHITECTURE.md) for the full boundary and window protections.

## Angular migration

The original Angular 21 renderer, styles, assets, routing, and unit tests were copied into `apps/desktop` before configuration changes. The migrated app build and unit tests were verified before removing the duplicate root copy. Server-rendering entry points were removed because RepoLens uses Electron as its local application layer and does not need an Express/SSR backend.
