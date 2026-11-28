# Project management (v0.2.0 foundation)

This document describes the local project-registration lifecycle introduced in v0.2.0. A registered folder is a reference in RepoLens application data; import and metadata refresh do not scan or change it. Phase 3 adds an explicit scanner action on project details; its behavior, privacy limits, ignore semantics, and persistent history are documented in [Scanner](SCANNING.md).

## Import lifecycle

1. In the welcome or projects screen, the user invokes the native Electron folder picker. The renderer does not send a filesystem path.
2. If the picker is cancelled, the operation returns `{ kind: 'cancelled' }` and nothing is registered.
3. Electron resolves the selected path with `realpath`, verifies that it is an accessible directory, and rejects filesystem roots and known platform system locations. This resolves symlinks before duplicate and prohibited-path checks.
4. Electron checks a small allowlist of **top-level entry names** using metadata calls only. It records whether a marker exists and whether it is a file/directory; it never opens or parses marker contents. Markers are optional, and a folder does not need Git or package metadata:

   `.git`, `package.json`, `angular.json`, `tsconfig.json`, `vite.config.ts`, `next.config.js`, `requirements.txt`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `pom.xml`.

5. RepoLens compares the canonical path against its registry and returns either a duplicate record or a preview with a random selection ID. The preview token expires after five minutes and remains in Electron memory; no arbitrary renderer-supplied path is accepted.
6. The user explicitly confirms the preview. Electron revalidates the selected folder, checks for duplicates again, and creates the project record. The second check handles races between independent import requests.

Path keys normalize absolute paths and trailing separators. On Windows, comparison is case-insensitive. Because the stored path is canonical, selecting a symlink alias resolves to the same registration. Path validation and file access errors become structured, user-safe IPC errors.

## Registry and lifecycle

The JSON project registry is stored at `app.getPath('userData')/project-registry.json`. Its top-level format is versioned:

```json
{
  "version": 1,
  "projects": [],
  "activeProjectId": null
}
```

Each project is checked against the shared Zod `projectSchema` and includes an ID, display name, canonical root path, creation/update timestamps, optional last-opened time, registered/unavailable status, coarse Git/local type, and optional top-level marker names.

- **List / welcome:** projects are loaded from the registry and ordered by recent open time, then creation time. The welcome page shows up to the configured recent-project limit.
- **Open / switch:** selecting a registered project makes it active and records `lastOpenedAt`. An unavailable folder cannot be activated.
- **Details:** shows persisted registration metadata and current folder availability, plus the explicit Phase 3 scan controls, latest result, and per-project history. Full per-file metadata/hashes are available only for the current page session; saved history is summary-only.
- **Refresh:** revalidates folder access and refreshes the display name and optional marker metadata. It does not traverse the folder or inspect source files.
- **Unavailable folders:** a missing or inaccessible folder changes its status to unavailable; the registration stays in the registry until the user removes it.
- **Remove:** deletes the RepoLens registration and that project's scan-history summaries (and clears active/default references where applicable). A removal is rejected while that project's scan is running. It never calls a recursive delete on the selected repository.

## Settings

Settings are stored separately at `app.getPath('userData')/settings.json` and validated by the shared `appSettingsSchema`:

- `theme`: `system`, `light`, or `dark`; explicit choices are applied to the renderer, while `system` follows the operating-system color-scheme preference.
- `defaultProjectId`: optional project selected as active on application startup when no active project is already stored. It does not start a scan. Removing its project clears the reference.
- `confirmBeforeRemovingProject`: controls whether removal asks for confirmation.
- `recentProjectsLimit`: a whole number from 1 through 50.

The settings screen supports save and reset-to-defaults. Settings do not include analysis, database, network, or project-content options.

## Persistence and future SQLite migration

`JsonProjectRepository` and `JsonSettingsRepository` implement repository interfaces so storage can be replaced without exposing persistence to Angular. JSON writes use a unique temporary file in the same directory followed by a rename; newly created data directories/files use restrictive permissions. If stored JSON is malformed or fails its schema, RepoLens renames it to a timestamped `.corrupt-*` file and returns safe defaults rather than discarding the original data.

The current release is JSON-backed. SQLite/Drizzle schema, database driver, migrations, and a JSON-to-SQLite migration are **future work**. A future migration should add a SQLite repository adapter, validate and import the versioned JSON registry/settings transactionally, verify migrated records, and preserve the original JSON until migration succeeds. None of that migration behavior is claimed or run in v0.2.0.

## Renderer and IPC boundary

The standalone Angular screens are routed at `/welcome`, `/projects`, `/projects/:projectId`, and `/settings`. Renderer services use only the approved `window.repolens` API. Electron owns folder picking, path validation, registry/settings/history reads and writes, and scan worker lifecycle. Shared Zod contracts validate requests, scan configuration, results, and progress across IPC; sender, channel, and payload checks are enforced in the main process. See [IPC architecture](IPC_ARCHITECTURE.md) for the validated start/cancel/history API.

## Explicit non-goals

Project registration itself still does not recursively scan folders or read marker contents. The explicit Phase 3 scanner performs iterative discovery, classification, extension-based language statistics, allowlisted package/config evidence checks, and SHA-256 hashing. Ignore files and package manifests are capped at 1 MiB each, and hashing has a configurable per-file limit; there is not yet a total file/directory-count limit. Scanning does not execute scripts, install dependencies, initialize Git, modify/upload the repository, parse ASTs/symbols, construct dependency graphs, analyze APIs/models, export bundles, use AI, or use SQLite. See [Scanner](SCANNING.md) for the current ignore/sensitive-file limits and the remaining later-phase work.
