# Phase 5 graph engine

RepoLens Phase 5 adds a reusable Graphology-based, in-memory graph engine in `@repolens/core`. It consumes the shared Phase 4 `AnalysisResult` returned by the real analysis worker; it does not scan or parse source, mock relationships, or infer dependencies from filenames/naming conventions. The graph API is available through the secure preload bridge, but there is no visualization or Architecture Explorer UI in this phase.

## Construction and data model

`buildProjectGraph(analysisResult, options?)` is asynchronous. It validates the shared analysis result and its references, normalizes duplicate records deterministically, derives project-relative folders/files from actual analysis paths, and builds a private Graphology graph. Identical source records with the same ID are deduplicated; conflicting records with the same ID, missing references, cross-file relationships, path/file-folder conflicts, and configured graph limits fail construction rather than being silently repaired.

The graph schema supports the following node types:

| Node type                                             | Phase 5 construction                                                                                  |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `project`                                             | One project node, ID `project:<projectId>`.                                                           |
| `folder`                                              | Each parent path derived from an observed project-relative analysis path; ID `folder:<relativePath>`. |
| `file`                                                | A file path present in symbol, import, export, or dependency evidence; ID `file:<relativePath>`.      |
| `class`                                               | Phase 4 class symbols.                                                                                |
| `function`                                            | Phase 4 functions, methods, constructors, and accessors.                                              |
| `interface`                                           | Phase 4 interface symbols.                                                                            |
| `component`, `service`, `api-route`, `database-model` | Reserved schema types; Phase 4 currently supplies no reliable evidence to create these nodes.         |

Symbol node IDs are `symbol:<AnalysisSymbol.id>`. Symbol nodes retain the original symbol kind, name, file path, source location, and exported flag. The engine does not copy source contents into graph metadata. Other Phase 4 symbol kinds are not promoted to graph nodes, and no symbols are inferred from names.

The shared graph schema supports these edge types: `contains`, `imports`, `exports`, `calls`, `implements`, `extends`, `api-call`, and `uses-model`. Phase 5 currently emits only the first three:

- **`contains`** represents the project/folder/file path hierarchy and explicit Phase 4 symbol-parent relationships. Structural IDs use `contains:folder:<path>`, `contains:file:<path>`, and `contains:symbol:<symbolId>`.
- **`imports`** connects file nodes only for resolved Phase 4 `local` and `alias` dependencies. Each edge carries a stable ID (`edge:import:<dependencyId>`), dependency evidence ID, original import source location/specifier, dependency kind, and type-only flag.
- **`exports`** connects files to symbol nodes when export evidence names a symbol, and connects files for resolved local/alias re-exports. The edge retains the Phase 4 export evidence ID, location, and export name (or re-export dependency metadata).

External packages and unresolved imports remain in the exported dependency-reference list with their `kind`, package name or unresolved reason, source file, specifier, import ID, and source location. They do not get fabricated package/file nodes or resolved dependency edges. Re-export evidence for an external/unresolved target is retained as a dependency reference but does not create an `exports` edge.

The schemas allow additional edge categories for future evidence sources; their presence in the enum does not mean Phase 5 populates them. Calls, inheritance/implementation, API calls/routes, and ORM/database-model relationships are not inferred or emitted.

## Queries and metrics

A `ProjectGraph` exposes validated plain DTO methods; it keeps the Graphology objects private.

- `queryNodes` filters by node type, case-insensitive name substring, project-relative path prefix, and exported status. Results sort by stable code-point ID order and support pagination (`limit` defaults to 100 and is capped at 1,000).
- `traverseDependencies` performs cycle-safe breadth-first traversal of resolved local/alias imports. It supports outbound `dependencies` or reverse `dependents`, with depth from 1 to 100. Each file appears once at its shortest distance; results sort by distance then path.
- `findDependencyPath` returns a shortest directed local-dependency path, or `null` if either file is absent or unreachable. External and unresolved references are excluded from traversal/path algorithms.
- `getSummary` reports node/edge counts by type plus file/folder/symbol counts, Phase 4 files analyzed, resolved import-edge count, unique directed file-pair count, external/unresolved reference counts, isolated files, average and maximum unique outbound dependencies per file, SCC/cyclic-component counts, and self-loop count.

Metrics deliberately distinguish import evidence edges from unique dependency pairs: multiple imports between the same file pair remain separate evidence edges, while traversal and SCC analysis use one directed edge per unique resolved file pair. `isolatedFileCount` counts file nodes with neither inbound nor outbound resolved local dependencies.

## Cycles and strongly connected components

Strongly connected components use an iterative Kosaraju traversal over the directed local-dependency graph. `findCycles` reports the total SCC count, cyclic SCC members, bounded simple directed cycles, and whether enumeration was truncated. Cycles are canonicalized by rotation and emitted in stable order without duplicate rotations. Directed reverse cycles remain distinct when their edge order differs.

An SCC is **not** a single cycle: one strongly connected component can contain multiple simple cycles (including several overlapping paths). The cycle list enumerates simple cycles separately from the SCC membership list. Cycle enumeration is capped at 1,000 cycles (default 100) and 250,000 explored transitions; a `truncated: true` result means more cycles may exist. The graph query and SCC traversal are cycle-safe; no recursive DFS is used.

## Limits, progress, and cancellation

Shared graph limits are 150,000 nodes, 400,000 edges, 50,000 dependency references, 4,096 characters per normalized project-relative path, and 25,000,000 UTF-8 bytes for JSON export. The engine rejects absolute paths, backslashes, empty/dot/dot-dot path segments, control characters, duplicate conflicting identities, and invalid edge/dependency references.

`GraphBuildOptions` supports:

- `signal`: a read-only `aborted` flag checked during normalization, graph construction, metrics, and SCC processing;
- `onProgress`: schema-validated `preparing` (record normalization), `nodes`, `edges`, and `metrics` progress events; observers cannot interrupt construction by throwing;
- `batchSize`: checkpoint interval, default 500 and clamped to 1–10,000;
- `yieldToEventLoop`: host-supplied async yield function. `@repolens/core` does not import Node.js/Electron APIs; the desktop host supplies a `setImmediate` yield so cancellation and other IPC can be serviced during large builds.

On cancellation, construction throws `GraphBuildCancelledError`; no partial graph is returned or published. In the desktop flow, `analysis.cancel(analysisId)` also cancels a graph build that is still in progress, and a terminal `graphs:progress` event reports `phase: "cancelled"`.

## Lifecycle and desktop boundary

`InMemoryGraphProvider` is keyed by project UUID. `beginBuild(projectId, analysisId)` removes the previous graph immediately and returns a revision lease. `publish` succeeds only if the lease still matches the current project entry and the graph metadata matches; stale builds cannot overwrite a newer analysis. `fail`, `disposeProject`, `dispose`, and `cleanup` support replacement, failed/cancelled builds, project removal, shutdown, expiry, and capacity eviction. Defaults cap the provider at 50 project entries and expire entries after six hours; cleanup is performed on new builds and graph-service requests (there is no persistent or background graph store).

For completed/partial `AnalysisResult`s, Electron's `AnalysisManagementService` starts the lease and builds the graph. `GraphManagementService` checks that the project remains registered and returns validated graph DTOs only. Main-process IPC validates every project ID/query and sender identity; the preload validates every response/progress payload. Progress is sent only to the renderer that initiated the analysis. The renderer never receives a Graphology instance or unrestricted IPC access.

The narrow `window.repolens.graphs` bridge exposes `summary`, `query`, `dependencies`, `shortestPath`, `cycles`, `exportJson`, `dispose`, and `onProgress`. Graph results are not written to scan history, project JSON, settings, SQLite, or any other persistence layer. Closing the app discards all graph data.

## JSON export and non-goals

`exportJson()` emits deterministic, pretty-printed JSON with schema version `1.0.0`. Nodes, edges, dependencies, and metrics are validated by the shared Zod graph schemas; output is sorted by stable IDs and rejects payloads above the configured size limit. The renderer bridge returns the validated JSON string; there is no file-save UI.

GraphML was not added: Phase 5 needs only a versioned JSON interchange format, and no GraphML serializer/round-trip contract is used by the current application. SQLite/Drizzle graph persistence, incremental indexing, graph visualization, CLI graph commands, report/ZIP/SVG/PNG export, change-impact analysis, framework/API/ORM discovery, and AI remain out of scope.

## Verification

Core construction, duplicate/reference validation, evidence-backed node/edge generation, traversal, shortest paths, query pagination, metrics, SCC/cycle canonicalization/truncation, deterministic JSON export, progress/yield/cancellation, provider replacement/stale leases/cleanup/disposal, shared DTO validation, graph IPC sender guards, bridge payloads, and the full desktop workflow are covered by deterministic tests. Automated workflow tests do not launch Electron's native window or folder picker; see [Project Status](../PROJECT_STATUS.md) for the current verification and manual GUI gap.
