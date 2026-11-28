# RepoLens

**Understand your codebase.**

RepoLens is an open-source, local-first desktop project in active development. The current **v0.2.0 — Project Management** milestone lets you register local folders, revisit them, and save application preferences. It does **not** scan or analyze repository contents yet.

## v0.2.0 capabilities

- Import a local folder with Electron's native folder picker, review its details, then confirm registration.
- Register ordinary folders whether or not they contain Git metadata or a package manifest. A small allowlist of top-level markers is optional metadata only; RepoLens does not read their contents.
- Normalize canonical paths, detect duplicate registrations (including symlink aliases and Windows path casing), and preserve registrations whose folders are temporarily unavailable.
- List, activate, refresh basic folder metadata, and remove project registrations. Removing a registration never removes or edits the original folder.
- Persist the versioned project registry and application settings separately under Electron's `userData` directory. Settings include theme, startup project preference, removal confirmation, and the welcome-screen recent-project limit.
- Keep the renderer browser-only. Angular talks to the Electron main process only through the typed, runtime-validated `window.repolens` preload API.

**No recursive scan or analysis is performed in v0.2.0.** Project details truthfully show “Not scanned yet.” RepoLens does not execute project scripts, install dependencies, initialize Git, modify repository files, upload source, or expose arbitrary paths or shell commands. Treat imported folders as untrusted.

## Architecture

- **Desktop renderer:** Angular 21 standalone application in `apps/desktop/src`; it has no Node.js filesystem or Electron APIs.
- **Electron main/preload:** the main process owns the native folder picker, validation, IPC, and local persistence. The sandboxed preload exposes only approved typed methods.
- **Shared contracts:** `packages/shared` defines Zod-validated project, import, settings, and result contracts shared across the IPC boundary.
- **Persistence:** a repository abstraction currently uses a version-1 JSON registry and a separate JSON settings file, with atomic replacement and malformed-file quarantine. SQLite/Drizzle persistence and migration are future work.
- **Other workspaces:** the CLI is still an executable foundation (`--version` / `--help`); core analysis, language support, database, export, and optional AI packages remain foundations rather than working scanner features.

See [Architecture](docs/ARCHITECTURE.md), [Project Management](docs/PROJECT_MANAGEMENT.md), and [IPC architecture](docs/IPC_ARCHITECTURE.md) for details.

## Technology and requirements

- Node.js `>=22.12.0` (verified with Node 22.22.3) and npm 10 or newer (verified with npm 10.9.8).
- Angular 21, TypeScript 5.9, Electron, npm workspaces, Zod, Vitest, ESLint, and Prettier.
- Electron runs with context isolation, sandboxing, `nodeIntegration: false`, a restrictive Content Security Policy, sender validation, and an allowlisted IPC surface.

## Development

```bash
npm ci
npm run build
npm run typecheck
npm test
npm run lint
npm run format:check

# Start Angular directly from the repository root; project/settings APIs need Electron
ng serve

# Optional npm alias for the same command
npm start

# Desktop app with the Angular dev server (requires Electron's native binary and a display)
npm run dev:desktop

# CLI foundation; no project scanning command is implemented
npm run cli -- --version
npm run cli -- --help
```

`npm run build` builds the workspace packages, CLI, Electron TypeScript/preload bundle, and production Angular renderer. Running the Electron GUI additionally requires the native Electron binary and a graphical session.

## Data and privacy

All project registrations and settings stay in the application's local `userData` directory (`project-registry.json` and `settings.json`). The import flow resolves the selected directory, checks that it is an accessible directory outside filesystem roots and known system locations, and inspects only direct directory entries for optional markers. It does not traverse the folder tree or read source files. Project removal deletes only RepoLens metadata.

## Project status

See [PROJECT_STATUS.md](PROJECT_STATUS.md) for verification results, known environment limitations, and the next milestone. The Electron GUI has not been launched in this sandbox because its native binary could not be downloaded and no display server is available; do not interpret successful compilation as a GUI launch test.

## Documentation

- [Project management](docs/PROJECT_MANAGEMENT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [IPC and Electron security](docs/IPC_ARCHITECTURE.md)
- [Installation](docs/INSTALLATION.md)
- [Development guide](docs/DEVELOPMENT.md)
- [Package structure](docs/PACKAGE_STRUCTURE.md)
- [Roadmap](docs/ROADMAP.md)
- [Security policy](docs/SECURITY.md)

## License

MIT. See [LICENSE](LICENSE).
