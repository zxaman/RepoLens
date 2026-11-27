# Electron IPC architecture

The Angular renderer has no Node integration. `electron/preload.ts` exposes `window.repolens` via `contextBridge`; the interface lives in `@repolens/shared`. The bridge provides only fixed methods for app version/platform, project listing, scan status, and settings. It does not expose `ipcRenderer`, arbitrary channel names, filesystem methods, shell commands, or arbitrary IPC arguments.

## Request path

1. Renderer calls a typed API method.
2. Preload invokes one literal channel from the desktop allowlist.
3. Main validates the channel payload (all Phase 1 operations accept no payload) and verifies that the top-level sender is the trusted local renderer or exact packaged `index.html`.
4. Main returns a plain typed value or a shared `Result<T>` error contract.
5. Preload validates the response with the shared Zod schemas before resolving it to Angular.

Application version and platform are returned by the Electron main process. Project, scan, and settings calls return an explicit `NOT_IMPLEMENTED` result rather than fake empty data. Graph, export, and database IPC channels are not registered until their operations exist.

## Window protections

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and `webSecurity: true`.
- Main-frame-only IPC sender checks.
- Navigation limited to the trusted local development origin or exact packaged renderer file.
- New windows denied.
- CSP disallows remote scripts, objects, frames, forms, and arbitrary connections. Development CSP adds only the local Angular HMR websocket endpoints.

Keep main-process and preload entry points separate. Any new channel needs a shared contract, runtime payload/response validation, a sender check, a preload method, and tests before it can be used by the renderer.
