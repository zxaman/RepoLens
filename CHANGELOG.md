# Changelog

## [0.1.0] - 2026-11-27

### Added

- npm workspace foundation and strict TypeScript package boundaries.
- Migrated the existing Angular 21 renderer into `apps/desktop`.
- Minimal RepoLens welcome screen with version obtained through Electron IPC when available.
- Electron main/preload structure with a typed, allowlisted bridge and sender validation.
- Commander CLI executable foundation with `--version` and `--help`.
- Shared Zod contracts and initial core, language-support, database, export, and optional AI interfaces.
- ESLint, Prettier, Vitest, documentation, and project status tracking.

### Not included

Repository scanning, parsing, persistence, graphs, API/model discovery, export generation, offline viewer, and AI providers remain future work.
