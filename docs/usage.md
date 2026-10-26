# Usage guide

Task-oriented instructions for working with LSM. File formats are in the
[Configuration reference](configuration.md); error messages and recovery steps
are in [Troubleshooting](troubleshooting.md). Run `lsm sync --help` or
`lsm publish --help` for the full option list.

## Requirements

- Node.js 20 or newer and `git` on your `PATH`.
- Read access to the repositories you use as sources, through your normal Git
  credentials.
- For `publish`: permission to push a branch to the source repository. Creating
  a pull request automatically also needs the GitHub CLI (`gh`), authenticated.

## The two sync modes

| Command | Uses | Writes the lock | Use it to |
|---|---|---|---|
| `lsm sync` | the commits already in `skills.lock.json` | no | Reproduce the recorded state. |
| `lsm sync --update` | the current upstream of each source | yes, after a successful run | Create the lock, accept upstream changes, apply manifest changes. |

Run `lsm sync --update` the first time and every time you change `skills.json`.
A plain `lsm sync` against an empty or mismatched lock stops with an error and
changes nothing.

Exit code `0` means success, `1` means the run failed or was stopped.

## Set up for yourself

1. Write `skills.json` (or run `lsm sync` once to create a template and fill it
   in). [`examples/skills.json`](../examples/skills.json) is a minimal working
   manifest that installs the demo skill; every field is described in the
   [Configuration reference](configuration.md#manifest-skillsjson-schema-version-2).

2. Install and create the lock:

   ```bash
   lsm sync --update
   ```

   Skills appear in the skills directory of each selected agent
   (`.agents/skills/hello-lsm/` and `.agents/skills/_shared/hello-lsm.txt` for
   the example). `skills.lock.json` is written next to the manifest.

3. Commit `skills.json` and `skills.lock.json`. Whether you also commit the
   installed skill directories is your decision: LSM can recreate them from
   the lock.

## Set up for a team

Commit `skills.json` and `skills.lock.json` to the project repository.

- **Join or restore:** after cloning, run `lsm sync`. Everyone gets the exact
  commits and files recorded in the lock, regardless of what upstream has done
  since.
- **Update deliberately:** one person runs `lsm sync --update`, reviews the
  installed files and lock, and commits the lock together with any tracked
  skill files. Others pull the changes and run `lsm sync`.
- **Review the lock like code.** A changed `resolvedCommit` or hash means the
  instructions your agents read have changed.

If installed directories are not versioned, pulling a new lock can make their
older contents look like local edits and stop `sync`. Review these
[conflicts](#local-edits-and-conflicts) before confirming or using `--force`,
and save any real edits first.

## Change what is installed

Edit `skills.json` (add a source, change a `skills` list, add an agent), then
run:

```bash
lsm sync --update
```

- A skill you drop from the manifest is removed from the agents' directories
  during the update, provided you have not edited it locally (see
  [Local edits](#local-edits-and-conflicts)).
- An agent you drop from `agents` loses the managed skills that were installed
  for it.
- Files LSM never installed are not removed (see
  [Unmanaged files](#unmanaged-files)).
- Deleting a managed skill directory or shared file by hand is not permanent:
  the next `lsm sync` restores it. To remove it for good, remove it from the manifest and
  run `lsm sync --update`.

## Local edits and conflicts

LSM compares installed files with the hashes in the lock. Before it overwrites
or deletes anything, it lists what differs ("Local change guard"):

```text
-- Local change guard --
Detected potential overwrite/delete conflicts: 1
  - [overwrite] .agents/skills/hello-lsm/SKILL.md (locally modified managed file)
```

The conflict kinds you can meet:

| Message | Meaning |
|---|---|
| `locally modified managed file` | You changed (or added a file inside) a skill that LSM manages. |
| `existing unmanaged path would be overwritten` | A directory or file LSM wants to write already exists and LSM did not put it there. |
| `[delete]` instead of `[overwrite]` | The run would remove a managed file that you modified. |

What happens next depends on how you run it:

- **In a terminal:** LSM asks `Continue sync and overwrite/delete these paths?
  [y/N]`. Anything other than `y` or `yes` stops the run.
- **Without a terminal (scripts, CI):** the run fails with `Standard sync cannot
  continue because local changes were detected in managed files.`
- **With `--force`:** LSM prints the conflicts and continues. Your local
  changes in those paths are overwritten or deleted and cannot be recovered
  from LSM, so commit or copy anything you want to keep first.

Safe ways to resolve a conflict, in order of preference:

1. **Keep your change and share it:** [publish](#publish-your-changes-to-the-source)
   it to the source, merge it there, then run `lsm sync --update`.
2. **The change is already upstream:** run `lsm sync --update`, which takes the
   current upstream and refreshes the lock.
3. **Keep it privately or discard it:** copy what you want to keep under
   another skill name, then run `lsm sync --force`.

## Unmanaged files

LSM only deletes files that it installed and recorded in the lock. Files you
created in other places are never touched. Two cases need care:

- **Inside a managed skill directory.** A skill is installed as a whole
  directory. A file you add there counts as a local change, and an overwrite
  (`--force` or answering `y`) replaces the directory, removing the extra file.
- **At a path LSM wants to use.** If a directory such as
  `.agents/skills/hello-lsm/` already exists and is not managed, the run stops
  with `existing unmanaged path would be overwritten`. `--force` replaces the
  directory, so move it away first if it matters.

Put your own skills in a differently named directory, or [publish
them](#publish-your-changes-to-the-source) to a source you manage.

## Publish your changes to the source

`publish` copies the local state of managed skills back to the source
repository on a new branch and, by default, opens a pull request. It handles
skills (and their shared files) only, never subagents or plugins.

Always start with a dry run. It clones the source and shows the plan without
committing or pushing anything:

```bash
lsm publish --dry-run
```

```text
Publish source : https://github.com/wkulinski/lsm/tree/master/examples/skill-source
Branch         : skills-sync/publish-20261024T090934-4ee4c9a4
Changed files  : 1
  - [M] examples/skill-source/skills/hello-lsm/SKILL.md
Create PR      : yes

Dry-run completed.
```

Changed files are marked `[M]` modified, `[A]` added, `[D]` deleted. LSM
compares your local files with the baseline in the lock, so publishing requires
that you have run `lsm sync --update` for the source before
(`Source "…" is missing in skills.lock.json. Run sync first.` otherwise).

When there is more than one source, pick one with `--source <source>`. The
skills directory used for the comparison is the first agent's directory.

| Task | Command |
|---|---|
| Publish edits to managed skills | `lsm publish` |
| Publish a brand new local skill | `lsm publish --new-skill my-skill` |
| Remove a skill from the source | delete it locally, then `lsm publish --remove-skill old-skill --confirm-deletes` |
| Push the branch without a PR | add `--no-pr` |
| Custom commit, branch or PR text | `--message`, `--branch`, `--title`, `--body` |

Rules to know:

- A new skill must exist locally and must not be managed by a source yet.
  `--remove-skill` requires the skill to be gone locally and to be managed by
  the selected source.
- Deletions are never applied silently. If the plan removes files or
  directories, the real run fails with `Delete operations were planned but
  --confirm-deletes was not provided` and lists the paths. Removing a skill can
  also delete shared files that only it used, so read the list in the dry run
  before adding `--confirm-deletes`.
- The default branch is `skills-sync/publish-<timestamp>-<commit>`. Set
  `publish.branchPrefix` in the manifest to change the prefix.
- A PR is opened by default. Set `publish.createPr` to `false` in the manifest
  or pass `--no-pr` to skip it.
- If `gh` is missing or not authenticated, the branch is still pushed; LSM
  reports `PR was not created automatically` and prints a compare URL you can
  open to create the PR yourself.
- After the PR is merged, run `lsm sync --update` so that your lock and the
  source agree.

Pushing uses your Git credentials and the pull request uses your `gh` login.

## Colors

Output is colored in interactive terminals and plain in pipes and CI. Set
`NO_COLOR=1` to disable colors or `FORCE_COLOR=1` to force them.
