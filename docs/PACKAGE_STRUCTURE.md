# Package structure

| Workspace                   | Responsibility in current work      | Current boundary                                                                                    |
| --------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------- |
| `apps/desktop`              | Angular renderer and Electron shell | Renderer uses the narrow preload; Electron owns project/scan filesystem access and JSON persistence |
| `apps/cli`                  | Commander executable                | Depends on shared and core; currently version/help only; no scan command                            |
| `packages/shared`           | Contracts and Zod schemas           | Project, import, settings, scan config/results/progress/history; no application dependencies        |
| `packages/core`             | Reusable local scanning engine      | Depends on shared only; framework-independent; filesystem access supplied through an adapter        |
| `packages/language-support` | Parser adapter contract             | No language parser registered; AST/symbol analysis remains future work                              |
| `packages/database`         | Drizzle SQLite boundary             | No driver, tables, migrations, or SQLite persistence yet                                            |
| `packages/export`           | Export format contracts             | No bundle or viewer generation yet                                                                  |
| `packages/ai`               | Optional provider contract          | No provider, credentials, or network behavior                                                       |

Project registrations, settings, and bounded scan-history summaries are local JSON files in Electron `userData`, accessed through interfaces in `apps/desktop/electron/services`. The `packages/database` foundation is not used for current persistence; SQLite/Drizzle and migration from JSON are future work.

Each package emits ESM JavaScript and TypeScript declarations to its ignored `dist/` directory. Package `exports` point to those build outputs. Root scripts enforce build order so workspace consumers resolve declarations from the built shared/core packages. Renderer and Electron TypeScript configurations remain separate to avoid mixing browser globals and Node/Electron types.
