# LSM — LLM Skills Manager

Declare the AI agent skills your projects use, pin them in a lockfile, and send
your improvements back to the repository they came from.

LSM is a command-line tool for people who keep agent skills (`SKILL.md`
instructions, OpenCode subagents and plugins) in Git repositories and use them
in more than one project or with more than one AI agent. It is not a package
registry: a "source" is simply a GitHub repository, or a directory in one.

## Why use it

Copying skills between projects by hand drifts quickly: nobody knows which
version is installed, local tweaks get overwritten or lost, and improvements
never make it back.

- **Declarative.** `skills.json` lists the sources, the skills you want and the
  agents that should receive them.
- **Reproducible.** `skills.lock.json` records the exact commits and content
  hashes. `lsm sync` recreates that state on any machine, and updates only
  happen when you ask for them (`lsm sync --update`).
- **Safe by default.** LSM notices local edits to installed files and stops
  instead of overwriting them. Without `--force`, it deletes only files it
  installed.
- **Two-way.** `lsm publish` turns your local improvements into a branch and
  pull request on the source repository.

**On your own:** one manifest keeps the same skills in all your projects and
for all the agents you use (Codex, Claude Code, Cursor, OpenCode and
[many more](docs/configuration.md#agents)).

**In a team:** commit the manifest and the lock. Everyone gets the same
instructions, updates are deliberate and reviewable like any dependency bump,
and fixes flow back to the shared source.

## Quick start

You need [Node.js](https://nodejs.org/) 20 or newer and `git`.

```bash
npm install --global @wkulinski/lsm
lsm --version
```

Try it in an empty directory. The demo installs one harmless skill that only
prints a greeting:

```bash
mkdir lsm-demo && cd lsm-demo

cat > skills.json <<'EOF'
{
    "schemaVersion": 2,
    "agents": ["codex"],
    "sources": [
        {
            "source": "https://github.com/wkulinski/lsm/tree/master/examples/skill-source",
            "skills": ["hello-lsm"]
        }
    ]
}
EOF

lsm sync --update
```

The first run (and every run after you edit `skills.json`) needs `--update`: it
resolves the source and writes the lock. The end of the output looks like this:

```text
== Install summary ==
OK  : 1/1
FAIL: 0/1

Lock updated: skills.lock.json
```

What you now have:

```text
lsm-demo/
├── skills.json
├── skills.lock.json                    # exact commit and content hashes
└── .agents/skills/
    ├── hello-lsm/SKILL.md              # the installed skill
    └── _shared/hello-lsm.txt           # a file the skill declares as shared
```

Run it again without `--update` to replay the lock. It reinstalls exactly the
recorded commit and leaves the lock alone:

```bash
lsm sync
# …
# Lock unchanged (locked sync used the existing state).
```

Later, `lsm sync --update` pulls the current upstream and refreshes the lock.
When you are done, delete the `lsm-demo` directory; nothing outside it was
touched.

Next: [use it in your own project](docs/usage.md#set-up-for-yourself).

## What LSM manages

| Artifact | Synced from sources | Published back |
|---|---|---|
| Skills (`SKILL.md` directories) | yes | yes |
| Shared files a skill declares (`shared_files`) | yes | yes, with the skill |
| OpenCode subagents | yes | no (sync-only) |
| OpenCode plugins | yes | no (sync-only) |

Sources must be on GitHub. See the [configuration reference](docs/configuration.md)
for the manifest, the lock, source syntax and the full list of supported
agents and their directories.

## Safety

LSM writes and deletes files in your project and pulls instructions from
other repositories, so know what it does:

- **Trust your sources.** Skills tell your agents what to do and plugins are
  code. The lock makes an install *reproducible*, not *safe*: it does not
  check whether the content is harmless. Review what you install and every
  update.
- **Local edits are protected.** If an installed file differs from the lock,
  LSM lists the files and stops (non-interactive runs fail). `--force` is the
  explicit way to overwrite, and it cannot be undone.
- **LSM deletes only what it installed.** Files it did not install are left
  alone; an unmanaged directory that is in the way is reported as a conflict.
  Only `--force` replaces it, and its contents are then lost.
- **Publishing is reviewable.** `lsm publish --dry-run` shows the plan without
  pushing, deletions need `--confirm-deletes`, and changes go to a new branch,
  normally with a pull request.
- **Failures are contained.** If installing a skill fails, its previous version
  stays in place and the lock is not updated. There is no rollback of an entire
  multi-skill run, and recovery from a crash mid-operation is not covered.

Details and recovery steps: [Usage](docs/usage.md) and
[Troubleshooting](docs/troubleshooting.md).

## Documentation

| Page | Read it to |
|---|---|
| [Usage guide](docs/usage.md) | Set up alone or as a team, update, handle local edits, publish. |
| [Configuration reference](docs/configuration.md) | Look up manifest fields, sources, agents, lock format, writing a skill. |
| [Troubleshooting](docs/troubleshooting.md) | Find an error message and the safe next step. |
| [Example source](examples/README.md) | See the demo skill used above. |
| [Contributing](CONTRIBUTING.md) | Report a bug, propose a change, run the checks. |
| [Security policy](SECURITY.md) | Report a vulnerability privately. |
| [Maintainer docs](docs/README.md) | Compatibility policy, releasing, architecture. |

## Library

Everything the CLI does is also available in code:

```ts
import { createManager } from '@wkulinski/lsm';

const manager = createManager({ cwd: process.cwd() });
const result = await manager.runSync({ update: true });
```

## Status and compatibility

LSM is on a `0.x` version: the commands and file formats described here are
what the tests cover, but they may still change between minor versions.
Breaking changes and their manual migration steps are listed in the release
notes and in [Maintaining](docs/maintaining.md#breaking-changes-before-10).

The CI workflow installs the packaged tarball and runs an end-to-end check on
Ubuntu with Node 20.0.0, 22 and 24. Other operating systems are not verified;
Windows in particular is untested.

## License

[MIT](LICENSE)
