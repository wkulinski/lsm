# Configuration reference

The files LSM reads and writes and the fields they accept. Command options are
listed by `lsm <command> --help`. For day-to-day tasks see [Usage](usage.md);
for error messages and recovery see [Troubleshooting](troubleshooting.md).

## Files

| File | Purpose | Edit by hand? |
|---|---|---|
| `skills.json` | The manifest: which sources, which artifacts, which agents. | Yes |
| `skills.lock.json` | The lock: exact commits and content hashes from the last successful `sync --update`. | No, commit it but let LSM write it |

Both files live in the directory where you run `lsm`. Pass `--manifest <path>`
to use a different manifest (relative paths are resolved from the current
directory). The CLI has no option for the lock location: it is always
`skills.lock.json` in the current directory, also when `--manifest` is used.
Only the library (`createManager({ lockPath })`) can change it.

If `skills.json` is missing, the first `lsm sync` creates templates of both
files and stops (`Required files are missing. Created templates:`), asking you
to fill in the manifest. The template
manifest has empty `agents` and `sources`, which is not valid until you add at
least one agent (or subagent target) and a source. If only the lock is missing,
LSM creates an empty one and carries on; run `lsm sync --update` to fill it.

## Manifest (`skills.json`, schema version 2)

```json
{
    "schemaVersion": 2,
    "agents": ["codex"],
    "subagents": ["opencode"],
    "sources": [
        {
            "source": "https://github.com/wkulinski/lsm/tree/master/examples/skill-source",
            "skills": ["hello-lsm"],
            "subagents": false,
            "publish": {
                "branchPrefix": "skills-sync/publish",
                "createPr": true
            }
        }
    ]
}
```

| Field | Required | Meaning |
|---|---|---|
| `schemaVersion` | yes | Must be `2`. Any other value is rejected. |
| `agents` | see below | Agent identifiers that receive skills. See [Agents](#agents). May be `[]` for a subagents-only manifest. |
| `subagents` | no | Subagent targets. The only supported value is `"opencode"`. Enables subagent and plugin sync. |
| `sources` | yes | List of sources. Each `source` string must be unique. |
| `sources[].source` | yes | Where to read from. See [Sources](#sources). |
| `sources[].skills` | no | Which skills to install. See [Selection](#selection). |
| `sources[].subagents` | no | Which OpenCode subagents to install. See [Selection](#selection). |
| `sources[].publish` | no | Publish defaults for this source. |
| `sources[].publish.branchPrefix` | no | Non-empty string used as the branch name prefix. Default: `skills-sync/publish`. |
| `sources[].publish.createPr` | no | Boolean. Default: `true`. `--no-pr` overrides it for one run. |

At least one of `agents` or `subagents` must be non-empty. Removed fields such
as `copies` are rejected; see [Upgrading older files](#upgrading-older-files).

### Selection

For both `skills` and `subagents` on a source:

| Value | Meaning |
|---|---|
| missing, `false` or `[]` | Install nothing of that kind from this source. |
| `true` | Install everything of that kind. |
| non-empty array | Install only the listed names. |

An explicit list is matched against the skill name from its frontmatter, or its
directory name. Matching ignores case. If a requested name is not found in the
source, the run stops with `Requested skills were not found in the source;
synchronization was not applied.` and changes nothing.

### Sources

Only GitHub sources are supported. LSM runs the `git` executable from your
`PATH`, so access to private repositories depends on your normal Git
credentials. LSM does not read or store tokens itself.

| Form | Example |
|---|---|
| Repository URL | `https://github.com/owner/repo` (a `.git` suffix is accepted) |
| Without scheme | `github.com/owner/repo` |
| Branch or tag | `https://github.com/owner/repo/tree/main` |
| Subdirectory | `https://github.com/owner/repo/tree/main/path/to/dir` |
| Shorthand | `owner/repo` |
| Shorthand with ref and subdirectory | `owner/repo@main/path/to/dir` |

With no ref, LSM uses the default branch of the repository. A subdirectory
limits discovery to that directory; a subdirectory that is absolute or contains
`..` is rejected. Other hosts fail with `Unsupported source: … (allowed: github)`.

### Agents

`agents` selects where skills are installed. Each identifier maps to a skills
directory inside your project. An unknown identifier fails with
`Unsupported agent for copy sync`, and the wildcard `*` is not supported.

Several agents share `.agents/skills`; selecting more than one of them still
installs a single copy.

| Agent | Skills directory |
|---|---|
| `adal` | `.adal/skills` |
| `amp` | `.agents/skills` |
| `antigravity` | `.agent/skills` |
| `augment` | `.augment/skills` |
| `claude-code` | `.claude/skills` |
| `cline` | `.agents/skills` |
| `codebuddy` | `.codebuddy/skills` |
| `codex` | `.agents/skills` |
| `command-code` | `.commandcode/skills` |
| `continue` | `.continue/skills` |
| `cortex` | `.cortex/skills` |
| `crush` | `.crush/skills` |
| `cursor` | `.agents/skills` |
| `droid` | `.factory/skills` |
| `gemini-cli` | `.agents/skills` |
| `github-copilot` | `.agents/skills` |
| `goose` | `.goose/skills` |
| `iflow-cli` | `.iflow/skills` |
| `junie` | `.junie/skills` |
| `kilo` | `.kilocode/skills` |
| `kimi-cli` | `.agents/skills` |
| `kiro-cli` | `.kiro/skills` |
| `kode` | `.kode/skills` |
| `mcpjam` | `.mcpjam/skills` |
| `mistral-vibe` | `.vibe/skills` |
| `mux` | `.mux/skills` |
| `neovate` | `.neovate/skills` |
| `opencode` | `.agents/skills` |
| `openclaw` | `skills` |
| `openhands` | `.openhands/skills` |
| `pi` | `.pi/skills` |
| `pochi` | `.pochi/skills` |
| `qoder` | `.qoder/skills` |
| `qwen-code` | `.qwen/skills` |
| `replit` | `.agents/skills` |
| `roo` | `.roo/skills` |
| `trae` | `.trae/skills` |
| `trae-cn` | `.trae/skills` |
| `universal` | `.agents/skills` |
| `windsurf` | `.windsurf/skills` |
| `zencoder` | `.zencoder/skills` |

Skills from a source keep their path below the source's `skills` directory. A
skill at `skills/hello-lsm` in the source is installed to
`<skills directory>/hello-lsm` for every selected agent.

## Writing a skill

A source is any Git repository (or subdirectory) that contains skills. LSM
looks for a `skills/` directory first, then for common per-agent directories
such as `.agents/skills`, `.claude/skills` or `.cursor/skills`, and finally
searches the tree to a limited depth. `node_modules`, `.git`, `dist` and `build`
are skipped.

A skill is a directory with a `SKILL.md` file that starts with YAML
frontmatter. The repository ships a minimal working example in
[`examples/skill-source`](../examples/skill-source):

```text
skills/
├── hello-lsm/
│   └── SKILL.md
└── _shared/
    └── hello-lsm.txt
```

```markdown
---
name: hello-lsm
description: Print a short greeting to confirm that LSM installed this skill.
shared_files:
  - _shared/hello-lsm.txt
---

# Hello LSM
…instructions for the agent…
```

| Frontmatter field | Required | Meaning |
|---|---|---|
| `name` | yes | String. Used for selection, lock entries and publishing. |
| `description` | yes | String. A directory without both fields is not treated as a skill. |
| `shared_files` | no | List of files shared with other skills (see below). |
| `metadata.internal` | no | When `true` the skill is hidden and never installed. |

### Shared files

`shared_files` lists files that the skill needs but that live outside its own
directory, such as common references. Paths are relative to the `skills/`
directory, must point to regular files that exist, and must not contain `..`,
be absolute, or pass through a symbolic link. Each file is copied to the same
relative path in every selected agent's skills directory (for the example:
`.agents/skills/_shared/hello-lsm.txt`). Several skills of the same source can
share one file. A path can belong to only one source: if two sources declare the
same shared path, `sync` stops with an ownership conflict.

## Subagents

Subagents are OpenCode agent definitions, synchronized by `sync` when the
manifest contains `"subagents": ["opencode"]`. They are **sync-only**: a
manifest that contains only subagents fails `publish` with `Publish currently
supports skills only; subagents are sync-only.`

- A source may contain `.opencode/agent/`, `.opencode/agents/` or both. Files
  are installed into the directory your project already uses, or
  `.opencode/agents/` when it has neither.
- `sync --update` records the chosen path as `targetPath` in the lock. Locked
  `sync` keeps using that path.
- An agent may have a sidecar named `<agent>.md.lsm.yaml` that declares shared
  files. The sidecar itself is not copied:

  ```yaml
  schema_version: 1
  shared_files:
    - .agents/skills/_shared/references/runtime-quality-procedures.md
  ```

## Plugins

OpenCode plugins are synchronized together with subagents (same
`"subagents": ["opencode"]` switch) and are **sync-only**.

- There is no per-plugin selection. For every source, all regular files under
  `.opencode/plugins/` are copied recursively, with the same relative paths.
  Source-level `subagents` selection does not limit plugins.
- Symbolic links and paths that leave the source directory are rejected.
- LSM does not install npm dependencies for plugins.
- A plugin that is no longer in the source is removed only during a successful
  `sync --update`. Files LSM does not manage are never removed.

## Lock file (`skills.lock.json`)

The lock records, for each source, what was installed and from which exact
commit. It makes later installs reproducible.

| Field | Meaning |
|---|---|
| `schemaVersion` | `5` or `6`. |
| `generatedAt` | Time of the last write. |
| `agents`, `subagents` | The selections that were installed. |
| `sources.<source>.resolved` | Requested ref, resolved ref, `resolvedCommit`, subpath and time. |
| `sources.<source>.skillEntries` | Per skill: `name`, `sourcePath`, `sharedFiles` and content hashes (`treeSha256` plus per-file hashes). |
| `sources.<source>.sharedEntries` | Per shared file: source and target path, hash, executable bit, owners (v6). |
| `sources.<source>.subagentEntries` | Per subagent: name, source and target path, hash (v6). |
| `sources.<source>.pluginEntries` | Per plugin file: source and target path, hash, executable bit (v6, only when plugins exist). |

Versions: LSM reads lock versions 5 and 6 and always writes version 6. A
manifest that uses subagents requires version 6, which `sync --update` writes
after a successful run. Any other `schemaVersion` fails with
`unsupported schemaVersion=…; expected 5 or 6`.

Hashes let LSM detect local edits to managed files.

## Upgrading older files

LSM does not migrate files automatically; update them by hand:

| Change | What to do |
|---|---|
| Manifest `schemaVersion` must be `2`. | Set `"schemaVersion": 2` and review selections. |
| A missing `skills` or `subagents` field means *none*, not *all*. | Add an explicit `true` where you relied on "all". |
| `copies` is no longer supported. | Declare `shared_files` in the skill's frontmatter. |
| `publish.includeNewByDefault` is no longer supported. | Remove it; select new skills with `lsm publish --new-skill`. |
| Lock version 5 is read, version 6 is written. | Run `lsm sync --update`; a manifest with subagents requires it. |
