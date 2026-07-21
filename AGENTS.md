# Repository Guidelines

This repository contains the TypeScript/npm package `@wkulinski/lsm`. Keep
changes scoped to the package, its CLI, tests, and project documentation.

## Project Structure

- `src/`: TypeScript source code.
- `src/cli/`: CLI commands and renderers.
- `src/core/`: manager, manifest, source, sync, publish, filesystem, and Git
  modules.
- `tests/`: Vitest unit and integration tests.
- `bin/lsm`: repository CLI wrapper.
- `.agents/skills/`: local agent skills; most installed skills are ignored by
  Git and should not be treated as package source.
- `README.md`: package documentation and user-facing configuration reference.
- `docs/`: tracked supporting documentation.
- `var/`: local agent cache and state; ignored by Git.

## Development Commands

Initialize local environment configuration when needed:

```bash
cp .env.dist .env.local
```

Use the repository package scripts for validation:

```bash
npm ci
npm test
npm run test:coverage
npm run typecheck
npm run test:typecheck
npm run lint:js
npm run build
npm audit --omit=dev
npm pack --dry-run
```

The CLI can be run from the repository with:

```bash
node bin/lsm --help
```

## Coding Style

- Use TypeScript with the existing four-space indentation and single-quote
  style.
- Keep classes and functions focused on one responsibility.
- Preserve the dependency direction from CLI/manager to core services and
  adapters.
- Reuse existing filesystem, Git, hashing, manifest, and path-safety helpers.
- Prefer explicit result types and stable error messages at public boundaries.
- Keep public CLI and `createManager()` behavior backward compatible unless a
  change is explicitly planned.

## Tests

- Add or update focused Vitest tests with every behavior change.
- Use temporary local Git repositories for integration tests; do not depend on
  network repositories or the user's real workspace.
- For filesystem changes, cover traversal, symlinks, unmanaged files, and
  cleanup behavior.
- For sync changes, cover both locked mode and explicit `--update` mode.

## Configuration and Security

- Never commit secrets or local `.env.local` values.
- Keep generated cache/state below `CACHE_PATH`/`var/`.
- Resolve optional tool wrappers through the shared `env-load.sh` helper when a
  skill requires it; do not hardcode machine-specific paths.
- Do not use destructive Git commands or force-pushes as part of normal work.

## Documentation Path Map

Skills that read or update project documentation use this map:

```yaml
docs_map:
    MAIN_DOC: README.md
    AGENT_RULES_DOC: AGENTS.md
    MODULE_INDEX_DOC: docs/modules/README.md
    MODULE_DOCS_GLOB: docs/modules/*/README.md
    COMMIT_MESSAGE_DIR: /tmp/
    HANDOFF_DOC: var/agent/HANDOFF.md
    SKILLS_INDEX_DOC: docs/SKILLS.md
```

The map is intentionally repository-relative except for the temporary commit
message directory. Missing required documentation paths should be created or
reported by the relevant skill rather than guessed.

## Commit and Pull Request Guidelines

Use concise conventional commit messages, for example:

- `feat(sync): add locked source resolution`
- `fix(sync): avoid false conflicts after upstream changes`
- `docs: document subagent synchronization plan`

Pull requests should include a short problem/solution summary, validation
commands and outcomes, and any known compatibility or release implications.
