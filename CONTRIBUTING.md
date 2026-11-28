# Contributing

Thanks for your interest in RepoLens. The project is under active development; the foundation is intentionally small and does not yet analyze repositories.

## Development setup

1. Install Node.js `>=22.12.0` and npm 10 or newer.
2. Clone the repository and run `npm install`.
3. Run `npm run build`, `npm run test`, `npm run lint`, and `npm run typecheck` before submitting changes.
4. Run `ng serve` from the repository root for the renderer (`npm start` is an equivalent alias), or use `npm run dev:desktop` for the Electron development shell. Electron requires a graphical session.

## Contribution expectations

- Keep `packages/core` independent of Angular and Electron.
- Keep renderer access to local capabilities behind the typed preload API.
- Do not add placeholder analysis results or claim unfinished work as complete.
- Add behavior-focused tests with each capability.
- Update `PROJECT_STATUS.md`, the changelog, and relevant documentation when milestones change.
- Keep dependencies purposeful and preserve local-first privacy defaults.

For significant architecture changes, open an issue or discussion before starting implementation. See [SECURITY.md](SECURITY.md) for vulnerability reporting.
