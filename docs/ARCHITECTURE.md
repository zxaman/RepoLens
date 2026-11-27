# Architecture

## Phase 1 runtime

```text
Angular renderer
   │ typed window.repolens API
   ▼
Electron preload (contextBridge; sandboxed)
   │ fixed invoke channels only
   ▼
Electron main (sender checks, Zod validation, CSP)
   ├── app metadata (implemented)
   ├── project / scan / settings contracts (explicitly not implemented)
   └── future adapters: core, database, export, optional AI

RepoLens CLI ───────────────► @repolens/core ──► @repolens/shared
Angular renderer ─────────────────────────────► @repolens/shared
```

There is no separate backend server. The Angular dev server is used only for renderer development; the production Electron window loads static Angular assets.

## Package boundaries

- `apps/desktop/src` is browser code. It does not import Node.js filesystem APIs or Electron modules.
- `apps/desktop/electron` is the trusted local application layer. It exposes only explicitly permitted IPC operations.
- `apps/cli` is a Node.js executable and will call the same analysis package as the desktop main process.
- `packages/shared` owns Zod-validated contracts and has no application-layer dependencies.
- `packages/core` depends only on shared contracts. Its analyzer and pipeline interfaces are framework-independent.
- `packages/language-support` defines the extension point for parsers; it contains no parser implementation yet.
- `packages/database` defines the Drizzle/SQLite connection boundary; it has no schema, driver initialization, migrations, or persistence operations yet.
- `packages/export` defines future export contracts and stays separate from the UI.
- `packages/ai` defines an optional provider contract. It is not a startup dependency and contains no network provider.

Internal imports use workspace package names and package exports, not cross-package source-relative paths. Root build scripts build shared contracts first and then build consumers.

## Angular migration

The original Angular 21 renderer, styles, assets, routing, and unit tests were copied into `apps/desktop` before configuration changes. The migrated app build and unit tests were verified before removing the duplicate root copy. Server-rendering entry points were removed because RepoLens uses Electron as its local application layer and does not need an Express/SSR backend.
