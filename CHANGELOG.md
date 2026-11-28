# Changelog

## [Unreleased] — Phase 5 explicit graph generation (target v0.5.0; implementation on branch `arena/08215937-repolens`)

### Added

- Shared Zod contracts for analyzed-file inventories, graph-generation requests/reports, progress, nodes/edges/dependencies, queries/cycles, and JSON export, with normalized-path, identity, reference, and size validation.
- Framework-independent asynchronous Graphology construction from real Phase 4 `AnalysisResult` data. Parser-confirmed files remain in the graph even when they have no symbols/imports; relationships are evidence-backed, and resolved, external, and unresolved imports remain distinct.
- Explicit `graphs.generate(projectId, scanId, analysisId)` IPC/preload API and project-details report panel. Generation requires the matching current completed scan and completed/partial analysis, at least one analyzed source file, and inventory consistency; it revalidates current scan/analysis before publication.
- Partial-result warnings, user-safe failure reports for failed/stale/empty/out-of-inventory cases, and no partial or project-only graph publication.
- Project-ID-keyed in-memory graph lifecycle with revision leases, stale-publication prevention, replacement, disposal, age/capacity cleanup, and progress. Full scan inventories and analysis results use separate bounded 50-project LRU memory caches.
- Directed local dependency traversal/dependent queries with cycle-safe depth limits, shortest paths, deterministic node queries, metrics, iterative SCC detection, and bounded canonical simple-cycle enumeration.
- Deterministic graph-engine/provider/schema/service/IPC/bridge/UI tests and real worker/workflow assertions for explicit graph counts and cycles. See [Graph Engine](docs/GRAPH_ENGINE.md).

### Scope and limitations

- Only Phase 4 evidence is used. Graphs do not infer calls, inheritance, API routes, or database models. Project details shows a bounded report, node list, and cycle paths, but no full graph visualization/Architecture Explorer or CLI graph command.
- Graphs are transient and bounded in memory. JSON is the only graph export; GraphML, persistence/SQLite/Drizzle, incremental indexing, report/ZIP/SVG/PNG export, and change-impact analysis are not implemented. The core engine supports cancellation, but the desktop generation action has no graph-specific cancel control.
- Automated verification does not replace the outstanding supported-platform Electron GUI/native-picker/graph-generation smoke test.

### Verification

- `npm test` passed: 36 Vitest files / 122 tests, 4 Angular spec files / 11 tests, emitted worker smoke test, and desktop workflow integration covering explicit generation/progress, queries, paths, cycles, JSON export, disposal, scan cancellation, history, and source integrity. The worker smoke test built 6 nodes / 8 edges; the desktop workflow built 10 nodes / 16 edges with 1 cycle.
- `npm run build`, `npm run typecheck`, `npm run lint`, and `npm run format:check` passed. Production Angular output has non-fatal initial-bundle and component-style budget warnings; see [Project Status](PROJECT_STATUS.md).
- Electron's native GUI/picker and supported-platform manual smoke test remain unverified in this sandbox.

## [Unreleased] — Phase 4 static analysis (target v0.4.0; implementation under review)

### Added

- Shared Zod contracts and typed start/cancel/progress API for transient analysis results.
- TypeScript Compiler API parser for TypeScript/TSX/JavaScript/JSX syntax, symbols, imports, exports, path-alias/local dependency classification, and diagnostics.
- Bounded `@repolens/core` analysis over the exact current validated Phase 3 scan inventory, with cancellation, progress, source/config byte and file-count limits, result limits, and inventory-scoped file reads.
- Electron analysis worker/session/management/IPC/preload integration; Electron main retains full scan inventories and validated analysis results only in separate bounded per-project memory caches, while source contents remain transient.
- Project-details analysis UI with progress, cancellation, searchable symbols, import/export/dependency tables, and diagnostics.
- Emitted Electron worker smoke tests, parser/pipeline/IPC/preload/service tests, and Angular UI tests. `npm run test:electron-workers` verifies the compiled worker output paths without launching Electron's native GUI.
- Static-analysis, architecture, security, IPC, package-structure, development, and project-status documentation updates.

### Security and limitations

- Analysis reads only scanned source/configuration paths, never executes project code, does not type-check or follow imports into `node_modules`, and does not write source or analysis results to persistence.
- Phase 4 analysis produces syntax relationships; Phase 5 consumes them only through a separate explicit graph-generation action. Full scan inventories still inherit Phase 3's lack of an overall file-count ceiling.
- The Electron GUI/native-picker manual launch remains unverified in the sandbox because the native binary and graphical display are unavailable.

## [Unreleased] — Phase 3 scanner (target v0.3.0)

### Added

- Reusable core scanner with iterative directory-tree discovery; canonical-root and symlink-boundary checks; file classification; extension-derived language statistics; evidence-based technology detection; metadata; SHA-256 hashing; cancellation; progress; and safe warnings/errors.
- Root `.gitignore` and `.repolensignore` support for a documented, tested pattern subset with explicit precedence. Mandatory `.git`/`node_modules` exclusions and default sensitive-path protections cannot be overridden by project negation.
- Scan schemas for strict config, result/file metadata, progress, warnings/errors, and per-project history summaries. Sensitive inclusion requires an explicit per-scan opt-in and risk acknowledgement.
- Electron-owned Node filesystem adapter and worker-thread scan execution, validated start/cancel/history/latest IPC, a narrow preload progress subscription, and bounded versioned JSON scan-history persistence.
- Project-details scan controls, progress/cancellation, language/technology evidence, current-session file inventory/hash results, and saved summary history.
- Synthetic scanner fixtures, core filesystem/scanner tests, Node adapter/IPC/preload/history service tests, and Angular project-details tests.
- [Scanner documentation](docs/SCANNING.md), architecture/security/IPC updates, and Phase 3 status tracking.

### Security and limitations

- Scanning does not execute imported code or commands, install dependencies, modify or upload the repository, or call a backend/AI service.
- Root ignore support is a subset, not full Git compatibility. Sensitive-name filtering is conservative but not a detector for secrets embedded in ordinary source files.
- Full file inventories and hashes are returned for the current scan session; persisted history contains at most 50 summaries per project and does not retain per-file details or contents.
- Electron GUI/native-picker manual launch remains unverified in the sandbox because the Electron binary and graphical display are unavailable.

## [0.2.0] - 2026-11-27

### Added

- Shared Zod contracts for projects, import previews/results, application settings, and structured IPC results.
- Native Electron folder selection with canonical path validation, root/system-directory safeguards, optional top-level marker detection, duplicate prevention, and an explicit confirmation step.
- A version-1 JSON project registry and a separate JSON settings file in Electron `userData`, backed by repository interfaces and atomic file replacement. Invalid persisted JSON is preserved as a quarantined file before safe defaults are used.
- Project registration, listing, active-project selection, metadata refresh, unavailable-folder preservation, and registration-only removal.
- Guarded project/settings IPC handlers and narrow preload methods with sender, payload, channel, and response validation.
- Angular welcome, project list, project details, and settings screens. At that milestone the details view reported “Not scanned yet”; no analysis results were fabricated.
- Persistent theme, startup project preference, removal-confirmation, and recent-project-limit settings.
- Temporary-directory tests for project path validation, JSON persistence, duplicate/concurrent registration, import lifecycle, unavailable folders, settings, IPC/preload validation, and theme application.
- Renderer development startup from the repository root using `ng serve` (or `npm start`), with shared contracts resolved directly from workspace source.

### Security and scope

- The v0.2.0 import flow did not recursively scan folders, read source files, initialize Git, execute scripts, install dependencies, modify/delete repository files, upload source, or call cloud/AI services.
- The registry repository interface is suitable for a future SQLite adapter; SQLite persistence and JSON-to-SQLite migration were not part of that milestone.

### Verification notes

- The Electron GUI could not be launched in the sandbox: the native Electron binary download failed and the environment has no display server. Builds and automated tests do not constitute a GUI launch test.

## [0.1.0] - 2026-11-27

### Added

- npm workspace foundation and strict TypeScript package boundaries.
- Migrated the existing Angular 21 renderer into `apps/desktop`.
- Minimal RepoLens welcome screen with version obtained through Electron IPC when available.
- Electron main/preload structure with a typed, allowlisted bridge and sender validation.
- Commander CLI executable foundation with `--version` and `--help`.
- Shared Zod contracts and initial core, language-support, database, export, and optional AI interfaces.
- ESLint, Prettier, Vitest, documentation, and project status tracking.

### Not included in v0.1.0

Repository scanning, parsing, persistence, graphs, API/model discovery, export generation, offline viewer, and AI providers were future work at that milestone.
