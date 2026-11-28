# RepoLens Project Status

- **Manifest version:** `0.2.0` (the v0.3.0 scanner milestone is implemented but remains unreleased; see `CHANGELOG.md`).
- **Current milestone:** v0.3.0 — Scanner.
- **Overall status:** Scanner implementation and automated verification are complete. A manual Electron GUI/native-picker smoke test remains outstanding because this sandbox has no graphical display and cannot fetch Electron's native binary.

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
- [x] Added welcome, projects, project-details, and settings routes/screens; persistent theme, default-project, remove-confirmation, and recent-project settings.
- [x] Added project path/import/persistence, shared-schema, preload/IPC, Angular shell/default-project, and theme behavior tests.

### Scanner (v0.3.0 implementation)

- [x] Added strict shared Zod contracts for scan configuration, progress, file metadata, language and technology evidence, warnings/errors, full results, and history summaries.
- [x] Added the reusable `@repolens/core` scanner: iterative discovery, canonical-root/symlink checks, classification, extension-derived languages, allowlisted technology evidence, metadata, streaming SHA-256, progress, cancellation, and structured warnings/errors.
- [x] Added root `.gitignore` and `.repolensignore` support for a documented, tested subset, including precedence and re-inclusion. Mandatory `.git` / `node_modules` exclusions and sensitive-path protections cannot be undone by project ignore negations.
- [x] Added the Electron-owned filesystem adapter and worker-thread execution, validated start/cancel/history IPC, preload progress subscriptions, and per-project JSON history capped at 50 summaries.
- [x] Added the project-details scan controls, options and sensitive-file acknowledgement, progress/cancellation, results, and history. Full per-file metadata/hashes remain in memory for the open session; saved history omits inventories, hashes, and contents.
- [x] Coordinated project removal with scan/history lifecycle: removal is rejected during that project's scan, and successful removal deletes that project's saved history as well as the RepoLens registration. The selected repository itself is never recursively deleted.
- [x] Added synthetic scanner fixtures and core, adapter, history, service, IPC/preload, shared-schema, and Angular project-details tests.
- [x] Updated README, changelog, scanner/project-management guides, architecture, security, IPC, package structure, development guide, and roadmap.

## Verification

| Check                      | Result                                                                                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build`            | **Passed** for shared/core/support/database/export/AI packages, CLI, Electron TypeScript/preload bundle, and production Angular renderer.                         |
| `npm run typecheck`        | **Passed** for all packages, CLI, Electron, and Angular strict-template development build.                                                                        |
| `npm test`                 | **Passed:** 24 Vitest files / 59 tests and 3 Angular spec files / 6 tests.                                                                                        |
| `npm run lint`             | **Passed** with zero warnings/errors. Scanner fixture data is excluded from source linting.                                                                       |
| `npm run format:check`     | **Passed.**                                                                                                                                                       |
| `git diff --check`         | **Passed.**                                                                                                                                                       |
| `npm ci`                   | Passed earlier in this session. The dependency audit reported 19 moderate findings in the development-tool dependency tree; no forced framework upgrade was made. |
| Electron GUI/native picker | **Not verified:** Electron's native binary could not be downloaded in this sandbox, and there is no `DISPLAY` / X server.                                         |

The production build succeeds with non-fatal budget warnings: the initial Angular chunk is 729.26 kB raw (153.24 kB estimated transfer) against the existing 500 kB warning budget; the project-details component stylesheet is 9.10 kB against a 4 kB warning budget. Its component-style error limit was raised from 8 kB to 10 kB for the scanner UI. The Electron preload bundle is also reported at approximately 1.5 MB with a 2.8 MB source map.

## Scope, privacy, and known limitations

- The scanner runs only after an explicit action on a registered project. Electron main resolves the stored path; the renderer cannot supply an arbitrary filesystem path. Scanning runs in a worker and does not execute imported code/commands, install dependencies, initialize or modify Git, change repository files, upload contents, or call cloud/AI services.
- Ignore files are read at the project root only. The supported `.gitignore` / `.repolensignore` behavior is a tested subset, **not full Git compatibility**; nested ignore files, Git index/global excludes, and all Git quoting/escaping and matching edge cases are not claimed.
- Sensitive-path filtering is based on names and paths, not content inspection; it cannot find secrets embedded in ordinary source files. Scanning sensitive paths requires explicit opt-in and risk acknowledgement.
- Full per-file metadata and hashes are returned for the current scan, but are not persisted in history. Persistent history contains bounded summary records only (counts, language/technology evidence, status, timestamps, and warnings).
- Automated scanner tests use synthetic checked-in fixtures, not developer repositories. They do not replace a supported-platform GUI/worker smoke test.
- There is no overall file/directory-count ceiling or result pagination yet; runtime, memory use, and IPC result size can scale with the included repository. Very large repositories still need performance testing.
- The initial bundle and component stylesheet remain above their warning budgets. SQLite/Drizzle persistence and JSON-to-SQLite migration, AST/static analysis, dependency graphs, indexing, dashboard analytics, exports, CLI scanning, and AI remain future work. The CLI currently provides only the executable foundation.

## Remaining verification

- [ ] On a supported graphical machine with access to Electron's binary download host, launch `npm run dev:desktop`; smoke-test native folder selection, import/cancel/duplicate handling, scanning, progress/cancellation, history persistence/removal, app restart behavior, and settings/theme persistence. Confirm that removing a project changes only RepoLens application data, not repository files.
- [ ] Revisit Angular initial-bundle and project-details component-style budgets before production packaging.

## Next milestone

**v0.4.0 — Static analysis (future):** TypeScript/JavaScript AST parsing, symbols, imports, exports, and dependency resolution. Do not treat the current scanner's file metadata or package/config evidence as AST analysis or a dependency graph.
