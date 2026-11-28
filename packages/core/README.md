# `@repolens/core`

`@repolens/core` contains RepoLens's reusable local scanning engine and bounded static-analysis pipeline. It depends only on `@repolens/shared`; filesystem and parser implementations are supplied by the host through narrow interfaces. It has no Angular, Electron, or direct Node.js dependency.

## Scanner

The Phase 3 scanner provides:

- Iterative directory-tree discovery with canonical-root boundary checks, in-root de-duplication, symlink-cycle handling, and cancellation.
- Conservative built-in/user exclusions plus documented root `.gitignore` / `.repolensignore` subset support. Mandatory safety exclusions and sensitive-file defaults cannot be negated.
- File classification, extension-derived language statistics, `package.json` evidence reads capped at 1 MiB per file, filename-based configuration evidence, metadata, streaming SHA-256 orchestration, warnings, and schema-validated results/progress.
- Safe-by-default sensitive-path exclusion; `ScanConfig` requires an explicit risk acknowledgement to opt in.

## Static analysis

The Phase 4 `analyzeScan` pipeline consumes an already validated `ScanResult`, a `StaticAnalysisFileSystem`, and one or more `StaticAnalysisParser` implementations. It does not start a scan. It bounds eligible source-file count, per-file and aggregate source/config bytes, parser concurrency, result collections, and diagnostics; checks cancellation; emits typed progress; and classifies local/alias/external/unresolved module relationships from the scan inventory. The built-in TypeScript Compiler API parser is provided by `@repolens/language-support`, not by core.

Core does not execute project code or commands, install dependencies, change imported repositories, upload contents, type-check code, construct dependency graphs, call AI, or persist results. See [Scanner documentation](../../docs/SCANNING.md), [Static Analysis](../../docs/STATIC_ANALYSIS.md), and the fixture-based tests in `src/`.
