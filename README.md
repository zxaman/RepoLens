# RepoLens

**Understand your codebase.**

RepoLens is an open-source, local-first desktop project in active development. The project-management foundation registers local folders and saves application preferences. Phase 3 added a reusable local scanner; Phase 4 adds optional bounded TypeScript/JavaScript AST analysis that reuses the latest in-memory scan result. The package version remains `0.2.0`; see [PROJECT_STATUS.md](PROJECT_STATUS.md) for the current milestone and verification state.

## Current capabilities

- Import a local folder with Electron's native folder picker, review its details, then confirm registration.
- Register ordinary folders whether or not they contain Git metadata or a package manifest. Optional import markers are metadata only.
- Normalize canonical paths, detect duplicate registrations (including symlink aliases and Windows path casing), and preserve registrations whose folders are temporarily unavailable.
- List, activate, refresh basic folder metadata, and remove project registrations. Removing a registration never removes or edits the original folder.
- Scan a registered project in a cancellable Electron worker thread: recursively discover files, apply bounded ignore and sensitive-file rules, classify files, detect extension-based languages and evidence-based technologies, record metadata, and compute streaming SHA-256 hashes.
- View real scan progress, per-file metadata and hashes for the current page session, language/technology evidence, warnings, and bounded per-project summary history. No mock analysis metrics are generated.
- Run bounded static analysis on the current validated scan inventory in a worker thread. Browse TypeScript/JavaScript symbols, import/export syntax, conservative local/alias/external dependency classifications, and diagnostics.
- Persist the project registry, settings, and up to 50 scan-history summaries per project under Electron's `userData` directory. Saved summaries omit file contents, inventories, hashes, and analysis results.
- Keep the renderer browser-only. Angular uses the typed, runtime-validated `window.repolens` preload API; Electron owns filesystem access and persistence.

Scanning and static analysis remain deliberately narrow. Neither executes imported-project code or commands, installs dependencies, modifies the repository, uploads contents, or calls a backend/cloud/AI service. The scanner itself does not parse ASTs or resolve dependencies; the separate Phase 4 action reads only source/configuration files already listed in the current `ScanResult` and resolves local imports only against that inventory plus scanned `tsconfig` aliases. It does not type-check code or construct a runtime dependency graph. Sensitive paths are excluded by default during scanning and require a scan-specific opt-in plus risk acknowledgement. `.gitignore` and `.repolensignore` support is a documented, tested root-level subset—not full Git compatibility. See [Scanner](docs/SCANNING.md) and [Static Analysis](docs/STATIC_ANALYSIS.md) for limits and behavior.

## Architecture

- **Desktop renderer:** Angular 21 standalone application in `apps/desktop/src`; it has no Node.js filesystem or Electron APIs.
- **Electron main/worker/preload:** the ESM main process validates project/config requests, owns filesystem access, starts and cancels scan/analysis workers, and persists local history. The sandboxed CommonJS preload exposes only approved typed methods and validated progress subscriptions.
- **Shared contracts:** `packages/shared` defines Zod-validated project, scan and analysis configuration/results/progress/history, and error contracts.
- **Reusable core:** `packages/core` contains the framework-independent scanner and bounded static-analysis pipeline. Both use narrow filesystem/parser interfaces, not Angular or Electron.
- **Language support:** `packages/language-support` registers the TypeScript Compiler API parser for TypeScript and JavaScript syntax extraction.
- **Persistence:** project registry, settings, and bounded scan summaries use versioned JSON in Electron `userData`, with atomic replacement and malformed-file quarantine. Full scans and analysis results are memory-only; SQLite/Drizzle persistence and migration are future work.
- **Other workspaces:** the CLI remains an executable foundation (`--version` / `--help`); dependency graphs, database indexing, export, and optional AI remain future milestones.

See [Architecture](docs/ARCHITECTURE.md), [Scanner](docs/SCANNING.md), [Project Management](docs/PROJECT_MANAGEMENT.md), and [IPC architecture](docs/IPC_ARCHITECTURE.md).

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

# Start Angular directly from the repository root; project/scan APIs need Electron
ng serve

# Optional npm alias for the same command
npm start

# Desktop app with the Angular dev server (requires Electron's native binary and a display)
npm run dev:desktop

# CLI foundation; no project scanning command is implemented
npm run cli -- --version
npm run cli -- --help
```

`npm run build` builds the workspace packages, CLI, Electron TypeScript/preload bundle, and production Angular renderer. Scanner automated tests use only the checked-in synthetic fixture in `fixtures/scanner/basic/`; they do not traverse arbitrary developer-machine repositories. Running the Electron GUI additionally requires the native Electron binary and a graphical session.

## Data and privacy

Project registrations, settings, and bounded scan summaries remain in the application's local `userData` directory. The latest full scan result—including paths, metadata, and hashes—is held in application memory so the renderer can show it and static analysis can reuse its validated inventory; saved scan history contains summaries only. Analysis results and source text are also memory-only and are discarded when their page/worker or the application closes. The scanner reads root ignore files, inspects `package.json` manifests up to 1 MiB for allowlisted technology evidence, and detects other configuration evidence from filenames before streaming eligible file bytes for hashing. Static analysis reads only inventoried source/config files within fixed limits. File contents are not displayed or persisted. Imported-project code is never executed, dependencies are never installed, and the repository is never modified or uploaded.

## Project status

See [PROJECT_STATUS.md](PROJECT_STATUS.md) for the exact verification results, known limitations, and any incomplete acceptance criteria. The Electron GUI/native picker has not been launched in this sandbox because its native binary could not be downloaded and no display server is available; compilation/tests are not a manual GUI smoke test.

## Documentation

- [Scanner and ignore support](docs/SCANNING.md)
- [Static analysis](docs/STATIC_ANALYSIS.md)
- [Project management](docs/PROJECT_MANAGEMENT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [IPC and Electron security](docs/IPC_ARCHITECTURE.md)
- [Security policy](docs/SECURITY.md)
- [Installation](docs/INSTALLATION.md)
- [Development guide](docs/DEVELOPMENT.md)
- [Package structure](docs/PACKAGE_STRUCTURE.md)
- [Roadmap](docs/ROADMAP.md)

## License

MIT. See [LICENSE](LICENSE).
