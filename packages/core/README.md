# `@repolens/core`

`@repolens/core` contains RepoLens's reusable local scanning engine. It depends only on `@repolens/shared` and uses a narrow `ScanFileSystem` adapter supplied by the host; it has no Angular, Electron, or direct Node.js dependency.

The Phase 3 scanner provides:

- Iterative directory-tree discovery with canonical-root boundary checks, in-root de-duplication, symlink-cycle handling, and cancellation.
- Conservative built-in/user exclusions plus documented root `.gitignore` / `.repolensignore` subset support. Mandatory safety exclusions and sensitive-file defaults cannot be negated.
- File classification, extension-derived language statistics, `package.json` evidence reads capped at 1 MiB per file, filename-based configuration evidence, metadata, streaming SHA-256 orchestration, warnings, and schema-validated results/progress.
- Safe-by-default sensitive-path exclusion; `ScanConfig` requires an explicit risk acknowledgement to opt in.

The core does not execute project code or commands, install dependencies, change imported repositories, upload contents, parse ASTs/symbols, build dependency graphs, call AI, or persist results. See [Scanner documentation](../../docs/SCANNING.md) and the fixture-based tests in `src/scanner/scanner.service.test.ts`.
