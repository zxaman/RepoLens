# Phase 5 graph engine

RepoLens Phase 5 includes a reusable Graphology-based, in-memory graph engine in `@repolens/core` plus an explicit graph-generation action on project details. It consumes the shared Phase 4 `AnalysisResult` returned by the real analysis worker; it does not scan or parse source, mock relationships, or infer dependencies from filenames/naming conventions. After generation the page shows validated graph counts and cycle paths alongside a progressive Cytoscape Architecture Explorer. The renderer never loads the entire graph at once: it starts from a bounded project neighborhood and expands/searches through validated queries.

## Construction and data model

`buildProjectGraph(analysisResult, options?)` is asynchronous. It validates the shared analysis result and its references, normalizes duplicate records deterministically, creates file nodes from the parser-confirmed `analyzedFiles` list (including files with no symbols or imports), adds paths evidenced by valid relationships, and builds a private Graphology graph. It rejects failed/cancelled analyses and completed/partial results with no successfully analyzed source files; a project-only graph is never used as an empty-analysis fallback. Identical source records with the same ID are deduplicated; conflicting records with the same ID, missing references, cross-file relationships, path/file-folder conflicts, and configured graph limits fail construction rather than being silently repaired.

The graph schema supports the following node types:

| Node type                     | Phase 5 construction                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `project`                     | One project node, ID `project:<projectId>`.                                                                                    |
| `folder`                      | Each parent path derived from a parser-confirmed or relationship-evidenced project-relative path; ID `folder:<relativePath>`.  |
| `file`                        | Each successfully analyzed source path plus valid resolved relationship endpoints; ID `file:<relativePath>`.                   |
| `class`                       | Phase 4 class symbols without a recognized Angular semantic role.                                                              |
| `component`                   | Phase 4 classes decorated with an imported `Component` from `@angular/core` (including import aliases and namespace imports).  |
| `service`                     | Phase 4 classes decorated with an imported `Injectable` from `@angular/core` (including import aliases and namespace imports). |
| `function`                    | Phase 4 functions, methods, constructors, and accessors.                                                                       |
| `interface`                   | Phase 4 interface symbols.                                                                                                     |
| `api-route`, `database-model` | Reserved schema types; Phase 4 currently supplies no reliable evidence to create these nodes.                                  |

Symbol node IDs are `symbol:<AnalysisSymbol.id>`. Symbol nodes retain the original symbol kind, name, file path, source location, and exported flag. The engine does not copy source contents into graph metadata. Other Phase 4 symbol kinds are not promoted to graph nodes, and no symbols are inferred from names.

The shared graph schema supports these edge types: `contains`, `imports`, `exports`, `calls`, `implements`, `extends`, `api-call`, and `uses-model`. Phase 5 currently emits only the first three:

- **`contains`** represents the project/folder/file path hierarchy and explicit Phase 4 symbol-parent relationships. Structural IDs use `contains:folder:<path>`, `contains:file:<path>`, and `contains:symbol:<symbolId>`.
- **`imports`** connects file nodes only for resolved Phase 4 `local` and `alias` dependencies. Each edge carries a stable ID (`edge:import:<dependencyId>`), dependency evidence ID, original import source location/specifier, dependency kind, and type-only flag.
- **`exports`** connects files to symbol nodes when export evidence names a symbol, and connects files for resolved local/alias re-exports. The edge retains the Phase 4 export evidence ID, location, and export name (or re-export dependency metadata).

External packages and unresolved imports remain in the exported dependency-reference list with their `kind`, package name or unresolved reason, source file, specifier, import ID, and source location. They do not get fabricated package/file nodes or resolved dependency edges. Re-export evidence for an external/unresolved target is retained as a dependency reference but does not create an `exports` edge.

The schemas allow additional edge categories for future evidence sources; their presence in the enum does not mean Phase 5 populates them. Calls, inheritance/implementation, API calls/routes, and ORM/database-model relationships are not inferred or emitted.

## Queries and metrics

A `ProjectGraph` exposes validated plain DTO methods; it keeps the Graphology objects private.

- `queryNodes` filters by node type, case-insensitive name substring, project-relative path prefix, and exported status. Results sort by stable code-point ID order and support pagination (`limit` defaults to 100 and is capped at 1,000). Each page includes only relationships whose two endpoints are on that page, capped at 2,000 with an `edgesTruncated` flag.
- `queryNeighborhood` starts at an existing node and follows directed relationships with `outgoing`, `incoming`, or `both` traversal, optional edge-type filters, depth 1–3, and a result cap of 250 nodes. The result includes the anchor and only real edges whose endpoints are returned, with node/edge truncation flags; edge payloads cap at 2,000.
- `traverseDependencies` performs cycle-safe breadth-first traversal of resolved local/alias imports. It supports outbound `dependencies` or reverse `dependents`, with depth from 1 to 100. Each file appears once at its shortest distance; results sort by distance then path.
- `findDependencyPath` returns a shortest directed local-dependency path, or `null` if either file is absent or unreachable. External and unresolved references are excluded from traversal/path algorithms.
- `getSummary` reports node/edge counts by type plus file/folder/symbol counts, Phase 4 files analyzed, resolved import-edge count, unique directed file-pair count, external/unresolved reference counts, isolated files, average and maximum unique outbound dependencies per file, SCC/cyclic-component counts, and self-loop count.

Metrics deliberately distinguish import evidence edges from unique dependency pairs: multiple imports between the same file pair remain separate evidence edges, while traversal and SCC analysis use one directed edge per unique resolved file pair. `isolatedFileCount` counts file nodes with neither inbound nor outbound resolved local dependencies.

## Cycles and strongly connected components

Strongly connected components use an iterative Kosaraju traversal over the directed local-dependency graph. `findCycles` reports the total SCC count, cyclic SCC members, bounded simple directed cycles, and whether enumeration was truncated. Cycles are canonicalized by rotation and emitted in stable order without duplicate rotations. Directed reverse cycles remain distinct when their edge order differs.

An SCC is **not** a single cycle: one strongly connected component can contain multiple simple cycles (including several overlapping paths). The cycle list enumerates simple cycles separately from the SCC membership list. Cycle enumeration is capped at 1,000 cycles (default 100) and 250,000 explored transitions; a `truncated: true` result means more cycles may exist. The graph query and SCC traversal are cycle-safe; no recursive DFS is used.

## Limits, progress, and cancellation

Shared graph limits are 150,000 nodes, 400,000 edges, 50,000 dependency references, 4,096 characters per normalized project-relative path, 2,000 relationships per node-query page or neighborhood, 250 nodes and 3 hops per neighborhood, and 25,000,000 UTF-8 bytes for JSON export. The Cytoscape renderer loads at most 600 paged search nodes in one view. The engine rejects absolute paths, backslashes, empty/dot/dot-dot path segments, control characters, duplicate conflicting identities, and invalid edge/dependency references.

`GraphBuildOptions` supports:

- `signal`: a read-only `aborted` flag checked during normalization, graph construction, metrics, and SCC processing;
- `onProgress`: schema-validated `preparing` (record normalization), `nodes`, `edges`, and `metrics` progress events; observers cannot interrupt construction by throwing;
- `batchSize`: checkpoint interval, default 500 and clamped to 1–10,000;
- `yieldToEventLoop`: host-supplied async yield function. `@repolens/core` does not import Node.js/Electron APIs; the desktop host supplies a `setImmediate` yield so cancellation and other IPC can be serviced during large builds.

On cancellation, core construction throws `GraphBuildCancelledError`; no partial graph is returned or published. The desktop graph-generation API currently does not expose an independent graph-cancel request. `analysis.cancel(analysisId)` applies only while the analysis worker is active; graph progress reports `preparing`, `nodes`, `edges`, and `metrics` while the separate generation action runs.

## Lifecycle and desktop boundary

`InMemoryGraphProvider` is keyed by project UUID. `beginBuild(projectId, analysisId)` removes the previous graph immediately and returns a revision lease. `publish` succeeds only if the lease still matches the current project entry and the graph metadata matches; stale builds cannot overwrite a newer analysis. `fail`, `disposeProject`, `dispose`, and `cleanup` support replacement, failed/cancelled builds, project removal, shutdown, expiry, and capacity eviction. Defaults cap the provider at 50 project entries and expire entries after six hours; cleanup is performed on new builds and graph-service requests (there is no persistent or background graph store).

Analysis results and current scan inventories are retained per project in bounded main-process memory. A separate `GraphManagementService.generate(projectId, scanId, analysisId)` action verifies a registered/available project, its matching current **completed** scan, and the matching schema-valid completed or partial analysis. Partial analysis is supported and produces warnings for skipped files; zero-file, failed, cancelled, stale, or out-of-inventory analysis is reported as a failure and is never built. The action acquires a provider revision lease, reuses the existing core builder, and returns a validated generation report with graph counts, relationship classifications, cycle count, and warnings. A newer analysis invalidates the previous graph; reads also reject graphs whose scan or analysis is no longer current.

Main-process IPC validates every project/scan/analysis ID and sender identity; the preload validates every request and response/progress payload. Progress is sent only to the renderer that initiated graph generation. The renderer receives only validated DTOs (summary, paginated node/edge pages, bounded neighborhoods, cycle reports, and the generation report), never a Graphology instance or unrestricted IPC access.

The narrow `window.repolens.graphs` bridge exposes `generate`, `summary`, `query`, `neighborhood`, `dependencies`, `shortestPath`, `cycles`, `exportJson`, `dispose`, and `onProgress`. The Cytoscape UI maps graph IDs to internal element IDs, validates project/edge references, displays real DTOs only, and makes search and neighborhood expansion separate bounded queries. Search pages are capped at 100 nodes per request and 600 nodes per rendered view; neighborhood requests expose depth/direction and edge-type controls. Graph results are not written to scan history, project JSON, settings, SQLite, or any other persistence layer. Closing the app discards all scan inventories, analysis results, and graph data; the in-memory scan/analysis caches retain up to 50 project entries.

## JSON export and non-goals

`exportJson()` emits deterministic, pretty-printed JSON with schema version `1.0.0`. Nodes, edges, dependencies, and metrics are validated by the shared Zod graph schemas; output is sorted by stable IDs and rejects payloads above the configured size limit. The renderer bridge returns the validated JSON string; there is no file-save UI.

GraphML was not added: Phase 5 needs only a versioned JSON interchange format, and no GraphML serializer/round-trip contract is used by the current application. SQLite/Drizzle graph persistence, incremental indexing, drawing the entire large graph in one renderer scene, custom advanced graph-layout/analysis features, graph-generation cancellation, CLI graph commands, report/ZIP/SVG/PNG export, change-impact analysis, framework/API/ORM discovery, and AI remain out of scope.

## Verification

Core construction, duplicate/reference validation, evidence-backed node/edge generation, directional bounded neighborhoods, shortest paths, query-page relationships, metrics, SCC/cycle canonicalization/truncation, deterministic JSON export, progress/yield/cancellation, provider replacement/stale leases/cleanup/disposal, shared DTO validation, graph IPC sender guards, bridge payloads, progressive search paging, and the desktop worker/workflow are covered by deterministic tests. Automated tests do not launch Electron's native window or folder picker; the Cytoscape viewport is compiled and exercised through Angular tests, but the supported-platform visual/native-picker smoke test remains outstanding. See [Project Status](../PROJECT_STATUS.md) for the current verification and GUI gap.
