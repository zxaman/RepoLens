# RepoLens

**Analyze once. Understand anywhere.**

RepoLens is an open-source, local-first codebase intelligence platform in early development. Its intended product combines an Electron desktop application, a standalone CLI, a reusable analysis engine, and portable analysis bundles. The current **v0.1.0 Foundation** establishes the workspace, package contracts, development tooling, a minimal Angular welcome screen, and a restricted Electron preload bridge. It does **not** analyze repositories yet.

## Product principles

- Repository analysis should happen locally by default.
- Core functionality should not require AI, cloud accounts, paid keys, or an external backend.
- The CLI and desktop app will share the same framework-independent analysis packages.
- Exported analysis should be portable and should omit source code unless a user explicitly opts in.
- Imported repositories and analysis bundles will be treated as untrusted input.

## Current components

- **Desktop renderer:** existing Angular 21 application, migrated to `apps/desktop` and prepared for Electron.
- **Electron shell:** main process and a context-isolated preload bridge; only application information is currently functional.
- **CLI:** Commander-based executable foundation with working `--version` and `--help` options.
- **Workspace packages:** typed foundations for shared contracts, core analysis, language support, SQLite/Drizzle access, exports, and optional AI.

## Technology foundation

- Angular 21 and TypeScript 5.9, with standalone components and strict template checking.
- Electron with `contextIsolation`, `sandbox`, and `nodeIntegration: false`.
- npm workspaces, TypeScript project builds, ESLint, Prettier, and Vitest.
- Zod for shared runtime contracts; Drizzle ORM types prepared for the later SQLite milestone.

Angular Material and Tailwind are intentionally not installed in this foundation milestone; there is no dashboard to style yet. No separate backend server is included.

## Requirements

- Node.js `>=22.12.0` (tested with Node 22.22.3).
- npm 10 or newer (tested with npm 10.9.8).

## Development commands

```bash
npm install
npm run build
npm run test
npm run lint
npm run typecheck
npm run format

# Angular renderer in a browser for UI development
npm run dev:web

# Angular renderer plus Electron shell (requires a graphical desktop session)
npm run dev:desktop

# After building the CLI
npm run cli -- --version
npm run cli -- --help
```

The Electron application loads the built Angular renderer from `file://` unless the local development runner explicitly supplies the Angular dev-server URL. `window.repolens` is exposed only by the preload bridge; a browser-only run reports that Electron is not connected.

## Project status

The project is under active development. See [PROJECT_STATUS.md](PROJECT_STATUS.md) for verified tasks, build/test state, limitations, and the next milestone. Repository scanning, AST parsing, dependency analysis, dashboards, persistence, export bundles, the offline viewer, and AI providers are planned—not implemented—in this release.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Installation](docs/INSTALLATION.md)
- [Development guide](docs/DEVELOPMENT.md)
- [IPC and Electron security](docs/IPC_ARCHITECTURE.md)
- [Package structure](docs/PACKAGE_STRUCTURE.md)
- [Roadmap](docs/ROADMAP.md)

## License

MIT. See [LICENSE](LICENSE).
