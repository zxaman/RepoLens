# Architecture

## v0.2.0 runtime

```text
Angular renderer (standalone, browser-only)
   │ typed window.repolens API
   ▼
Electron preload (contextBridge; sandboxed)
   │ fixed invoke channels only
   ▼
Electron main (sender checks, Zod validation, CSP)
   ├── app metadata
   ├── ProjectManagementService ──► native folder picker
   │          │
   │          └── ProjectRepository ──► versioned JSON registry in userData
   ├── AppSettingsService ──────────► separate JSON settings file in userData
   └── scan status ─────────────────► explicit NOT_IMPLEMENTED result

RepoLens CLI ───────────────► @repolens/core ──► @repolens/shared
Angular renderer ─────────────────────────────► @repolens/shared

Future adapters: scanner, SQLite/Drizzle, export, optional AI
```

There is no separate backend server. The Angular dev server is used only for renderer development; the production Electron window loads static Angular assets. Browser-only renderer runs do not receive filesystem access and report project/settings functions as desktop-only.

## Package boundaries

- `apps/desktop/src` is browser code. It imports neither Node.js filesystem APIs nor Electron modules. Project and settings operations go through the typed preload bridge.
- `apps/desktop/electron` is the trusted local application layer. It owns the native folder picker, path validation, IPC, and local persistence.
- `apps/cli` is a Node.js executable foundation; it does not scan projects yet.
- `packages/shared` owns Zod-validated contracts and has no application-layer dependencies.
- `packages/core` depends only on shared contracts. Its analyzer and pipeline interfaces are framework-independent; no Phase 2 scanner is wired into the desktop.
- `packages/language-support` defines the extension point for parsers; it contains no parser implementation yet.
- `packages/database` defines the Drizzle/SQLite connection boundary; it has no schema, driver initialization, migrations, or persistence operations yet.
- `packages/export` defines future export contracts and stays separate from the UI.
- `packages/ai` defines an optional provider contract. It is not a startup dependency and contains no network provider.

Internal imports use workspace package names and package exports, not cross-package source-relative paths. Root build scripts build shared contracts first and then build consumers.

## Project-management flow

1. The renderer calls `projects.importFolder()` without sending a path.
2. The Electron main process opens the native directory picker. A cancellation is returned as a typed cancellation result.
3. Electron resolves the selected folder with `realpath`, verifies that it is an accessible directory, and rejects filesystem roots and known system locations. Symlink selections are resolved before checks.
4. Only direct, allowlisted marker names are inspected with filesystem metadata calls. Marker files are never opened or parsed; Git/package metadata is optional and is not required to register a folder.
5. A preview is returned with a short-lived selection token. The user explicitly confirms registration; Electron revalidates the folder and checks duplicates again before writing.
6. Duplicate keys use normalized canonical paths, including Windows case folding and trailing-separator normalization. The renderer cannot submit arbitrary filesystem paths.
7. Project list/get/refresh operations validate local availability and update basic metadata only. Unavailable registrations are retained. Removing a registration deletes only RepoLens metadata; it never deletes the folder.

The flow does not recursively walk a project, read source code, initialize Git, execute scripts, install dependencies, or upload data. The project-details screen displays an explicit “Not scanned yet” state.

## Persistence and settings

- `JsonProjectRepository` implements the `ProjectRepository` interface and stores a version-1 registry at `app.getPath('userData')/project-registry.json`. The registry contains projects and the active project ID.
- `JsonSettingsRepository` implements a separate `SettingsRepository` and stores `settings.json` in the same application-data directory. Settings cover theme, default project ID, removal confirmation, and recent-project count.
- Writes use a unique same-directory temporary file, restrictive file permissions, file sync, and rename. Malformed or schema-invalid JSON is renamed to a timestamped quarantine path before the service falls back to safe defaults.
- These interfaces are the replacement seam for future persistence. Phase 2 remains JSON-backed: no SQLite driver, Drizzle schema, migration, or JSON-to-SQLite migration is implemented.
- The saved theme is applied to the document root; a `system` preference defers to the operating system color-scheme preference. A configured default project is selected at application startup, but this does not trigger a scan.

## Shared contracts and IPC

`packages/shared` defines strict project, import-preview/result, settings, and result schemas. The main process validates request payloads and the preload validates every response before resolving it to Angular. IPC channels and payload shapes are fixed and allowlisted; sender frame and top-level main-frame URLs must match the trusted renderer.

The scan-status channel remains registered only to return an explicit `NOT_IMPLEMENTED` result. It is not used to invent scan results or metrics. See [IPC architecture](IPC_ARCHITECTURE.md) for the channel boundary and window protections.

## Angular migration

The original Angular 21 renderer, styles, assets, routing, and unit tests were copied into `apps/desktop` before configuration changes. The migrated app build and unit tests were verified before removing the duplicate root copy. Server-rendering entry points were removed because RepoLens uses Electron as its local application layer and does not need an Express/SSR backend.
