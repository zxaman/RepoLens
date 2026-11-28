# Changelog

## [Unreleased] — Phase 4 static analysis (target v0.4.0; implementation under review)

### Added

- Shared Zod contracts and typed start/cancel/progress API for transient analysis results.
- TypeScript Compiler API parser for TypeScript/TSX/JavaScript/JSX syntax, symbols, imports, exports, path-alias/local dependency classification, and diagnostics.
- Bounded `@repolens/core` analysis over the exact current validated Phase 3 scan inventory, with cancellation, progress, source/config byte and file-count limits, result limits, and inventory-scoped file reads.
- Electron analysis worker/session/management/IPC/preload integration; Electron main retains the latest full scan only in memory, while analysis and source contents remain transient.
- Project-details analysis UI with progress, cancellation, searchable symbols, import/export/dependency tables, and diagnostics.
- Emitted Electron worker smoke tests, parser/pipeline/IPC/preload/service tests, and Angular UI tests. `npm run test:electron-workers` verifies the compiled worker output paths without launching Electron's native GUI.
- Static-analysis, architecture, security, IPC, package-structure, development, and project-status documentation updates.

### Security and limitations

- Analysis reads only scanned source/configuration paths, never executes project code, does not type-check or follow imports into `node_modules`, and does not write source or analysis results to persistence.
- Analysis produces syntax relationships, not a dependency graph. Full scan inventories still inherit Phase 3's lack of an overall file-count ceiling.
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
