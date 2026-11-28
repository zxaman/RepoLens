# RepoLens Project Status

- **Manifest version:** `0.2.0` (v0.3.0 and v0.4.0 implementation work is unreleased; see `CHANGELOG.md`).
- **Current milestone:** v0.4.0 — Static analysis implementation.
- **Overall status:** Phase 4 implementation and automated verification are in place. The supported-platform Electron GUI/native-picker smoke test is still outstanding, so v0.4.0 is **not release-complete**.

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
- [x] Added the project-details scan controls, options and sensitive-file acknowledgement, progress/cancellation, results, and history. Saved history omits inventories, hashes, and contents.
- [x] Coordinated project removal with scan/history lifecycle: removal is rejected during that project's scan, and successful removal deletes that project's saved history as well as the RepoLens registration. The selected repository itself is never recursively deleted.
- [x] Added synthetic scanner fixtures and core, adapter, history, service, IPC/preload, shared-schema, and Angular project-details tests.

### Static analysis (v0.4.0 implementation on this branch)

- [x] Added shared analysis schemas/errors and typed `analysis.start(projectId, scanId)`, `cancel(analysisId)`, and progress subscription APIs.
- [x] Added the TypeScript Compiler API parser for TypeScript/TSX/JavaScript/JSX syntax, symbols, imports, exports, parser diagnostics, and safe path-mapping extraction.
- [x] Added bounded `@repolens/core` analysis over the exact latest validated full `ScanResult` held in memory; analysis never starts another scan or substitutes persisted history.
- [x] Bounded source/config reads, eligible source files, parse concurrency, result records, and diagnostics; added cancellation/progress, conservative local/alias/external/unresolved classification, and read-failure/change diagnostics.
- [x] Added the inventory-scoped Electron file adapter, worker/session/service lifecycle, project-removal coordination, validated IPC/preload subscriptions, and ESM main/worker build with a sandboxed CommonJS preload.
- [x] Integrated analysis progress, cancellation, errors, status, searchable symbols, import/export/dependency tables, diagnostics, and results into project details.
- [x] Kept source text and analysis results ephemeral; scan history continues to persist summary-only records.
- [x] Added parser/core/service/filesystem/IPC/preload/UI tests and an emitted-worker smoke test. See [Static Analysis](docs/STATIC_ANALYSIS.md).

Phase 4 implementation and automated checks are complete; do not treat the milestone as a release until the remaining supported-platform smoke test and release review are done. Phase 5 has not started.

## Verification

| Check                           | Result                                                                                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build`                 | **Passed** for all packages, CLI, Electron ESM/preload output, and production Angular renderer.                                                                                             |
| `npm run typecheck`             | **Passed** for shared/core/language-support and remaining packages, CLI, Electron, and Angular strict templates.                                                                            |
| `npm test`                      | **Passed:** 30 Vitest files / 83 tests, 3 Angular spec files / 9 tests, and emitted scan/analysis worker smoke test.                                                                        |
| `npm run test:electron-workers` | **Passed:** built scan and analysis workers ran on a synthetic TypeScript project; analysis reused the scan result, analyzed 2 files, extracted 6 symbols, and resolved 1 local dependency. |
| `npm run lint`                  | **Passed** with zero warnings/errors.                                                                                                                                                       |
| `npm run format:check`          | **Passed.**                                                                                                                                                                                 |
| `git diff --check`              | **Passed.**                                                                                                                                                                                 |
| `npm ci`                        | Passed earlier in this session. The dependency audit reported 19 moderate findings in the development-tool dependency tree; no forced audit fix was applied.                                |
| Electron GUI/native picker      | **Not verified:** the sandbox has no graphical display and could not obtain Electron's native binary. Worker smoke testing is not a GUI launch test.                                        |

The production build has non-fatal budget warnings: the initial Angular bundle is 722.94 kB raw (150.93 kB estimated transfer) against the existing 500 kB warning budget; the project-details stylesheet is 9.56 kB against a 4 kB warning budget and remains under its 10 kB error limit. The preload bundle is approximately 1.5 MB with a 2.8 MB source map.

## Scope, privacy, and known limitations

- Static analysis requires a registered, available project and the matching latest full scan result held in Electron main memory. It is a separate explicit action; it does not run a new scan or read a saved summary.
- The analysis worker reads only normalized source/config paths present in the validated scan inventory, under the registered project root. Source contents are not returned to the renderer, logged, or persisted. Analysis results are returned to the renderer but are not written to JSON or scan history.
- The TypeScript Compiler API extracts syntax only. RepoLens does not execute imported code, evaluate project plugins/scripts/configuration, type-check the project, install dependencies, follow imports into `node_modules`, or construct a full dependency graph. Local resolution uses scanned paths and scanned `tsconfig` `baseUrl`/`paths`; ambiguous relationships remain unresolved.
- Static analysis limits: 4 concurrent parses; 10,000 eligible source files; 1 MiB per source file, capped at the scan-time file size; 32 MiB total source bytes; 50,000 symbols and relationship records per output collection, 50,000 nested import bindings and export-symbol links in aggregate; 2,000 diagnostics; and at most 100 `tsconfig.json` files / 4 MiB total config reads (512 KiB each), with 256 path mappings and 1,024-character `baseUrl` values across the scanned configs. See [Static Analysis](docs/STATIC_ANALYSIS.md) for details.
- Phase 3 scanning still has no overall file/directory-count ceiling. Very large scan inventories can therefore consume memory and IPC/worker-transfer time before static-analysis limits apply; performance testing remains necessary.
- Ignore files are read at the project root only. The supported `.gitignore` / `.repolensignore` behavior is a tested subset, **not full Git compatibility**; nested ignore files, Git index/global excludes, and all Git quoting/escaping and matching edge cases are not claimed.
- Sensitive-path filtering is based on names and paths, not content inspection; it cannot find secrets embedded in ordinary source files. Scanning sensitive paths requires explicit opt-in and risk acknowledgement.
- Persistent history contains bounded summary records only (counts, language/technology evidence, status, timestamps, and warnings). Full scan inventories, hashes, source text, and analysis results are not persisted.

## Remaining verification

- [ ] On a supported graphical machine with Electron's native runtime available, launch `npm run dev:desktop`; smoke-test native folder selection/import, scan and analysis progress/cancellation, results, history persistence/removal, app restart, and settings/theme behavior. Confirm project removal does not alter repository files.
- [ ] Revisit Angular initial-bundle and project-details stylesheet budgets before production packaging.

## Next milestone

**v0.5.0 — Graph engine (future):** dependency graphs, circular-dependency detection, graph queries, and graph export. Do not begin this work until Phase 4's outstanding verification and release review are complete.
