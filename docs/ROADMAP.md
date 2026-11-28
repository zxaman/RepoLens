# Roadmap

A package interface, directory, or UI placeholder alone does not count as an implemented feature. Items are marked complete only after implementation and automated tests exist; manual platform checks are tracked separately.

- **v0.1.0 — Foundation (complete):** npm workspaces, migrated Angular renderer, secure Electron bridge, shared contracts, CLI startup, package/test/tooling foundations.
- **v0.2.0 — Project management (implemented):** local folder import, project registration, recent-project listing, project metadata, foundational settings, and JSON-backed registry/settings persistence. See [Project Management](PROJECT_MANAGEMENT.md).
- **v0.3.0 — Scanner (implemented in this work):** reusable filesystem-adapter-based scan engine, recursive discovery, conservative root ignore subset, sensitive-file defaults/acknowledged opt-in, classification, extension-derived language stats, package/config evidence detection, metadata, streaming SHA-256, real progress, cooperative cancellation, validated Electron worker/IPC/preload integration, project-details UI, fixture tests, and bounded per-project JSON history summaries. Full `.gitignore` compatibility and persisted per-file inventories are not claimed; see [Scanner](SCANNING.md).
- **v0.4.0 — Static analysis (implementation on this branch):** bounded worker-thread TypeScript/JavaScript AST parsing, symbols, imports, exports, conservative dependency classification, cancellation, typed IPC, and project-details UI. Do not treat this as a release-complete milestone until the implementation is reviewed and its verification state is recorded in [Project Status](../PROJECT_STATUS.md).
- **v0.5.0 — Graph engine (future):** dependency graphs, circular-dependency detection, graph queries, and graph export.
- **v0.6.0 — Persistence (future):** SQLite/Drizzle schema, migrations, incremental indexing/history design, and a planned migration from JSON registry/settings/scan summaries.
- **v0.7.0 — Dashboard (future):** real indexed statistics, architecture, file, and dependency exploration.
- **v0.8.0 — Advanced analysis (future):** Angular/Express/Mongoose discovery, impact analysis, and reports.
- **v0.9.0 — Export (future):** validated ZIP format, JSON/Markdown/SVG, checksums, standalone offline viewer.
- **v0.10.0 — CLI and optional AI (future):** analysis commands, Ollama/provider abstraction, and bounded retrieval context.
- **v1.0.0 — Production:** security/performance review, cross-platform packaging, full documentation, and release.

Features are not considered production-ready until manual supported-platform checks and the security/performance review are complete. The Electron GUI/native picker still requires a supported runtime and graphical environment for manual launch verification.
