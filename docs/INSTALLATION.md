# Installation

## Development checkout

1. Install Node.js `>=22.12.0` and npm 10 or newer.
2. Clone the repository.
3. Run `npm install` from the repository root. npm workspaces install the desktop, CLI, and packages together; Electron's native binary is normally fetched as part of its package setup.
4. Run `npm run build` and `npm test` to validate the checkout.

## Start the renderer

```bash
npm run dev:web
```

This starts Angular's development server on port 4200. It is a renderer-only preview; the Electron preload bridge is not available in a normal browser.

## Start the desktop shell

```bash
npm run dev:desktop
```

This builds shared packages and the Electron main/preload code, starts the Angular renderer, then opens Electron. A graphical desktop session and a successful download of the Electron binary are required. The repository currently has no packaged installer; cross-platform packaging is a later milestone.

## CLI

```bash
npm run build:cli
npm run cli -- --version
npm run cli -- --help
```

The CLI foundation currently supports only version and help output. It does not register projects or analyze repositories yet.
