# `@repolens/core`

This package owns the future reusable analysis engine. In v0.1.0 it exposes only the minimal analysis context, analyzer, and pipeline contracts. It deliberately does not scan files, parse ASTs, construct graphs, or depend on Angular, Electron, the CLI, or Node-specific application services.

The only package dependency is `@repolens/shared` for stable project contracts. Each analysis capability will be implemented and tested in its later milestone.
