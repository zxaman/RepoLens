# RepoLens Project Status

- **Manifest version:** `0.2.0` (v0.3.0, v0.4.0, and v0.5.0 implementation work is unreleased; see `CHANGELOG.md`).
- **Current milestone:** v0.5.0 — Graph engine implementation.
- **Implementation branch:** `arena/160b455a-repolens`, branched from commit `538be616740a4ad0e84732c92573a4883dc5212a`.
- **Overall status:** Phase 5 graph-engine implementation is active on this branch. Full automated tests, builds, typechecks, lint, and formatting checks have passed. The supported-platform Electron GUI/native-picker smoke test remains outstanding, so the milestone is not release-complete.

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

### Graph engine (v0.5.0 implementation on `arena/160b455a-repolens`)

- [x] Added strict shared graph DTO/progress/query/cycle/export schemas with normalized path, stable identity, reference, count, and export-size validation.
- [x] Added asynchronous Graphology construction from actual Phase 4 `AnalysisResult` data. It normalizes project/folder/file/supported symbol nodes and only emits evidence-backed containment/import/export edges; no filename/name-based relationship inference or source-content copying.
- [x] Preserved local/alias resolved imports as directed file dependencies; external packages and unresolved imports remain separate dependency references with package/reason metadata and no fabricated target nodes.
- [x] Added cycle-safe direct/transitive/reverse traversal, depth limits, shortest paths, deterministic node queries/pagination, degree/relationship metrics, iterative SCC reporting, and bounded canonical simple-cycle enumeration.
- [x] Added a project-ID-keyed bounded in-memory provider with replacement, build revision leases, stale publication prevention, expiry/LRU cleanup, disposal on project removal, and shutdown cleanup.
- [x] Integrated graph construction after completed/partial analysis, graph-build progress and cancellation through analysis IPC/preload, and sender-guarded graph summary/query/traversal/path/cycle/JSON/dispose APIs. Graphology instances remain in core/main and are never exposed to the renderer.
- [x] Added deterministic schema/core/provider/service/IPC/bridge tests and graph assertions in the desktop worker/workflow integration. See [Graph Engine](docs/GRAPH_ENGINE.md).

Phase 4 remains the actual source of graph input: Phase 5 consumes its shared `AnalysisResult` and does not recreate the scanner/parser. GraphML, graph persistence, visualization/Architecture Explorer, CLI graph commands, calls/inheritance/API/ORM discovery, and change-impact analysis are not implemented. Automated checks do not substitute for the outstanding supported-platform Electron GUI/native-picker smoke test, which remains a release gate.

## Functional implementation audit

For this audit, **end-to-end working** means exercised in the actual RepoLens Electron window with its real preload and native folder picker. That GUI test cannot be performed in this sandbox, so no row is marked end-to-end working. Automated service/IPC/worker tests provide evidence for the connected backend paths but do not close that gap.

| Feature                | UI / backend connected                 | Automated evidence (not native GUI)                                                                 | Native desktop GUI E2E |
| ---------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------- |
| Import Project         | Yes / Yes                              | Stubbed folder selection and preview; service tests cover cancellation/duplicates                   | Not verified           |
| Project Registration   | Yes / Yes                              | Simulated-IPC confirmation, generated ID/metadata, and registry reload after restart                | Not verified           |
| Recent Projects        | Yes / Yes                              | Active/recent project and `lastOpenedAt` persist across service recreation                          | Not verified           |
| Project Switching      | Yes / Yes                              | `setActive` bridge call persists the active project                                                 | Not verified           |
| Start Scan             | Yes / Yes                              | Real worker scans 3 fixture files through registered IPC handlers and preload API                   | Not verified           |
| Scan Progress          | Yes / Yes                              | Bridge subscription receives actual worker progress phases                                          | Not verified           |
| Scan Cancellation      | Yes / Yes                              | Scan cancelled through bridge while real worker is active                                           | Not verified           |
| Scan History           | Yes / Yes                              | Summary persisted and read back; removal path also verified                                         | Not verified           |
| Static Analysis        | Yes / Yes                              | Actual scan result feeds worker analysis: 6 symbols and a resolved local dependency                 | Not verified           |
| Symbol Explorer        | Yes / Yes                              | Angular component spec browses returned symbols; worker workflow supplies real results              | Not verified           |
| Import/Export Explorer | Yes — syntax tables / parser connected | Component spec plus actual worker imports/exports; this is code syntax, not file transfer           | Not verified           |
| Dependency Browser     | Yes / Yes                              | Actual worker resolves `src/helper.ts`; component test renders dependency results                   | Not verified           |
| Graph bridge API       | Bridge only / Yes                      | Desktop workflow exercises real analysis-to-graph build, queries, paths, cycles, JSON, and disposal | Not verified           |

### Visible controls audit

- Welcome, Projects, Settings, Back to projects, Open Existing Project, View all projects, project names, and Open project controls navigate to real Angular routes. Opening a registered project updates the active-project record.
- Import Project / Choose a Folder opens the native picker through the preload and IPC bridge, then previews and confirms registration. Cancel, duplicate detection, and Open Existing Project have explicit paths. In a browser preview, import controls are now disabled with an explanation instead of showing a click-time failure.
- Project Remove and project-page Remove use the confirmation preference and remove only RepoLens registration/history. Registry removal is committed before scan-history cleanup, so a failed registry write leaves history intact. Refresh metadata revalidates the folder.
- Start Scan and Cancel Scan invoke the scanner worker and stream progress. Analyze scanned source and Cancel analysis invoke the bounded analysis worker. Settings Save and Reset call persistence services.
- Symbol/import/export/dependency/diagnostic panels use native disclosure controls; symbol search filters returned analysis results. The graph bridge is available to the renderer, but no visualization/Architecture Explorer UI or export-to-file action is exposed.
- Removed the stale project-card “Not scanned yet” label and corrected the welcome copy that said analysis was unavailable. Scan results now show actual directory count, ignored-file count, and duration in addition to file/source counts, language/technology evidence, and status.

### Root causes found and repairs

1. The reported “Project management is available in the RepoLens desktop application” message was the renderer’s expected browser fallback: a normal browser has no `window.repolens` preload. Import buttons are now disabled in browser preview with a persistent explanation.
2. The user’s first `dev:desktop` run failed to resolve `@repolens/shared`; a clean `npm ci` restored npm workspace links, after which `npm run build:packages` passed.
3. The user’s next Angular cold build took **114.992 seconds**, exceeding the dev script’s **90-second** renderer timeout. It threw before launching Electron and left an Angular web server process behind on Windows. The timeout is now five minutes, and Windows cleanup terminates the child process tree.
4. Several UI claims were stale or incomplete: the welcome screen understated static analysis, project cards displayed a hard-coded scan status, and scan summaries omitted directories, ignored files, and duration. Those were corrected. Electron diagnostics now retain bounded error names/codes/messages while redacting absolute paths and omitting raw stacks/arbitrary thrown values; renderer-facing errors remain user-safe.

### Changed files

- **Renderer shell and project UI:** `apps/desktop/src/app/app.html`, `app.scss`, `app.ts`, `app.spec.ts`; project-card and project-import-button component HTML/SCSS/TypeScript plus `project-import-button.component.spec.ts`; project-details page HTML/TypeScript/spec; `welcome-page.component.html`.
- **Electron workflow and diagnostics:** `apps/desktop/electron/main.ts`; `services/atomic-json-file.ts`, `project-errors.ts`, new `diagnostic-logging.ts` and `diagnostic-logging.test.ts`; `scan-management.service.ts` and its test, `scan-worker.ts`/`scan-worker-session.ts`, `analysis-management.service.ts`, and `analysis-worker.ts`/`analysis-worker-session.ts`.
- **Workflow, startup, and documentation:** `scripts/test-desktop-workflow.mjs`, `scripts/dev-desktop.mjs`, `package.json`, `README.md`, and this status report.
- **Phase 5 graph contracts/engine:** `packages/shared/src/schemas/graph.schema.ts` and its tests; `packages/core/src/graph/graph-engine.ts`, `graph-provider.ts`, and their deterministic tests; graph exports and Graphology dependencies in the shared/core package entry points.
- **Desktop graph lifecycle/IPC:** `apps/desktop/electron/services/analysis-management.service.ts`, `graph-management.service.ts`, graph IPC registration/validation/channel/preload bridge, graph workflow/service/schema tests, and `scripts/test-desktop-workflow.mjs`.
- **Graph documentation:** `docs/GRAPH_ENGINE.md`, plus updates to `docs/ARCHITECTURE.md`, `docs/IPC_ARCHITECTURE.md`, `docs/PACKAGE_STRUCTURE.md`, `docs/STATIC_ANALYSIS.md`, `docs/ROADMAP.md`, `README.md`, `CHANGELOG.md`, `packages/core/README.md`, and this status report.

## Verification

| Check                         | Result                                                                                                                                                                                                                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                    | **Passed:** 36 Vitest files / 112 tests; 4 Angular spec files / 12 tests; emitted worker smoke test; desktop workflow covering import/restart, scan, analysis, graph progress/queries/path/cycles/JSON/disposal, scan cancellation, history, and source-file integrity. |
| `npm run build`               | **Passed** for workspace packages, CLI, Electron ESM/preload output, and production Angular renderer. Angular emitted non-fatal bundle/style budget warnings (details below).                                                                                           |
| `npm run typecheck`           | **Passed** for packages, CLI, Electron, and Angular strict templates.                                                                                                                                                                                                   |
| `npm run lint`                | **Passed** with zero warnings/errors.                                                                                                                                                                                                                                   |
| `npm run format:check`        | **Passed.**                                                                                                                                                                                                                                                             |
| `git diff --check`            | **Passed** after the final documentation/code edits.                                                                                                                                                                                                                    |
| `npm ci --ignore-scripts`     | **Passed** in the sandbox. The dependency audit reported 19 moderate findings in the development-tool dependency tree; no forced audit fix was applied.                                                                                                                 |
| Electron GUI/native picker    | **Not verified:** this sandbox has no graphical display and Electron's native GUI runtime is unavailable. Automated workflow tests use a picker stub and IPC dispatcher; they do not launch the real Electron window/native dialog.                                     |
| Windows `npm run dev:desktop` | **Not re-run on Windows:** the user's cold-build log showed 114.992 seconds versus the old 90-second timeout; the script now allows five minutes and kills the Windows child-process tree on cleanup.                                                                   |

The production build has non-fatal budget warnings: initial Angular bundle **738.62 kB raw** (153.86 kB estimated transfer) versus the existing 500 kB warning budget, and the project-details stylesheet is **9.56 kB** versus its 4 kB warning budget (still below the 10 kB error limit). The sandbox Electron preload bundle is about **1.5 MB**, with a **2.8 MB** source map.

## Scope, privacy, and known limitations

- Static analysis requires a registered, available project and the matching latest full scan result held in Electron main memory. It is a separate explicit action; it does not run a new scan or read a saved summary.
- The analysis worker reads only normalized source/config paths present in the validated scan inventory, under the registered project root. Source contents are not returned to the renderer, logged, or persisted. Analysis results are returned to the renderer but are not written to JSON or scan history.
- The TypeScript Compiler API extracts syntax only. RepoLens does not execute imported code, evaluate project plugins/scripts/configuration, type-check the project, install dependencies, or follow imports into `node_modules`. Phase 4 resolves only against scanned paths and scanned `tsconfig` `baseUrl`/`paths`; ambiguous relationships remain unresolved. Phase 5 consumes that evidence to build local/alias dependency edges and external/unresolved reference records, but does not infer calls, inheritance, API routes, or database models.
- Static analysis limits: 4 concurrent parses; 10,000 eligible source files; 1 MiB per source file, capped at the scan-time file size; 32 MiB total source bytes; 50,000 symbols and relationship records per output collection, 50,000 nested import bindings and export-symbol links in aggregate; 2,000 diagnostics; and at most 100 `tsconfig.json` files / 4 MiB total config reads (512 KiB each), with 256 path mappings and 1,024-character `baseUrl` values across the scanned configs. See [Static Analysis](docs/STATIC_ANALYSIS.md) for details.
- Phase 3 scanning still has no overall file/directory-count ceiling. Very large scan inventories can therefore consume memory and IPC/worker-transfer time before static-analysis limits apply; performance testing remains necessary.
- Ignore files are read at the project root only. The supported `.gitignore` / `.repolensignore` behavior is a tested subset, **not full Git compatibility**; nested ignore files, Git index/global excludes, and all Git quoting/escaping and matching edge cases are not claimed.
- Sensitive-path filtering is based on names and paths, not content inspection; it cannot find secrets embedded in ordinary source files. Scanning sensitive paths requires explicit opt-in and risk acknowledgement.
- Persistent history contains bounded summary records only (counts, language/technology evidence, status, timestamps, and warnings). Full scan inventories, hashes, source text, analysis results, and graph data are not persisted. The in-memory graph provider is capped at 50 projects/six-hour age and is cleared on removal, cleanup, or app shutdown.
- Graph engine limits: 150,000 nodes, 400,000 edges, 50,000 dependency references, 4,096-character normalized paths, 25,000,000 UTF-8 bytes per JSON export, 1,000 maximum reported cycles, and 250,000 cycle-enumeration transitions. GraphML is not implemented; the only graph export is validated JSON.
- No graph visualization/Architecture Explorer, persistent graph storage, CLI graph command, incremental indexing, change-impact analysis, or framework/API/ORM discovery was added.

## Remaining verification

- [ ] On a supported graphical machine with Electron's native runtime available, launch `npm run dev:desktop`; smoke-test native folder selection/import, scan and analysis progress/cancellation, results, history persistence/removal, app restart, and settings/theme behavior. Confirm project removal does not alter repository files. The graph bridge has automated coverage but no visualization UI; manually verify graph build progress/cancellation if exercising the bridge.
- [ ] Revisit Angular initial-bundle and project-details stylesheet budgets before production packaging.

## Roadmap gate

Phase 5 graph-engine implementation is in place on `arena/160b455a-repolens` and its automated checks have passed. Do not treat this as release-complete or begin out-of-scope Architecture Explorer/visualization work until the native desktop import/scan/analysis workflow has passed the GUI smoke test above and the outstanding release review is complete.
