# RepoLens Project Status

- **Version:** v0.1.0
- **Current phase:** Foundation
- **Overall status:** Foundation implementation is in place; Electron runtime launch remains unverified in this network-restricted, headless sandbox.

## Completed

- [x] Inspected the existing Angular app and runtime versions before changes.
- [x] Confirmed Angular 21 compatibility: Angular CLI 21.2.31, Angular framework 21.2.26, TypeScript 5.9.3, Node 22.22.3, npm 10.9.8.
- [x] Migrated the existing Angular renderer, source assets, routes, styles, and tests into `apps/desktop`; replaced its generated Angular CLI starter screen (not product UI) with the RepoLens foundation welcome screen.
- [x] Verified the migrated Angular production build and unit tests before removing the duplicate root Angular app.
- [x] Replaced the Bun workspace metadata/lockfile with npm workspaces and a repository-level npm lockfile.
- [x] Added strict, separate TypeScript configurations for Angular, Electron, CLI, and packages.
- [x] Added the Angular 21 standalone welcome screen; it shows the runtime version only when returned by Electron IPC and shows no fabricated metrics.
- [x] Added Electron main/preload entry points, a sandboxed typed bridge, Zod response validation, IPC payload/channel allowlisting, sender/frame checks, navigation restrictions, and CSP.
- [x] Added app-version/platform IPC. A unit round-trip test covers validated metadata through the registered main handler and typed preload API; Electron itself cannot be launched here. Project, scan-status, and settings contracts return explicit `NOT_IMPLEMENTED` results; no fake data is returned.
- [x] Added package entry points for shared, core, language support, SQLite/Drizzle, export, and optional AI contracts.
- [x] Added Commander CLI executable foundation. `--version` and `--help` work; no analysis commands are claimed as implemented.
- [x] Added ESLint, Prettier, Vitest, package tests, docs, MIT license, security guidance, and this status file.

## Build status

| Check                      | Result                                                                                               |
| -------------------------- | ---------------------------------------------------------------------------------------------------- |
| `npm install`              | Passed; npm lockfile generated                                                                       |
| `npm run build`            | Passed; all packages, CLI, Electron TypeScript/preload bundle, and Angular production renderer build |
| `npm run build:cli`        | Passed                                                                                               |
| `npm run build:desktop`    | Passed for compilation and renderer build                                                            |
| `npm run typecheck`        | Passed for packages, CLI, Electron, and Angular                                                      |
| `npm test`                 | Passed: 22 Vitest tests and 2 Angular tests                                                          |
| `npm run lint`             | Passed                                                                                               |
| `npm run format:check`     | Passed                                                                                               |
| CLI `--version` / `--help` | Passed; version comes from CLI package metadata                                                      |
| Electron GUI launch        | **Not verified**; see environmental limitations                                                      |

## Environmental limitations and known issues

- The Electron JavaScript package and typings install, but its native Linux binary download fails in this sandbox because Electron's release artifact host is outside the permitted outbound host list. `electron --version` reports an incomplete Electron installation. The main/preload code compiles, but the Electron window has **not** been launched; do not treat runtime launch as verified until run on a machine/network that can download the Electron binary.
- This sandbox has no `DISPLAY` and no X server, so it cannot display a desktop window even if the Electron binary is supplied.
- `npm audit` reports 19 **moderate development-tool** findings from the Angular 21 CLI and Angular ESLint 21 dependency tree. The production dependency audit (`npm audit --omit=dev`) reports zero vulnerabilities. The audit's suggested fixes require Angular CLI/Angular ESLint major upgrades, which would leave the requested Angular 21 foundation; this is recorded rather than silently upgrading the framework.
- Angular Material, Tailwind, actual scanning/parsing, database driver/persistence, project registration, graph/export IPC, CLI analysis commands, export generation, and AI providers are intentionally deferred.

## Architectural decisions

- npm workspaces are used; stale Bun metadata was removed.
- The existing Angular 21 app was copied into the desktop workspace, built and tested there, then the duplicate root app was removed. SSR/Express files were not carried forward because Electron is the local application layer and no backend server is permitted.
- Angular and Electron TypeScript projects are separate. The renderer receives no Node.js APIs.
- The Electron preload bundle is single-file so `sandbox: true` does not require arbitrary local module loading.
- Production renderer HTML uses a self-only connection policy; the local Angular dev websocket allowance lives only in the development index.
- Zod is aligned across the desktop/shared boundary to preserve a single runtime schema type identity.
- No native SQLite driver, tables, migrations, or persistence operations are added before the persistence milestone.
- Electron/Angular Material/Tailwind features are not marked complete based on package scaffolding alone.

## In progress

- Phase 1 code and documentation are complete. Electron GUI startup remains blocked by the environment and is not marked complete.

## Pending

- On a supported graphical machine with access to Electron's binary download host, finish the Electron binary download and run `npm run dev:desktop`; verify the real app-version round trip.
- Begin v0.2.0 project management only after Phase 1's Electron runtime startup is verified.

## Next milestone

**v0.2.0 — Project Management:** local folder import, project registration, recent-project listing, and project metadata. Keep projects and analysis data outside the imported repository and do not execute its scripts.
