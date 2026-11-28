# Architecture

## Current runtime

```text
Angular renderer (standalone)
   │ narrow window.repolens API (scan, analysis, explicit graph generation)
   ▼
Sandboxed CommonJS preload (contextBridge; Zod response validation)
   │ fixed invoke channels + validated progress events
   ▼
Electron ESM main (sender checks, Zod request validation, CSP)
   ├── ProjectManagementService ──► native folder picker / JSON project registry
   ├── AppSettingsService ────────► JSON settings file
   ├── ScanManagementService ─────► bounded JSON summaries + per-project scan LRU
   ├── AnalysisManagementService ─► per-project analysis LRU + graph invalidation
   └── GraphManagementService ────► explicit generation + project-keyed graph provider
             │ start/cancel                     │ start/cancel
             ▼                                  ▼
    Scan worker thread                Analysis worker thread
             │ NodeScanFileSystem                │ inventory-scoped NodeAnalysisFileSystem
             ▼                                  ▼
    @repolens/core scanner ─────────── @repolens/core static analysis
                                                 │ TypeScript Compiler API
                                                 ▼
                                        @repolens/language-support
                                                 │ AnalysisResult retained in main memory
                                                 ▼
                user action: graphs.generate(projectId, scanId, analysisId)
                                                 │ validates current scan/analysis
                                                 ▼
                                        @repolens/core graph engine

RepoLens CLI ─────────────────────► @repolens/core (foundation; no scan command)
Angular renderer ─────────────────► @repolens/shared
```

Scan and analysis workers never trigger graph construction. Only the explicit `graphs.generate` request validates the current completed scan and matching analysis before the main process calls the core graph engine.

There is no separate backend server. The Angular dev server is used only for renderer development; the production Electron window loads static Angular assets. Browser-only renderer runs do not receive filesystem access and report project/settings/scan functions as desktop-only.

## Package boundaries

- `apps/desktop/src` is browser code. It imports neither Node.js filesystem APIs nor Electron modules. Project, scan, static-analysis, and graph operations go through the typed preload bridge; no renderer code receives a Graphology instance.
- `apps/desktop/electron` is the trusted local application layer. The ESM main process owns the native folder picker, path validation, worker lifecycle, Node filesystem adapters, IPC, and local persistence; the sandboxed preload is emitted as CommonJS (`preload.cjs`).
- `apps/cli` is a Node.js executable foundation; it currently exposes version/help only and does not scan projects.
- `packages/shared` owns Zod-validated project, scan, static-analysis, import, settings, graph DTO/query/export/progress, history, and result contracts. It has no application-layer dependencies.
- `packages/core` contains the reusable scanner engine, bounded static-analysis pipeline, and in-memory graph engine. The scanner/analyzer use narrow filesystem/parser interfaces; graph algorithms consume shared `AnalysisResult` data. Core has no Angular, Electron, Cytoscape, or visualization dependency.
- `packages/language-support` implements the parser extension point with a TypeScript Compiler API parser for TypeScript/TSX/JavaScript/JSX syntax.
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
5. Main validates the result, persists a summary to scan history, retains the latest full result per project in a bounded 50-entry LRU cache, and returns that result to the renderer. Per-file metadata and hashes remain memory-only; history is summary-only.

The scanner never executes repository code, package scripts, shell commands, or dependency managers; it never modifies or uploads the imported repository. See [Scanner](SCANNING.md) for classifications, defaults, limits, ignore precedence, and known limitations.

## Static-analysis flow

1. The renderer calls `analysis.start(projectId, scanId)` only after a scan result is available. Main looks up the registered project and requires the exact current full `ScanResult` in the per-project `ScanManagementService` cache; it never starts another scan or substitutes a persisted summary.
2. Main creates a one-shot analysis worker and sends the project root and validated scan inventory. The worker checks the request, and `NodeAnalysisFileSystem` accepts only normalized relative paths present in the inventory and contained by the registered root.
3. `@repolens/core` selects eligible TypeScript/JavaScript source files, applies file/count/byte/result/config limits, and calls the registered `TypeScriptParser` from `@repolens/language-support`. Resolution is restricted to scanned file paths and scanned `tsconfig` baseUrl/path aliases; ambiguous targets are not guessed.
4. The worker sends schema-validated progress and a validated `AnalysisResult`. Cancellation is cooperative at async work boundaries. Main retains the latest validated result per project in a bounded 50-entry LRU cache and returns it to the renderer; neither the result nor source text is persisted.
5. Graph construction is explicit: the renderer calls `graphs.generate(projectId, scanId, analysisId)`. `GraphManagementService` requires an available registered project, its matching current completed scan, a matching completed/partial analysis, at least one analyzed source file, and an analyzed-file inventory contained in the scan's source inventory. It revalidates the current scan and analysis before publication; stale work returns a failed report without publishing.
6. The core builder uses only the validated shared analysis result and supports progress, cancellation, and host-provided event-loop yielding. The provider lease prevents superseded publication. Guarded IPC exposes the validated generation report and graph DTO queries, traversal, paths, cycles, metrics, and JSON. The project-details UI displays progress, counts, bounded actual nodes, and cycle paths; there is no full graph visualization or graph-specific cancel action.

Analysis is syntax extraction, not type checking or program execution. Phase 5 creates only evidence-backed containment, import, and export relationships; it does not infer calls, inheritance, API routes, or database models. See [Static Analysis](STATIC_ANALYSIS.md) and [Graph Engine](GRAPH_ENGINE.md).

## Persistence and settings

- `JsonProjectRepository` implements `ProjectRepository` and stores a version-1 registry at `app.getPath('userData')/project-registry.json`. The registry contains projects and the active project ID.
- `JsonSettingsRepository` implements a separate `SettingsRepository` and stores `settings.json` in the same application-data directory.
- `JsonScanHistoryRepository` stores a versioned `scan-history.json`, with at most 50 validated summary items per project. Full file lists and hashes are not persisted. `ScanManagementService` retains the latest full scan result per project in a 50-entry LRU memory cache so static analysis and explicit graph generation can reuse it. Validated analysis results use a separate 50-entry LRU memory cache; neither analyses, source text, nor graph data are persisted.
- `InMemoryGraphProvider` retains a bounded set of latest project graphs in process memory (default maximum 50 entries and six-hour inactivity/age limit). New analyses invalidate the prior graph; project removal and app shutdown dispose graphs. No Graphology graph is stored in the JSON registry/history or a database.
- Writes use a unique same-directory temporary file, restrictive file permissions, file sync, and rename. Malformed or schema-invalid JSON is moved to a timestamped quarantine path before the service falls back to safe defaults.
- These interfaces are the replacement seam for future persistence. SQLite/Drizzle and JSON-to-SQLite migration are not implemented.
- The saved theme is applied to the document root; a `system` preference defers to the operating system color-scheme preference. A configured default project is selected at application startup, but this does not trigger a scan.

## Shared contracts and IPC

`packages/shared` defines strict project, import-preview/result, settings, scan config/file/result/progress/history, analysis result/progress, graph node/edge/query/metrics/export/progress, and app-error schemas. Main validates every request; the preload validates every response and progress event before passing it to Angular. IPC channels and payload shapes are fixed and allowlisted; sender frame and top-level main-frame URLs must match the trusted renderer.

The renderer receives only project/scan/analysis IDs, normalized project-relative graph queries, and scan options. Filesystem paths remain in the registry/main process. Scan, analysis, and graph progress APIs return disposers; they do not expose `ipcRenderer`, Graphology, arbitrary channels, or unrestricted event listeners. Graph progress is sent only to the renderer that initiated `graphs.generate`. See [IPC architecture](IPC_ARCHITECTURE.md) for the complete API, boundary, and window protections.

## Angular migration

The original Angular 21 renderer, styles, assets, routing, and unit tests were copied into `apps/desktop` before configuration changes. The migrated app build and unit tests were verified before removing the duplicate root copy. Server-rendering entry points were removed because RepoLens uses Electron as its local application layer and does not need an Express/SSR backend.
