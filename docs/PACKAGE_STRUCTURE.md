# Package structure

| Workspace                   | Responsibility in Phase 1           | Current boundary                                        |
| --------------------------- | ----------------------------------- | ------------------------------------------------------- |
| `apps/desktop`              | Angular renderer and Electron shell | UI calls Electron only through preload                  |
| `apps/cli`                  | Commander executable                | Depends on shared and core; currently version/help only |
| `packages/shared`           | Contracts and Zod schemas           | No application dependencies                             |
| `packages/core`             | Reusable analysis engine contracts  | Depends on shared only; no scanner yet                  |
| `packages/language-support` | Parser adapter contract             | No language parser registered yet                       |
| `packages/database`         | Drizzle SQLite boundary             | No driver, tables, migrations, or persistence yet       |
| `packages/export`           | Export format contracts             | No bundle or viewer generation yet                      |
| `packages/ai`               | Optional provider contract          | No provider, credentials, or network behavior           |

Each package emits ESM JavaScript and TypeScript declarations to its ignored `dist/` directory. Package `exports` point to those build outputs. Root scripts enforce build order so workspace consumers resolve declarations from the built shared package. Renderer and Electron TypeScript configurations remain separate to avoid mixing browser globals and Node/Electron types.
