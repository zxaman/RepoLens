# RepoLens Project Status

- **Manifest version:** `0.2.0` (v0.3.0, v0.4.0, and v0.5.0 implementation work is unreleased; see `CHANGELOG.md`).
- **Current milestone:** v0.5.0 — Graph engine implementation.
- **Implementation branch:** `arena/08215937-repolens`, branched from commit `ad084f6972bd21d5b366fc8ad7b828482e5b61be`.
- **Overall status:** Explicit graph generation is implemented on this active branch. The latest package build, production build, typecheck, automated unit/Angular/worker workflow suite, lint, and formatting checks pass. The supported-platform Electron GUI/native-picker smoke test remains outstanding, so the milestone is not release-complete.

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
- [x] Added bounded `@repolens/core` analysis over the exact latest validated full `ScanResult` for the project in memory; analysis never starts another scan or substitutes persisted history.
- [x] Bounded source/config reads, eligible source files, parse concurrency, result records, and diagnostics; added cancellation/progress, conservative local/alias/external/unresolved classification, and read-failure/change diagnostics.
- [x] Added the inventory-scoped Electron file adapter, worker/session/service lifecycle, project-removal coordination, validated IPC/preload subscriptions, and ESM main/worker build with a sandboxed CommonJS preload.
- [x] Integrated analysis progress, cancellation, errors, status, searchable symbols, import/export/dependency tables, diagnostics, and results into project details.
- [x] Kept source text and analysis results ephemeral; scan history continues to persist summary-only records.
- [x] Added parser/core/service/filesystem/IPC/preload/UI tests and an emitted-worker smoke test. See [Static Analysis](docs/STATIC_ANALYSIS.md).

### Explicit graph generation (v0.5.0 implementation on `arena/08215937-repolens`)

- [x] Added strict shared graph DTO, request/report, progress, query, cycle, and export schemas with normalized-path, stable-identity, reference, count, and export-size validation.
- [x] Added asynchronous Graphology construction from actual Phase 4 `AnalysisResult` data. It includes parser-confirmed analyzed files even when they have no symbols/imports and emits only evidence-backed containment/import/export edges; it does not infer relationships from names or copy source contents.
- [x] Preserved local/alias resolved imports as directed file dependencies; external packages and unresolved imports remain separate dependency references with package/reason metadata and no fabricated target nodes.
- [x] Added cycle-safe direct/transitive/reverse traversal, depth limits, shortest paths, deterministic node queries/pagination, degree/relationship metrics, iterative SCC reporting, and bounded canonical simple-cycle enumeration.
- [x] Added a project-ID-keyed bounded in-memory graph provider with revision leases, stale-publication prevention, expiry/LRU cleanup, disposal on project removal, and shutdown cleanup.
- [x] Kept graph construction explicit: analysis no longer builds a graph automatically. `graphs.generate(projectId, scanId, analysisId)` requires an available registered project, that project's matching current completed scan, and its matching valid completed/partial analysis with at least one successfully parsed source file. It revalidates current scan/analysis before publication, supports partial results with omission/unresolved/external/cycle-limit warnings, and returns clear failed reports without publishing partial or project-only graphs.
- [x] Retained full scan inventories and analysis results in per-project 50-entry LRU memory caches. Graph-generation progress, report validation, queries, traversal, paths, cycles, deterministic JSON, and disposal are exposed through sender-guarded IPC/preload APIs; Graphology instances remain in core/main and never reach the renderer.
- [x] Added the project-details explicit generation/report panel with progress, counts, a bounded first page of actual graph nodes, and cycle paths. This is not a full graph visualization and has no graph-specific cancellation action.
- [x] Added deterministic schema/core/provider/service/IPC/bridge/UI tests and graph assertions in the desktop worker/workflow integration. See [Graph Engine](docs/GRAPH_ENGINE.md).

Phase 4 remains the actual source of graph input: Phase 5 consumes its shared `AnalysisResult` and does not recreate the scanner/parser. GraphML, persistent graph storage, a full visualization/Architecture Explorer, CLI graph commands, calls/inheritance/API/ORM discovery, and change-impact analysis are not implemented. Automated checks do not substitute for the outstanding supported-platform Electron GUI/native-picker smoke test, which remains a release gate.

## Functional implementation audit

For this audit, **end-to-end working** means exercised in the actual RepoLens Electron window with its real preload and native folder picker. That GUI test cannot be performed in this sandbox, so no row is marked end-to-end working. Automated service/IPC/worker tests provide evidence for the connected backend paths but do not close that gap.

| Feature                 | UI / backend connected                 | Automated evidence (not native GUI)                                                                                             | Native desktop GUI E2E |
| ----------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Import Project          | Yes / Yes                              | Stubbed folder selection and preview; service tests cover cancellation/duplicates                                               | Not verified           |
| Project Registration    | Yes / Yes                              | Simulated-IPC confirmation, generated ID/metadata, and registry reload after restart                                            | Not verified           |
| Recent Projects         | Yes / Yes                              | Active/recent project and `lastOpenedAt` persist across service recreation                                                      | Not verified           |
| Project Switching       | Yes / Yes                              | `setActive` bridge call persists the active project                                                                             | Not verified           |
| Start Scan              | Yes / Yes                              | Real worker scans 5 fixture files through registered IPC handlers and preload API                                               | Not verified           |
| Scan Progress           | Yes / Yes                              | Bridge subscription receives actual worker progress phases                                                                      | Not verified           |
| Scan Cancellation       | Yes / Yes                              | Scan cancelled through bridge while real worker is active                                                                       | Not verified           |
| Scan History            | Yes / Yes                              | Summary persisted and read back; removal path also verified                                                                     | Not verified           |
| Static Analysis         | Yes / Yes                              | Actual scan result feeds worker analysis: 6 symbols and a resolved local dependency                                             | Not verified           |
| Symbol Explorer         | Yes / Yes                              | Angular component spec browses returned symbols; worker workflow supplies real results                                          | Not verified           |
| Import/Export Explorer  | Yes — syntax tables / parser connected | Component spec plus actual worker imports/exports; this is code syntax, not file transfer                                       | Not verified           |
| Dependency Browser      | Yes / Yes                              | Actual worker resolves `src/helper.ts`; component test renders dependency results                                               | Not verified           |
| Graph generation/report | Yes / Yes                              | Component spec plus desktop workflow exercise explicit generation, real graph counts/cycles, queries, paths, JSON, and disposal | Not verified           |

### Visible controls audit

- Welcome, Projects, Settings, Back to projects, Open Existing Project, View all projects, project names, and Open project controls navigate to real Angular routes. Opening a registered project updates the active-project record.
- Import Project / Choose a Folder opens the native picker through the preload and IPC bridge, then previews and confirms registration. Cancel, duplicate detection, and Open Existing Project have explicit paths. In a browser preview, import controls are now disabled with an explanation instead of showing a click-time failure.
- Project Remove and project-page Remove use the confirmation preference and remove only RepoLens registration/history. Registry removal is committed before scan-history cleanup, so a failed registry write leaves history intact. Refresh metadata revalidates the folder.
- Start Scan and Cancel Scan invoke the scanner worker and stream progress. Analyze scanned source and Cancel analysis invoke the bounded analysis worker. Settings Save and Reset call persistence services.
- Symbol/import/export/dependency/diagnostic panels use native disclosure controls; symbol search filters analysis results. Graph generation is an explicit project-details action with progress, validated counts/warnings, a bounded first page of graph nodes, and cycle paths. There is no full graph visualization, graph-specific cancel action, or export-to-file UI.
- Removed the stale project-card “Not scanned yet” label and corrected the welcome copy that said analysis was unavailable. Scan results now show actual directory count, ignored-file count, and duration in addition to file/source counts, language/technology evidence, and status.

### Root causes found and repairs

1. The reported “Project management is available in the RepoLens desktop application” message was the renderer’s expected browser fallback: a normal browser has no `window.repolens` preload. Import buttons are now disabled in browser preview with a persistent explanation.
2. The user’s first `dev:desktop` run failed to resolve `@repolens/shared`; a clean `npm ci` restored npm workspace links, after which `npm run build:packages` passed.
3. The user’s next Angular cold build took **114.992 seconds**, exceeding the dev script’s **90-second** renderer timeout. It threw before launching Electron and left an Angular web server process behind on Windows. The timeout is now five minutes, and Windows cleanup terminates the child process tree.
4. Several UI claims were stale or incomplete: the welcome screen understated static analysis, project cards displayed a hard-coded scan status, and scan summaries omitted directories, ignored files, and duration. Those were corrected. Electron diagnostics now retain bounded error names/codes/messages while redacting absolute paths and omitting raw stacks/arbitrary thrown values; renderer-facing errors remain user-safe.

### Changed files

- **Shared contracts and core graph engine:** `packages/shared/src/schemas/analysis.schema.ts`, `graph.schema.ts`, `packages/core/src/pipeline/static-analysis.ts`, `packages/core/src/graph/graph-engine.ts`, and their schema/engine tests; analyzed-file inventory now retains isolated files and rejects inconsistent analysis data.
- **Electron lifecycle and IPC:** `scan-management.service.ts` and `analysis-management.service.ts` retain bounded per-project LRU results; `graph-management.service.ts` validates current scan/analysis both before construction and before publication. Graph generation is wired through validated IPC, progress events, preload bridge, and service tests.
- **Renderer and integration:** `apps/desktop/src/app/features/projects/services/graph.service.ts` and project-details page templates/styles/spec add explicit generation/report UI. `scripts/test-electron-workers.mjs` and `scripts/test-desktop-workflow.mjs` exercise real worker-derived graph counts, cycles, and explicit generation.
- **Documentation:** `README.md`, `docs/GRAPH_ENGINE.md`, `docs/IPC_ARCHITECTURE.md`, `docs/ARCHITECTURE.md`, `docs/STATIC_ANALYSIS.md`, `docs/ROADMAP.md`, and this status report describe the explicit workflow and remaining GUI gate.

## Verification

| Check                         | Result                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build:packages`      | **Passed** for shared, core, language-support, database, export, and AI workspaces.                                                                                                                                                                                                                                                                                                                           |
| `npm run build`               | **Passed** for workspace packages, CLI, Electron ESM/preload output, and production Angular renderer. The initial Angular bundle and project-details stylesheet emitted non-fatal budget warnings (details below).                                                                                                                                                                                            |
| `npm run typecheck`           | **Passed** for packages, CLI, Electron, and Angular strict templates.                                                                                                                                                                                                                                                                                                                                         |
| `npm test`                    | **Passed:** 36 Vitest files / 122 tests; 4 Angular spec files / 11 tests; emitted-worker smoke test; desktop workflow covering import/restart, scan, analysis, explicit graph generation/progress, queries, paths, cycles, JSON, disposal, scan cancellation, history, and source-file integrity. The worker smoke test built 6 nodes / 8 edges; the desktop workflow built 10 nodes / 16 edges with 1 cycle. |
| `npm run lint`                | **Passed** with zero warnings/errors.                                                                                                                                                                                                                                                                                                                                                                         |
| `npm run format:check`        | **Passed** after formatting the changed source, UI, and documentation files.                                                                                                                                                                                                                                                                                                                                  |
| `git diff --check`            | **Passed** after the final source/documentation edits.                                                                                                                                                                                                                                                                                                                                                        |
| `npm ci --ignore-scripts`     | **Passed** in the sandbox. The dependency audit reported 19 moderate findings in the development-tool dependency tree; no forced audit fix was applied.                                                                                                                                                                                                                                                       |
| Electron GUI/native picker    | **Not verified:** this sandbox has no supported graphical desktop/native-picker runtime. Automated workflow tests use a picker stub and IPC dispatcher; they do not launch the real Electron window/native dialog.                                                                                                                                                                                            |
| Windows `npm run dev:desktop` | **Not re-run on Windows:** the user's cold-build log showed 114.992 seconds versus the old 90-second timeout; the script now allows five minutes and kills the Windows child-process tree on cleanup.                                                                                                                                                                                                         |

The production build has non-fatal budget warnings: the initial Angular bundle is **742.45 kB raw** (154.49 kB estimated transfer) versus the existing 500 kB warning budget. The project-details stylesheet is **9.99 kB** versus its 4 kB warning budget, just below the 10 kB error limit. The Electron preload bundle is about **1.5 MB**, with a **2.8 MB** source map.

## Scope, privacy, and known limitations

- Static analysis requires a registered, available project and its matching current full scan result in Electron main memory. Scan inventories are kept in a bounded 50-project LRU cache; analysis is a separate explicit action and never starts another scan or substitutes a saved summary.
- The analysis worker reads only normalized source/config paths present in the validated scan inventory, under the registered project root. Source contents are not returned to the renderer, logged, or persisted. Validated analysis results are retained in a separate bounded 50-project LRU memory cache for later explicit graph generation; they are not written to JSON or scan history.
- Graph generation is a separate user action and requires the current completed scan, matching completed/partial analysis, and at least one successfully analyzed source file. Partial results carry omission and relationship warnings; failed, stale, empty, or out-of-inventory results do not publish a graph.
- The TypeScript Compiler API extracts syntax only. RepoLens does not execute imported code, evaluate project plugins/scripts/configuration, type-check the project, install dependencies, or follow imports into `node_modules`. Phase 4 resolves only against scanned paths and scanned `tsconfig` `baseUrl`/`paths`; ambiguous relationships remain unresolved. Phase 5 consumes that evidence to build local/alias dependency edges and external/unresolved reference records, but does not infer calls, inheritance, API routes, or database models.
- Static analysis limits: 4 concurrent parses; 10,000 eligible source files; 1 MiB per source file, capped at the scan-time file size; 32 MiB total source bytes; 50,000 symbols and relationship records per output collection, 50,000 nested import bindings and export-symbol links in aggregate; 2,000 diagnostics; and at most 100 `tsconfig.json` files / 4 MiB total config reads (512 KiB each), with 256 path mappings and 1,024-character `baseUrl` values across the scanned configs. See [Static Analysis](docs/STATIC_ANALYSIS.md) for details.
- Phase 3 scanning still has no overall file/directory-count ceiling. Very large scan inventories can therefore consume memory and IPC/worker-transfer time before static-analysis limits apply; performance testing remains necessary.
- Ignore files are read at the project root only. The supported `.gitignore` / `.repolensignore` behavior is a tested subset, **not full Git compatibility**; nested ignore files, Git index/global excludes, and all Git quoting/escaping and matching edge cases are not claimed.
- Sensitive-path filtering is based on names and paths, not content inspection; it cannot find secrets embedded in ordinary source files. Scanning sensitive paths requires explicit opt-in and risk acknowledgement.
- Persistent history contains bounded summary records only (counts, language/technology evidence, status, timestamps, and warnings). Full scan inventories, hashes, source text, analysis results, and graph data are not persisted. The in-memory graph provider is capped at 50 projects/six-hour age and is cleared on removal, cleanup, or app shutdown; scan and analysis result caches each retain at most 50 project entries.
- Graph engine limits: 150,000 nodes, 400,000 edges, 50,000 dependency references, 4,096-character normalized paths, 25,000,000 UTF-8 bytes per JSON export, 1,000 maximum reported cycles, and 250,000 cycle-enumeration transitions. GraphML is not implemented; the only graph export is validated JSON.
- No full graph visualization/Architecture Explorer, persistent graph storage, CLI graph command, incremental indexing, change-impact analysis, or framework/API/ORM discovery was added. The project-details report panel is limited to validated counts, a bounded page of graph nodes, and cycle paths.

## Remaining verification

- [ ] On a supported graphical machine with Electron's native runtime available, launch `npm run dev:desktop`; smoke-test native folder selection/import, scan and analysis progress/cancellation, results, history persistence/removal, app restart, and settings/theme behavior. Generate a graph explicitly from a completed scan and matching analysis; verify progress, partial/failure reporting, counts, visible nodes/cycles, and confirm project removal does not alter repository files. No graph-specific cancellation control is currently exposed.
- [ ] Revisit Angular initial-bundle and project-details stylesheet budgets before production packaging.

## Roadmap gate

Phase 5 explicit graph generation is implemented on `arena/08215937-repolens` and its automated checks have passed. The generation/report panel is not a full visualization. Do not treat this as release-complete or begin out-of-scope Architecture Explorer/visualization work until the native desktop import/scan/analysis/graph workflow has passed the GUI smoke test above and the outstanding release review is complete.
