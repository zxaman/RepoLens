# Changelog

## [0.2.0] - 2026-11-27

### Added

- Shared Zod contracts for projects, import previews/results, application settings, and structured IPC results.
- Native Electron folder selection with canonical path validation, root/system-directory safeguards, optional top-level marker detection, duplicate prevention, and an explicit confirmation step.
- A version-1 JSON project registry and a separate JSON settings file in Electron `userData`, backed by repository interfaces and atomic file replacement. Invalid persisted JSON is preserved as a quarantined file before safe defaults are used.
- Project registration, listing, active-project selection, metadata refresh, unavailable-folder preservation, and registration-only removal.
- Guarded project/settings IPC handlers and narrow preload methods with sender, payload, channel, and response validation.
- Angular welcome, project list, project details, and settings screens. The details view reports “Not scanned yet”; no analysis results are fabricated.
- Persistent theme, startup project preference, removal-confirmation, and recent-project-limit settings.
- Temporary-directory tests for project path validation, JSON persistence, duplicate/concurrent registration, import lifecycle, unavailable folders, settings, IPC/preload validation, and theme application.
- Renderer development startup now works from the repository root with the original `ng serve` command (or `npm start`), resolving shared contracts directly from workspace source instead of relying on generated package declarations.

### Security and scope

- Project folders are not recursively scanned, their files are not read, and their scripts or dependencies are not executed or installed. Import and removal do not modify or delete repository contents.
- The registry repository interface is suitable for a future SQLite adapter; SQLite persistence and JSON-to-SQLite migration are not part of this release.

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
