# Phase 4 static analysis

RepoLens static analysis is an explicit, local-only follow-up to a project scan. It consumes the validated `ScanResult` already held in memory; it does not launch another scan or reload a saved scan summary. Static analysis is available in the desktop application after a scan has returned an inventory.

## What is analyzed

The built-in parser uses the TypeScript Compiler API to parse scanned TypeScript, TSX, JavaScript, and JSX files. It extracts syntax-level records for:

- module, class, function, method, property, variable, parameter, interface, type, enum, namespace, and related symbols, with project-relative source locations and parent/export information;
- static, type-only, dynamic, CommonJS, and re-export import forms and their bindings;
- named, default, star, namespace, CommonJS, and assignment exports;
- dependency classifications for local modules, TypeScript path aliases, external package-style specifiers, and unresolved paths;
- parser, configuration, file-read, scan-incomplete, and result-limit diagnostics.

This is syntax extraction, not type checking, program execution, framework discovery, or a runtime dependency graph. RepoLens does not load project plugins, evaluate `tsconfig`/package scripts, install packages, or follow imports into `node_modules`. Dependency resolution is intentionally restricted to files in the scan inventory; it does not prove that an external package is installed or used at runtime. Ambiguous paths are left unresolved rather than guessed. `tsconfig.json` is read only when it is part of the validated scan inventory, up to 512 KiB per file, 100 files, and 4 MiB total. The parser uses local `baseUrl`/`paths` values (a `baseUrl` is limited to 1,024 characters and at most 256 path mappings are considered across the scanned configuration files) but does not follow `extends` files.

## Bounds and execution

Analysis runs in an Electron worker thread. The main process passes the trusted project root plus the scan result; the worker validates the request and result against shared Zod schemas. The filesystem adapter accepts only normalized relative paths in that result, checks containment under the registered root, and uses the scanner's safe file-read implementation. Each source read is capped by both the 1 MiB limit and the file size recorded in the scan; if a source/configuration file has grown beyond its scan-time size, RepoLens skips it with a diagnostic. This keeps aggregate source/config reads within the inventory-based budgets even if files change between scan and analysis. The adapter cannot read arbitrary paths supplied by the renderer. Source text stays in the worker and is discarded when work finishes; it is never returned, logged, or persisted.

The core analysis limits are:

| Limit                                                |                                                    Maximum |
| ---------------------------------------------------- | ---------------------------------------------------------: |
| Concurrent source-file parses                        |                                                          4 |
| Eligible source files selected                       |                                                     10,000 |
| Bytes per source file                                |                  1 MiB (also capped at its scan-time size) |
| Total source bytes considered                        |                                                     32 MiB |
| Symbols                                              |                                                     50,000 |
| Imports, exports, or dependencies in any output list |                                                     50,000 |
| Import bindings across the full result               |                                                     50,000 |
| Export-to-symbol links across the full result        |                                                     50,000 |
| Parser import/export work before resolution          | 50,000 combined, plus at most 3 concurrent in-flight files |
| Diagnostics                                          |                                                      2,000 |
| Scanned `tsconfig.json` files considered             |                                                        100 |
| Bytes per `tsconfig.json`                            |                512 KiB (also capped at its scan-time size) |
| Total `tsconfig.json` bytes read                     |                                                      4 MiB |
| TypeScript path mappings used across scanned configs |                                                        256 |
| `baseUrl` length                                     |                                                1,024 chars |

Files outside a limit are skipped or bounded with diagnostics. These limits cap source/config reads and AST/result work; Phase 3 scanning still has no total file/directory-count ceiling, so the full `ScanResult` and its IPC/worker handoff can scale with a very large repository before analysis limits apply. Analysis reports `completed`, `partial`, `cancelled`, or `failed`; a cancelled scan can still be analyzed from its available inventory, with an `SCAN_INCOMPLETE` diagnostic. Cancellation is cooperative and is observed between asynchronous read/parse work. Progress and cancellation are scoped to an analysis ID and the scan ID it consumes.

## Renderer and data lifetime

On project details, choose **Analyze scanned source** after a successful or cancelled scan. The page shows phase/progress, supports cancellation, and displays the result status and counts. Expand the symbols, imports, exports, dependencies, or diagnostics sections to inspect records; symbol search filters by name, kind, or path, and large tables are capped to the first 200 rows for display.

The full validated `ScanResult` needed by the analysis service and the `AnalysisResult` exist only in application memory. They are not written to JSON scan history, settings, or the project registry. Scan history remains summary-only. Navigating away clears the renderer's analysis result and requests cancellation of an in-flight run; closing the application discards all in-memory scan/analysis data. No analysis export or database persistence is implemented.

## Verification

- `npm run test:unit` covers contracts, parser extraction, resolution, limits, cancellation, read failures, worker coordination, IPC, and preload validation.
- `npm run test:angular --workspace=@repolens/desktop` covers the project-details analysis UI.
- `npm run test:electron-workers` builds the Electron ESM entry points and runs both emitted worker files against a temporary synthetic TypeScript project. It verifies that the compiled worker paths under `apps/desktop/dist/electron/services/` load and that analysis consumes the exact `ScanResult` returned by the scan worker. This does not launch the Electron window or native folder picker.

Dependency graphs, cycle detection, indexing, framework-specific discovery, impact analysis, reports, export, and AI are later milestones; this Phase 4 implementation does not include them.
