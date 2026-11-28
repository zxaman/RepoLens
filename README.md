# RepoLens

**Understand your codebase.**

RepoLens is an open-source, local-first desktop project in active development. The project-management foundation registers local folders and saves application preferences. Phase 3 added a reusable local scanner, Phase 4 added bounded TypeScript/JavaScript AST analysis, and Phase 5 adds a reusable in-memory graph engine over those actual analysis results. The package version remains `0.2.0`; see [PROJECT_STATUS.md](PROJECT_STATUS.md) for the current milestone and verification state.

## Current capabilities

- Import a local folder with Electron's native folder picker, review its details, then confirm registration.
- Register ordinary folders whether or not they contain Git metadata or a package manifest. Optional import markers are metadata only.
- Normalize canonical paths, detect duplicate registrations (including symlink aliases and Windows path casing), and preserve registrations whose folders are temporarily unavailable.
- List, activate, refresh basic folder metadata, and remove project registrations. Removing a registration never removes or edits the original folder.
- Scan a registered project in a cancellable Electron worker thread: recursively discover files, apply bounded ignore and sensitive-file rules, classify files, detect extension-based languages and evidence-based technologies, record metadata, and compute streaming SHA-256 hashes.
- View real scan progress, per-file metadata and hashes for the current page session, language/technology evidence, warnings, and bounded per-project summary history. No mock analysis metrics are generated.
- Run bounded static analysis on the current validated scan inventory in a worker thread. Browse TypeScript/JavaScript symbols, import/export syntax, conservative local/alias/external dependency classifications, and diagnostics.
- Build an evidence-based Graphology dependency graph from the real Phase 4 `AnalysisResult`: query symbols/files, traverse direct/transitive/reverse local dependencies, find paths and cycles, inspect metrics, and request deterministic schema-validated JSON.
- Keep graph objects/results in process memory only; a newer analysis invalidates the previous graph, project removal disposes it, and application shutdown clears the provider. No graph visualization UI or persistent graph store is included.
- Persist the project registry, settings, and up to 50 scan-history summaries per project under Electron's `userData` directory. Saved summaries omit file contents, inventories, hashes, analysis results, and graph data.
- Keep the renderer browser-only. Angular uses the typed, runtime-validated `window.repolens` preload API; Electron owns filesystem access and persistence.

Scanning, static analysis, and graph construction remain deliberately narrow. They do not execute imported-project code or commands, install dependencies, modify the repository, upload contents, or call a backend/cloud/AI service. The scanner does not parse ASTs or resolve dependencies; Phase 4 reads only source/configuration files already listed in the current `ScanResult` and resolves imports only against that inventory plus scanned `tsconfig` aliases. Phase 5 builds only evidence-backed import/export/containment relationships from the validated `AnalysisResult`: it does not infer calls, inheritance, API routes, or database models. Graphs are in-memory and JSON-exportable through the narrow bridge, but are not persisted or visualized. Sensitive paths are excluded by default during scanning and require a scan-specific opt-in plus risk acknowledgement. `.gitignore` and `.repolensignore` support is a documented, tested root-level subset—not full Git compatibility. See [Scanner](docs/SCANNING.md), [Static Analysis](docs/STATIC_ANALYSIS.md), and [Graph Engine](docs/GRAPH_ENGINE.md) for limits and behavior.

## Architecture

- **Desktop renderer:** Angular 21 standalone application in `apps/desktop/src`; it has no Node.js filesystem or Electron APIs.
- **Electron main/worker/preload:** the ESM main process validates project/config requests, owns filesystem access, starts and cancels scan/analysis workers, and persists local history. The sandboxed CommonJS preload exposes only approved typed methods and validated progress subscriptions.
- **Shared contracts:** `packages/shared` defines Zod-validated project, scan, analysis, and graph DTO/results/progress/history contracts.
- **Reusable core:** `packages/core` contains the framework-independent scanner, bounded static-analysis pipeline, and Graphology in-memory graph engine. They do not depend on Angular or Electron; graph construction accepts host-supplied progress, cancellation, and event-loop yielding.
- **Language support:** `packages/language-support` registers the TypeScript Compiler API parser for TypeScript and JavaScript syntax extraction.
- **Persistence:** project registry, settings, and bounded scan summaries use versioned JSON in Electron `userData`, with atomic replacement and malformed-file quarantine. Full scans and analysis results are memory-only; SQLite/Drizzle persistence and migration are future work.
- **Other workspaces:** the CLI remains an executable foundation (`--version` / `--help`); the graph engine is available as a library/bridge capability but has no visualization or CLI commands. Database indexing and advanced export/AI remain future work.

See [Architecture](docs/ARCHITECTURE.md), [Scanner](docs/SCANNING.md), [Static Analysis](docs/STATIC_ANALYSIS.md), [Graph Engine](docs/GRAPH_ENGINE.md), [Project Management](docs/PROJECT_MANAGEMENT.md), and [IPC architecture](docs/IPC_ARCHITECTURE.md).

## Technology and requirements

- Node.js `>=22.12.0` (verified with Node 22.22.3) and npm 10 or newer (verified with npm 10.9.8).
- Angular 21, TypeScript 5.9, Electron, npm workspaces, Zod, Vitest, ESLint, and Prettier.
- Electron runs with context isolation, sandboxing, `nodeIntegration: false`, a restrictive Content Security Policy, sender validation, and an allowlisted IPC surface.

## Run the desktop app

From the repository root, install dependencies and start the desktop app:

```bash
npm ci
npm run dev:desktop
```

`npm run dev:desktop` builds the workspace packages and Electron code, starts the Angular renderer locally, then opens it in a separate RepoLens Electron window. Use that desktop window to import a folder. The `http://localhost:4200/` address printed by Angular is only the renderer server that Electron loads; opening it in a browser does not provide the native project-management bridge. Keep the command running and wait for the Electron window—Angular's first development build can take a couple of minutes. A graphical desktop session and Electron's native binary are required.

## Development and validation

```bash
npm run build
npm run typecheck
npm test
npm run lint
npm run format:check
```

For renderer-only UI work, `ng serve` (also available as `npm start` or `npm run dev:web`) starts a browser preview. It does not include Electron's native APIs, so project import, scanning, and analysis are not available in that preview.

The CLI is a separate, early foundation and currently supports only version and help; it does not import, scan, or analyze projects:

```bash
npm run build:cli
npm run cli -- --version
npm run cli -- --help
```

`npm run build` builds the workspace packages, CLI, Electron TypeScript/preload bundle, and production Angular renderer. Scanner automated tests use only the checked-in synthetic fixture in `fixtures/scanner/basic/`; they do not traverse arbitrary developer-machine repositories. Running the Electron GUI additionally requires the native Electron binary and a graphical session.

## Data and privacy

Project registrations, settings, and bounded scan summaries remain in the application's local `userData` directory. The latest full scan result—including paths, metadata, and hashes—is held in application memory so the renderer can show it and static analysis can reuse its validated inventory; saved scan history contains summaries only. Analysis results and source text are not persisted. The main-process graph provider retains only the latest graph per project in memory, replaces it when a newer analysis starts, and clears it on removal, cleanup, or application shutdown. The scanner reads root ignore files, inspects bounded `package.json` manifests for allowlisted technology evidence, and detects other configuration evidence from filenames before streaming eligible file bytes for hashing. Static analysis reads only inventoried source/config files within fixed limits. File contents are not displayed or persisted. Imported-project code is never executed, dependencies are never installed, and the repository is never modified or uploaded.

## Project status

See [PROJECT_STATUS.md](PROJECT_STATUS.md) for the exact verification results, known limitations, and any incomplete acceptance criteria. The Electron GUI/native picker has not been launched in this sandbox because its native binary could not be downloaded and no display server is available; compilation/tests are not a manual GUI smoke test.

## Documentation

- [Scanner and ignore support](docs/SCANNING.md)
- [Static analysis](docs/STATIC_ANALYSIS.md)
- [Graph engine](docs/GRAPH_ENGINE.md)
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
