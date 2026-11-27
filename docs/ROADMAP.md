# Roadmap

The release plan is milestone-based. A package interface or directory alone does not count as an implemented feature.

- **v0.1.0 — Foundation (complete):** npm workspaces, migrated Angular renderer, secure Electron bridge, shared contracts, CLI startup, package/test/tooling foundations.
- **v0.2.0 — Project management (implemented):** local folder import, project registration, recent-project listing, project metadata, foundational settings, and JSON-backed local persistence. Recursive scanning is not part of this milestone; see [Project Management](PROJECT_MANAGEMENT.md).
- **v0.3.0 — Scanner:** bounded discovery/ignore rules, source and configuration discovery, language and technology detection, progress, scan history.
- **v0.4.0 — Static analysis:** TypeScript/JavaScript AST parsing, symbols, imports, exports, dependency resolution.
- **v0.5.0 — Graph engine:** dependency graphs, circular-dependency detection, graph queries and export.
- **v0.6.0 — Persistence:** SQLite/Drizzle schema, migrations, incremental scans, history, and a planned migration from the v0.2 JSON registry/settings.
- **v0.7.0 — Dashboard:** real indexed statistics, architecture, file, and dependency exploration.
- **v0.8.0 — Advanced analysis:** Angular/Express/Mongoose discovery, impact analysis, reports.
- **v0.9.0 — Export:** validated ZIP format, JSON/Markdown/SVG, checksums, standalone offline viewer.
- **v0.10.0 — CLI and optional AI:** analysis commands, Ollama/provider abstraction, bounded retrieval context.
- **v1.0.0 — Production:** security and performance review, cross-platform packaging, full documentation and release.

Features will be moved to completed only after implementation and tests exist. Core functionality remains useful with AI disabled. The Electron GUI still requires a supported runtime and graphical environment for manual launch verification.
