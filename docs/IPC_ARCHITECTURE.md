# Electron IPC architecture

The Angular renderer has no Node integration. `electron/preload.ts` exposes a frozen, narrow `window.repolens` API via `contextBridge`; the interface and request/result types live in `@repolens/shared`. The bridge does not expose `ipcRenderer`, arbitrary channel names, filesystem methods, shell commands, or arbitrary IPC arguments.

## Request path

1. Angular calls a typed bridge method.
2. Preload invokes a fixed channel from `electron/security/ipc-channels.ts`.
3. Electron main verifies that the invoking frame and top-level main frame are the trusted local renderer or exact packaged renderer file.
4. Main validates the channel and payload against the allowlist and Zod request schema, then calls a narrow service.
5. Project and settings handlers return a shared `Result<T>` contract with user-safe errors. App metadata returns validated version/platform values.
6. Preload validates each result or metadata response with the shared runtime schemas before resolving it to Angular.

The renderer cannot provide a folder path. `projects.importFolder()` opens Electron's native directory picker; Electron resolves and validates the selected location and holds a short-lived selection token while the user reviews a preview. Registration is completed through `projects.confirmImport(selectionId)`. Settings and project IDs are validated before use.

## Approved API surface

- `app.getVersion()` and `app.getPlatform()` return Electron metadata.
- `projects.importFolder()`, `confirmImport(selectionId)`, and `cancelImport(selectionId)` provide native folder selection and explicit registration confirmation.
- `projects.list()`, `getById(id)`, and `getActive()` read project registry data.
- `projects.setActive(id)`, `refresh(id)`, and `remove(id)` update project-management state. Removal deletes only the RepoLens registration.
- `settings.get()`, `update(settings)`, and `reset()` manage the separate local settings file.
- `scans.getStatus()` remains an explicit `NOT_IMPLEMENTED` result. No scan is implied by project import, open, list, or refresh.

The channel allowlist currently contains only these methods. Graph, export, and database IPC channels are not registered until their operations exist.

## Validation and errors

- Main validates channel names and exact request payload shapes (including UUID project and selection IDs); settings payloads use the shared strict schema.
- Preload validates returned project, import, settings, error, and scan-status data at runtime. Invalid main-process responses reject instead of flowing into Angular.
- Known filesystem and project errors are mapped to structured, user-safe `AppError` values. Unexpected errors are logged in the main process and return a generic message without exposing stack traces or arbitrary filesystem details.
- IPC from an untrusted frame is rejected before payload handling.

## Window protections

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and `webSecurity: true`.
- Main-frame-only IPC sender checks.
- Navigation limited to the trusted local development origin or exact packaged renderer file.
- New windows denied.
- CSP disallows remote scripts, objects, frames, forms, and arbitrary connections. Development CSP adds only the local Angular HMR websocket endpoints.

Keep main-process and preload entry points separate. Any new capability needs a shared contract, runtime request/response validation, a sender check, a narrow preload method, and tests before it can be used by the renderer.
