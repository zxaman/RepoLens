# RepoLens Project Status

- **Version:** v0.2.0
- **Current phase:** Project Management
- **Overall status:** v0.2.0 project-management features are implemented. All available automated verification passes; the Electron GUI and native picker could not be launched in this sandbox.

## Completed

### Foundation (v0.1.0)

- [x] Preserved the Angular 21/npm workspace/Electron/shared-package architecture and separate browser/Electron TypeScript projects.
- [x] Added the sandboxed Electron shell, narrow typed preload, sender/frame validation, CSP, IPC allowlisting, and shared Zod contract foundations.
- [x] Added the CLI executable foundation (`--version` / `--help`) and core, language-support, database, export, and optional AI package interfaces.

### Project management (v0.2.0)

- [x] Added shared runtime-validated project, import, settings, and structured-result schemas.
- [x] Added native Electron directory selection; canonical path validation; rejection of filesystem roots and known system directories; optional top-level marker detection; and explicit import preview/confirmation.
- [x] Added short-lived selection tokens, canonical duplicate checks (including symlink resolution and Windows casing), and serialized registry writes.
- [x] Added a versioned JSON project registry and a separate settings file in Electron `userData`, with repository abstractions, atomic replacement, and malformed-file quarantine.
- [x] Added project import, list, get, activation/switching, metadata refresh, unavailable-folder preservation, and registration-only removal.
- [x] Added sender-guarded project/settings IPC and a narrow preload API with runtime payload/response validation and structured user-safe errors.
- [x] Added welcome, projects, project-details, and settings routes/screens. Project details truthfully report “Not scanned yet”; no analysis metrics or detected languages/frameworks are fabricated.
- [x] Added persistent theme, default-project, remove-confirmation, and recent-project settings. Explicit theme selection changes the renderer theme.
- [x] Added temporary-directory persistence/path/import tests, shared-schema tests, preload/IPC tests, Angular shell/default-project tests, and a theme behavior test.
- [x] Updated README, changelog, architecture/IPC/security documentation, roadmap, and added `docs/PROJECT_MANAGEMENT.md`.

## Verification

| Check                      | Result                                                                                                                                                                                                               |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci`                   | Passed earlier in this session; installed 590 packages. Dependency audit reported 19 moderate development-tool findings.                                                                                             |
| `npm run build`            | Passed for packages, CLI, Electron TypeScript/preload bundle, and production Angular renderer. Angular emitted an initial-chunk budget warning: 724.34 kB raw versus a 500 kB budget (estimated transfer 151.68 kB). |
| `npm run typecheck`        | Passed for shared/workspace packages, CLI, Electron, and Angular strict templates.                                                                                                                                   |
| `npm test`                 | Passed: 17 Vitest files / 41 tests and 2 Angular spec files / 4 tests.                                                                                                                                               |
| `npm run lint`             | Passed with zero warnings/errors.                                                                                                                                                                                    |
| `npm run format:check`     | Passed.                                                                                                                                                                                                              |
| CLI `--version` / `--help` | Passed; the CLI reports v0.2.0 and has no scan command.                                                                                                                                                              |
| Electron GUI/native picker | **Not verified**; the environment could not download Electron's native binary and has no display server.                                                                                                             |

## Environmental limitations and known issues

- The Electron JavaScript package and typings install, but the native Linux binary download fails in this sandbox because the release artifact host is outside the permitted outbound host list. The sandbox also has no `DISPLAY` or X server. Main/preload compilation and IPC tests do **not** prove that the desktop window or native folder picker launches.
- The production dependency audit previously reported zero vulnerabilities; the 19 moderate findings are in the Angular 21 development-tool dependency tree. Suggested automated fixes require major framework/tooling upgrades, so no forced Angular upgrade was made.
- The production Angular build passes but exceeds the configured initial bundle budget; the transfer-size estimate is smaller due to compression. Bundle tuning can be considered separately.

## Scope and architectural decisions

- The v0.2.0 import flow does not recursively scan folders, read source contents, initialize Git, execute scripts, install dependencies, modify/delete repository files, upload source, or call cloud/AI services.
- Angular remains standalone and browser-only; filesystem operations and local persistence belong to Electron main and are reachable only through the approved preload API.
- v0.2.0 persistence is JSON-backed in Electron `userData`: `project-registry.json` and separate `settings.json`. Repository interfaces provide a future adapter seam; SQLite/Drizzle and JSON-to-SQLite migration are explicitly deferred.
- Unavailable project registrations are retained. Removing a project removes only the RepoLens record.
- Scan-status IPC is an explicit `NOT_IMPLEMENTED` result; no fake scan results, dashboard metrics, language/framework metadata, or charts are present.
- Node/Angular versions remain on the Phase 1-compatible toolchain; no destructive rewrite or forced Angular major upgrade was introduced.

## Remaining verification

- [ ] On a supported graphical machine with access to Electron's binary download host, launch `npm run dev:desktop`; smoke-test native folder selection, import/cancel/duplicate handling, persistence across restarts, removal without repository changes, and settings/theme persistence.

## Next milestone

**v0.3.0 — Scanner (future):** design bounded, privacy-preserving scan discovery and progress only after a separate implementation/security review. Do not treat project registration or metadata refresh as scanning.
