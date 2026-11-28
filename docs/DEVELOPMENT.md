# Development guide

## Toolchain

The workspace is tested with Node 22.22.3 and npm 10.9.8. Angular 21 requires Node `^20.19.0 || ^22.12.0 || >=24.0.0`; the configured Electron and Commander versions also require Node 22.12 or newer. TypeScript is kept on the Angular-compatible 5.9 line.

## Renderer development

From the repository root, use Angular's original development-server command:

```bash
ng serve
```

`npm start` and `npm run dev:web` are simple aliases for `ng serve`. The Angular workspace config is at the repository root; the renderer's TypeScript config resolves `@repolens/shared` directly from its source, so no prior build or generated `dist` is needed.

## Common commands

```bash
npm install
npm run build
npm run build:desktop
npm run build:cli
npm run dev:desktop
npm run test
npm run lint
npm run typecheck
npm run format
npm run clean
```

`npm run build` builds shared packages first, then the CLI and desktop. `npm run test` runs Vitest for Node packages and Electron IPC plus Angular's unit-test builder for renderer tests. Scanner tests use only `fixtures/scanner/basic/` and a virtualized boundary fixture; they do not scan arbitrary developer directories. `npm run typecheck` builds package declarations before checking consumers and the Angular templates.

The reusable scanner lives in `packages/core/src/scanner`; Electron's worker and Node filesystem adapter live under `apps/desktop/electron/services`. To add a capability, keep core independent of Electron/Angular and pass filesystem operations through `ScanFileSystem`. See [Scanner](SCANNING.md) for current ignore support, configuration, limits, and persistence semantics.

## Formatting and validation

Prettier handles formatting. ESLint uses the flat config with TypeScript and Angular template rules. Package test files are intentionally excluded from production declaration builds and included in Vitest.

## Adding a capability

1. Define shared request/response types and runtime schemas first.
2. Implement behavior in the owning package, keeping UI and Electron concerns out of core.
3. Add behavior tests and update package dependencies only as needed.
4. Wire the capability to Electron through a fixed validated IPC channel or to the CLI through the same core package.
5. Update documentation, changelog, and `PROJECT_STATUS.md`.

Do not add fake dashboard metrics or mark contracts/placeholders as completed capabilities.
