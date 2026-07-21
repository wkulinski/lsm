# Core Module

## Scope

The core module contains the package runtime and domain services behind the
CLI and public manager API:

- manager and runtime construction,
- manifest and lock persistence,
- source resolution, Git checkout, and skill discovery,
- locked and update synchronization workflows,
- skill installation, shared-file handling, and conflict detection,
- publish planning and Git workspace operations,
- filesystem, hashing, and path-safety helpers.

## Entrypoints

- `src/core/manager/SkillsManager.ts`: public sync and publish orchestration.
- `src/core/manager/RuntimeFactory.ts`: manifest, lock, and adapter assembly.
- `src/core/sync/SyncService.ts`: locked and `--update` synchronization flow.
- `src/core/source/GitSourceClient.ts`: exact commit checkout for sources.
- `src/core/manifest/ManifestStore.ts`: manifest and lock persistence.

## Invariants

- Locked sync uses the commit and content hashes recorded in the lock.
- `sync --update` is the explicit operation that resolves upstream again and
  writes a new lock after a successful workflow.
- Filesystem writes and removals remain inside the project root and do not
  follow symlinks outside managed paths.
- Local conflicts are reported before managed content is overwritten unless the
  user explicitly confirms or forces the operation.

## TODO

- Add subagent synchronization as a separate artifact flow targeting
  `.opencode/agents/`; see `docs/tmp/subagents-sync-plan.md` for the current
  proposal.
