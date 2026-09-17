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
- OpenCode subagent discovery, synchronization, sidecar metadata, and managed
  shared files.
- OpenCode plugin discovery and synchronization through the same managed-file
  pipeline.

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
- Publish plans deletions of locally removed managed skill files only when they
  are present in the lock baseline, and requires explicit delete confirmation.
- Subagents are synchronized through the same source workspace, preflight,
  managed-file ownership, and rollback flow as skill shared files.
- Plugins are synchronized through the same managed-file ownership, lock,
  preflight, pruning, and rollback flow as OpenCode subagents.

## Subagent contract

The manifest keeps skill and subagent configuration separate:

- top-level `agents` selects skill integrations;
- top-level `subagents: ["opencode"]` enables OpenCode subagent sync;
- source-level `skills` and `subagents` use the same selection contract: missing,
  `false`, and `[]` mean none; `true` means all; a non-empty array means
  explicit selection.

Manifest files use `schemaVersion: 2`. Existing manifests are migrated
manually; omitted selections that previously meant all must be written as
`true`.

Only Markdown files under `.opencode/agent/` and `.opencode/agents/` are
discovered as subagents. The effective name comes from optional frontmatter or the path
relative to the variant directory. Duplicate names and target paths are
rejected. A matching `<agent>.md.lsm.yaml` sidecar may declare `shared_files`;
its schema is version 1 and every path must remain below
`.agents/skills/_shared/`. Sidecars are metadata and are not installed.

During `sync --update`, the resolver maps a source variant to the matching
project variant, or to `.opencode/agents/` when neither project directory
exists. If both variants exist, each source variant maps to its counterpart.
The resolved `targetPath` is stored in lock v6. Locked `sync` uses that exact
path and does not autodetect again. Lock v5 remains valid for skill-only
manifests; subagent manifests require `sync --update` and are written as v6.

`publish` is intentionally sync-only for subagents. Skill-only manifests keep
the existing publish behavior, mixed manifests publish only skills, and a
subagent-only manifest fails before source discovery with:

```text
Publish currently supports skills only; subagents are sync-only.
```

## Plugin contract

Top-level `subagents: ["opencode"]` enables plugin synchronization together
with OpenCode subagents. Plugin selection is not separate and source-level
`subagents` does not filter it. Each regular file below the resolved source
`.opencode/plugins/` directory is discovered recursively, including files with
non-Markdown extensions, and is mapped to the same relative target path below
the project `.opencode/plugins/` directory. A missing directory is empty;
symlinks and paths escaping the source workspace fail safely.

`sync --update` records plugin `sourcePath`, `targetPath`, content hash and
executable bit in optional lock v6 `pluginEntries`. Locked sync uses the
recorded commit and hashes. Upstream drift requires `--update`; stale managed
plugin files are pruned only from the prior plugin ownership set, while
unmanaged files are preserved. Plugin synchronization is sync-only: publish,
plugin execution, and dependency installation are outside the core contract.

The public sync result and OpenCode sync event may expose an optional `plugins`
summary with detected, installed and removed counts. Existing agent, skill and
publish fields remain unchanged, and the CLI omits this additional summary when
no plugin files are present.

## TODO

- Consider future subagent publishing separately; it is not part of the current
  synchronization contract.
