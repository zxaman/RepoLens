# Package structure

| Workspace                   | Responsibility in v0.2.0            | Current boundary                                                                                       |
| --------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `apps/desktop`              | Angular renderer and Electron shell | Renderer calls the main process only through preload; Electron owns folder import and JSON persistence |
| `apps/cli`                  | Commander executable                | Depends on shared and core; currently version/help only                                                |
| `packages/shared`           | Contracts and Zod schemas           | Project, import, settings, and result contracts; no application dependencies                           |
| `packages/core`             | Reusable analysis engine contracts  | Depends on shared only; no scanner yet                                                                 |
| `packages/language-support` | Parser adapter contract             | No language parser registered yet                                                                      |
| `packages/database`         | Drizzle SQLite boundary             | No driver, tables, migrations, or SQLite persistence yet                                               |
| `packages/export`           | Export format contracts             | No bundle or viewer generation yet                                                                     |
| `packages/ai`               | Optional provider contract          | No provider, credentials, or network behavior                                                          |

Project registrations and settings are currently local JSON files in Electron `userData`, accessed through interfaces in `apps/desktop/electron/services`. The `packages/database` foundation is not used for v0.2.0 persistence; SQLite/Drizzle and migration from JSON are future work.

Each package emits ESM JavaScript and TypeScript declarations to its ignored `dist/` directory. Package `exports` point to those build outputs. Root scripts enforce build order so workspace consumers resolve declarations from the built shared package. Renderer and Electron TypeScript configurations remain separate to avoid mixing browser globals and Node/Electron types.
