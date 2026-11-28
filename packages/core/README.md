# `@repolens/core`

`@repolens/core` contains RepoLens's reusable local scanning engine, bounded static-analysis pipeline, and in-memory graph engine. The package depends on `@repolens/shared`, Graphology, and `graphology-shortest-path`; its graph algorithms and DTOs do not depend on Angular, Electron, Cytoscape, or visualization code. Filesystem and parser implementations are supplied through narrow interfaces.

## Scanner

The Phase 3 scanner provides:

- Iterative directory-tree discovery with canonical-root boundary checks, in-root de-duplication, symlink-cycle handling, and cancellation.
- Conservative built-in/user exclusions plus documented root `.gitignore` / `.repolensignore` subset support. Mandatory safety exclusions and sensitive-file defaults cannot be negated.
- File classification, extension-derived language statistics, bounded `package.json` evidence reads, filename-based configuration evidence, metadata, streaming SHA-256 orchestration, warnings, and schema-validated results/progress.
- Safe-by-default sensitive-path exclusion; `ScanConfig` requires an explicit risk acknowledgement to opt in.

## Static analysis

The Phase 4 `analyzeScan` pipeline consumes an already validated `ScanResult`, a `StaticAnalysisFileSystem`, and one or more `StaticAnalysisParser` implementations. It does not start a scan. It bounds eligible source-file count, per-file and aggregate source/config bytes, parser concurrency, result collections, and diagnostics; checks cancellation; emits typed progress; and classifies local/alias/external/unresolved module relationships from the scan inventory. The built-in TypeScript Compiler API parser is provided by `@repolens/language-support`, not by core.

## Graph engine

The Phase 5 `buildProjectGraph` function asynchronously consumes the actual shared `AnalysisResult` from Phase 4. It does not scan, parse, or infer code relationships. It creates normalized project/folder/file nodes and supported symbol nodes; adds containment, import, and export edges only where Phase 4 evidence exists; and keeps external-package and unresolved dependency references distinct from resolved local/alias edges.

The returned `ProjectGraph` hides its Graphology instances and exposes schema-validated DTO operations for node queries (including bounded in-page edges), directional bounded neighborhoods, dependency/dependent traversal, shortest paths, metrics, strongly connected components, and bounded canonical simple-cycle enumeration. `InMemoryGraphProvider` replaces graphs by project ID, uses build-revision leases to reject stale publication, and supports disposal, expiration, and bounded LRU cleanup. JSON export is deterministic and validated against the shared graph schema. Graph instances and results are memory-only; GraphML and database/persistent graph storage are not implemented. Visualization stays outside this core package; the desktop renderer provides progressive, bounded Cytoscape exploration.

Graph construction accepts an optional cancellation signal, progress callback, batch size, and event-loop yield function. The host supplies yielding behavior, so the core package stays independent of Node.js and Electron. See [Graph Engine](../../docs/GRAPH_ENGINE.md) for node/edge semantics, algorithms, limits, API boundaries, and current limitations.

Core does not execute project code or commands, install dependencies, change imported repositories, upload contents, type-check code, infer calls/inheritance/API routes/database models, call AI, or persist scan/analysis/graph results. See [Scanner documentation](../../docs/SCANNING.md), [Static Analysis](../../docs/STATIC_ANALYSIS.md), and the fixture-based tests in `src/`.
