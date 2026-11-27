# Security notes

Phase 1 creates the Electron security boundary but does not yet accept repositories, ZIP archives, or project-provided content. See [SECURITY.md](../SECURITY.md) for the project policy and [IPC_ARCHITECTURE.md](IPC_ARCHITECTURE.md) for implemented controls.

Future phases must add threat modeling and tests before enabling filesystem import, archive extraction, source preview, scanning, or network-backed AI. Scanned project scripts must never be run automatically. Source code and secrets must not be sent to external services without explicit user consent.
