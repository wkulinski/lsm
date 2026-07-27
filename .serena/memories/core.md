# LSM project map
- TypeScript/npm package `@wkulinski/lsm`; public entrypoints `src/index.ts`, `src/bin.ts`, CLI under `src/cli/`, orchestration under `src/core/manager/` and `src/core/manager.ts`.
- Core boundaries: `src/core/manifest/` (manifest/lock), `source/` (Git/discovery), `sync/` (planning/preflight/install/removal/shared files), `skills/` (skill installation), `filesystem/` and `git/` adapters, `publish/` workflow.
- Tests are Vitest files under `tests/`, with local temporary Git repositories for integrations.
- Durable project rules and docs map live in `AGENTS.md`; implementation workflow uses `mem:task_completion` commands and `mem:conventions` style.
- Current requested plan is documented in `docs/tmp/subagents-sync-plan.md`; Etap 0 is baseline-only and must not expose subagent sync behavior.