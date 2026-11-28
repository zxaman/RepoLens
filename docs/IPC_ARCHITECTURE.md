# Electron IPC architecture

The Angular renderer has no Node integration. `electron/preload.ts` exposes a frozen, narrow `window.repolens` API via `contextBridge`; the interface and request/result types live in `@repolens/shared`. The bridge does not expose `ipcRenderer`, arbitrary channel names, filesystem methods, shell commands, or arbitrary IPC arguments.

## Request path

1. Angular calls a typed bridge method.
2. Preload invokes a fixed channel from `electron/security/ipc-channels.ts`.
3. Electron main verifies that the invoking frame and top-level main frame are the trusted local renderer or exact packaged renderer file.
4. Main validates the channel and exact payload shape against the allowlist and Zod request schema, then calls a narrow service.
5. Project, settings, scan, analysis, and graph operations return shared `Result<T>` contracts with user-safe errors. App metadata returns validated version/platform values.
6. Preload validates every result or metadata response with shared runtime schemas before resolving it to Angular.

The renderer cannot provide a folder path. `projects.importFolder()` opens Electron's native directory picker; Electron resolves and validates the selected location and holds a short-lived selection token while the user reviews a preview. Registration is completed through `projects.confirmImport(selectionId)`.

For scans, Angular sends a registered `projectId` and optional strict `ScanConfig`. Main loads the trusted root path from the project registry, checks that the project still exists, enforces one active scan, and starts an Electron worker thread. File paths never come from renderer input. A separate `scans:cancel` request accepts only a UUID scan ID.

For static analysis, Angular sends only the registered `projectId` and the `scanId` it wants analyzed. Main requires that exact full `ScanResult` to still be the latest in-memory result for that project, then starts an analysis worker with the trusted project root and validated inventory. The worker's filesystem adapter allows reads only for normalized paths in that inventory. Analysis returns a schema-validated result and remains in bounded process memory. Graph construction is a separate `graphs.generate(projectId, scanId, analysisId)` operation: main validates the registered/available project, matching current completed scan, and matching completed/partial analysis before using the existing graph builder. Empty, failed, cancelled, stale, or out-of-inventory analysis returns a clear failed generation report and does not publish a graph. Graph progress is scoped to the invoking renderer; `analysis:cancel` applies only to active worker analysis.

Graph queries send only a registered `projectId` plus strict, normalized relative-path/query values. Main checks that the project remains registered and returns shared DTOs or deterministic validated JSON, never a Graphology object. Graph operations do not accept filesystem roots or arbitrary file paths.

## Approved API surface

- `app.getVersion()` and `app.getPlatform()` return Electron metadata.
- `projects.importFolder()`, `confirmImport(selectionId)`, and `cancelImport(selectionId)` provide native folder selection and explicit registration confirmation.
- `projects.list()`, `getById(id)`, and `getActive()` read project registry data.
- `projects.setActive(id)`, `refresh(id)`, and `remove(id)` update project-management state. Removal deletes the RepoLens registration and that project's saved scan summaries, never the project files.
- `settings.get()`, `update(settings)`, and `reset()` manage the separate local settings file.
- `scans.start(projectId, config?)` returns the validated full `ScanResult` for the current scan (per-file metadata and hashes included, no contents).
- `scans.cancel(scanId)` requests cooperative cancellation and returns a structured acknowledgement. The worker result is saved in history with its actual completion state; a completion already in flight can win the race with cancellation.
- `scans.onProgress(callback)` subscribes only to the approved `scans:progress` event and returns a cleanup function. Main sends progress only to the renderer that initiated that scan; malformed progress is dropped.
- `scans.getHistory(projectId)` and `getLatest(projectId)` read the project's bounded persisted summaries (up to 50), not full inventories.
- `analysis.start(projectId, scanId)` reuses the exact latest full in-memory scan result and returns the validated syntax-analysis result. It never starts a second scan or reads a summary as a substitute.
- `analysis.cancel(analysisId)` requests cooperative worker cancellation and returns a structured acknowledgement; the final result reports whether cancellation or completion won the race.
- `analysis.onProgress(callback)` subscribes only to the approved `analysis:progress` event and returns a cleanup function. Main sends progress only to the renderer that initiated the analysis; malformed progress is dropped.
- `graphs.generate(projectId, scanId, analysisId)` runs the explicit validated graph-generation action and returns a report with node/edge counts, resolved/unresolved/external dependencies, cycles, warnings, and a failure code/message when preconditions or construction fail. It never returns a project-only graph for empty analysis.
- `graphs.summary(projectId)`, `query(projectId, query)`, `dependencies(projectId, query)`, `shortestPath(projectId, query)`, and `cycles(projectId, query?)` return validated DTOs or `null` if no graph for the current scan/analysis is published.
- `graphs.exportJson(projectId)` returns a validated deterministic JSON string or `null`; `graphs.dispose(projectId)` clears the in-memory graph. No GraphML or graph file-save operation is exposed.
- `graphs.onProgress(callback)` subscribes only to the approved `graphs:progress` event during graph construction and returns a cleanup function. Main sends progress only to the initiating renderer; malformed progress is dropped and listener exceptions are isolated.

Phase 5 graph construction is available through the core engine, secure bridge, and a project-details generation/report panel with actual node and cycle data; it does not add a full graph visualization. Project import/open/refresh does not start a scan. See [Graph Engine](GRAPH_ENGINE.md) for its limits, node/edge semantics, algorithms, and explicit non-goals.

## Validation and errors

- Main validates channel names, exact payload objects, UUID project/scan/analysis IDs, strict settings, scan options, and sensitive-file risk acknowledgement before invoking services.
- Worker messages/results and progress are parsed against the shared schemas. Preload validates main-process responses and progress events before Angular receives them.
- Known filesystem, project, scan/analysis-concurrency, unavailable-inventory, and lifecycle errors map to structured, user-safe `AppError` values. Unexpected errors are logged in the main process and return a generic message without exposing stack traces or file contents.
- IPC from an untrusted frame is rejected before payload handling. Scan, analysis, or graph progress-listener exceptions cannot interrupt their work.

## Window protections

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and `webSecurity: true`.
- Main-frame-only IPC sender checks.
- Navigation limited to the trusted local development origin or exact packaged renderer file.
- New windows denied.
- CSP disallows remote scripts, objects, frames, forms, and arbitrary connections. Development CSP adds only the local Angular HMR websocket endpoints.

Keep main-process and preload entry points separate. Any new capability needs a shared contract, runtime request/response validation, a sender check, a narrow preload method, and tests before it can be used by the renderer.
