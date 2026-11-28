# Phase 3 scanner

RepoLens scans only an explicitly registered project. The Angular renderer sends a project ID and validated options; it never supplies a filesystem path. Electron main resolves the project record and starts a worker thread with a root path it already owns. The worker uses a narrow Node filesystem adapter and calls the reusable `@repolens/core` engine. No backend server or imported-project runtime is involved.

## What a scan does

1. Resolves and verifies the registered root directory.
2. Reads the two supported root ignore files, subject to a 1 MiB per-file limit.
3. Recursively discovers files and directories without following symbolic links outside the canonical root. In-root targets are de-duplicated; cycles and out-of-root links are skipped with warnings.
4. Applies mandatory exclusions, sensitive-path defaults, built-in/user exclusions, and project ignore rules in the precedence below.
5. Classifies discovered files as source, configuration, package manifest, documentation, asset, or other; records relative path, extension, size, modified time, and an extension-derived language where known.
6. Computes streaming SHA-256 digests for eligible files under the configured per-file size limit. The default limit is 50 MiB; the schema permits up to 1 GiB. Larger files are listed with `skipped-size-limit` and no digest.
7. Reads `package.json` manifests (up to 1 MiB each) for allowlisted declared package names and a Node engine declaration; other configuration evidence is filename-based. It never executes package scripts, imports project code, resolves/installs dependencies, or inspects ASTs/symbols.
8. Returns a validated result to the renderer and persists a bounded per-project history summary.

The scan result contains per-file metadata and hashes in renderer memory while the project page is open. The JSON history stores at most 50 summaries per project (counts, languages, technologies, warnings, status and timestamps); it does **not** persist file inventories, file hashes, or file contents. No project file contents are returned to the renderer or written to RepoLens persistence.

## Ignore rules and precedence

RepoLens reads `.gitignore` and `.repolensignore` **at the project root only**. It implements a deliberately limited pattern subset; this is not full Git compatibility and does not implement nested ignore files, every quoting/escaping rule, global excludes, Git index state, or all edge cases. Supported forms are blank/comment lines, positive patterns, `!` negations, leading `/` anchoring, trailing `/` directory-only rules, `*`, `**`, `?`, and basic bracket character classes.

Rules are applied in this order (later project rules can override earlier project rules only):

1. **Mandatory safety exclusions:** `.git` and `node_modules` are never re-included, even by negation.
2. **Sensitive-path protection:** sensitive names are excluded by default. Enabling the advanced option requires a separate acknowledgement; sensitive contents are still never returned or written to history.
3. **Built-in and user directory exclusions:** the default directory names are `node_modules`, `.git`, `dist`, `build`, `coverage`, `.angular`, `vendor`, `.next`, `.nuxt`, `.cache`, `.tmp`, and `temp`. User-added directory names are single path segments and exclude matches at any depth.
4. **Additional user patterns:** positive relative patterns supplied in scan options. They cannot be absolute, contain `..`, or use `!`; project ignore files cannot undo these user exclusions.
5. **Root `.gitignore` rules.** Within a file, the last matching rule wins.
6. **Root `.repolensignore` rules.** They are applied after `.gitignore`, so the last matching RepoLens rule can override a project Git rule. Re-including a child requires the ignored parent directories to be re-included as well.

A missing/unreadable/oversized ignore file does not stop the scan; RepoLens records a warning and continues with the other applicable rules. Malformed patterns are skipped and reported. The project-details UI describes the supported subset and gives users a field for extra positive exclusions.

## Sensitive files

Sensitive-path filtering is enabled by default. The initial denylist includes common `.env` names, credential files, private-key filenames/extensions, and directories such as `.ssh`, `.aws`, `.azure`, `.gnupg`, `.kube`, `credentials`, `secret`, and `secrets`. For in-root symlinks, both the visible alias and canonical target path are checked so a harmless-looking alias cannot bypass a sensitive-target exclusion. This name-based protection is intentionally conservative but cannot identify every secret embedded in arbitrary source files.

The user may opt in for a scan only after acknowledging that sensitive paths can contain credentials/private keys and that file paths and SHA-256 digests will be visible in the current result. The setting is per scan and is not silently persisted. Mandatory `.git` and `node_modules` exclusions remain in force. RepoLens never searches file contents for secret values or displays/persists raw contents.

## Progress, cancellation, and safety

- Progress is based on actual directory reads, file discovery, classification, package evidence reads, and hashes. The worker coalesces high-frequency progress messages before forwarding them to the renderer.
- The Cancel button sends a project-scoped scan ID to Electron main and receives a cancellation acknowledgement. The worker stops at its next asynchronous work boundary if cancellation arrives before completion, then returns and persists a `cancelled` result with work completed so far. If completion wins the race, the completed result is kept. Worker cleanup runs in `finally`.
- Hashing is streamed in bounded chunks. Ignore and package manifests are limited to 1 MiB each. Files above the per-file hash limit are not hashed.
- The filesystem adapter canonicalizes each target and checks it remains within the canonical project root before text reads and hashes. Final-file opens use no-follow semantics where the platform supports them. Directory and file symlinks that resolve outside the root are not traversed.
- Only Electron main/worker accesses the filesystem. The shared core has no Angular/Electron dependency. The imported repository is never modified; no imported code/commands run, dependencies install, network calls occur, or contents upload.

## Scan result and history

`window.repolens.scans.start(projectId, config?)` returns the validated full `ScanResult`, including per-file metadata/hash status, language statistics, technology evidence, warnings, and errors. `onProgress` is a narrowly scoped event subscription with a disposer. `getHistory` and `getLatest` return saved summaries. History uses the existing atomic JSON persistence pattern in Electron `userData`; malformed history is quarantined before safe recovery. History is bounded to 50 summaries per project. Removing a project registration also removes its saved summaries and is blocked while that project's scan is active.

Technology names are evidence-based, not proof that a dependency is installed or used at runtime. A `confirmed` result means an explicit package/config marker was found; Node.js may be `inferred` from a `package.json` without an `engines.node` declaration. Detection is currently a small allowlist of common JavaScript package names and configuration filenames. Other manifests may be classified but are not parsed for technology evidence.

## Known limitations

- `.gitignore` compatibility is an intentionally tested subset, not Git's complete ignore implementation.
- The sensitive-file denylist is name/path based; it cannot detect secrets embedded inside otherwise ordinary source files.
- Technology detection does not parse dependency graphs, ASTs, symbols, APIs/models, or framework semantics. It does not verify that declared packages are installed or imported.
- Full file inventories/hashes are returned for the current scan but are not persisted in scan history. Incremental scanning, durable indexes, SQLite/Drizzle, exports, CLI scanning, and AI analysis remain later phases.
- There is no total file/directory-count ceiling or result pagination yet; runtime, memory use, and IPC result size can scale with the included repository. Very large repositories still need performance testing.
- Automated tests use the checked-in synthetic fixture at `fixtures/scanner/basic/`; they do not scan developer-machine repositories. The Electron GUI/native picker could not be manually launched in the current sandbox because the native Electron binary/display are unavailable.

See [Security](SECURITY.md), [IPC architecture](IPC_ARCHITECTURE.md), [Architecture](ARCHITECTURE.md), and [Project Status](../PROJECT_STATUS.md).
