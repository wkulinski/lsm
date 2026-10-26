# Troubleshooting

Find your message, understand what it means, and take the safe next step.
Commands are described in the [Usage guide](usage.md); formats in the
[Configuration reference](configuration.md).

**Before using `--force`:** it overwrites and deletes the conflicting local
paths without asking. LSM cannot restore them afterwards. Only use it after you
have read the list of conflicts and saved anything you want to keep.

## Quick index

| You see | Section |
|---|---|
| `Lock is empty` / `Locked … does not match skills.json` / `…unexpected commit` | [Lock problems](#lock-problems) |
| `Standard sync cannot continue because local changes were detected` | [Conflicts](#conflicts) |
| `Requested skills were not found in the source` | [Skill not found](#skill-not-found) |
| `Git clone failed` / `git not found in PATH` | [Git and access](#git-and-access) |
| `Install summary` with `FAIL`, `Aborting before removals…` | [Install failures](#install-failures) |
| `Delete operations were planned but --confirm-deletes was not provided` | [Planned deletions](#planned-deletions) |
| `gh CLI is not available…` / publish fails | [Publish problems](#publish-problems) |
| `"skills.json": "schemaVersion" must be 2` and other manifest errors | [Manifest errors](#manifest-errors) |

## Lock problems

These errors come from a plain `lsm sync`, which only replays the lock. They
stop the run before any file is changed.

| Message | Meaning | Next step |
|---|---|---|
| `Lock is empty.` | No source has been resolved yet. Typical on the first run. | `lsm sync --update` |
| `Lock is missing source "…"` | The manifest has a source the lock does not know. | `lsm sync --update` |
| `Locked skill selection for "…" does not match skills.json.` (also for subagents) | You changed a `skills` or `subagents` list since the lock was written. | `lsm sync --update` |
| `Locked source "…" resolved to an unexpected commit.` / `…is missing requested skills.` / `…do not match the source commit.` | The lock and the recorded commit disagree, for example after a bad merge of `skills.lock.json`. | `lsm sync --update`, then review the result |

`--force` does not bypass these checks and is not the answer. The safe step is
always `lsm sync --update`. If the lock file itself is damaged:

- `"skills.lock.json": unsupported schemaVersion=…; expected 5 or 6` means the
  file was edited or comes from another tool. Restore it from Git
  (`git checkout -- skills.lock.json`) and run `lsm sync --update`.
- After a Git merge conflict in the lock, take either side, then run
  `lsm sync --update` to regenerate it consistently.

`lsm publish` has its own pair of messages: `Source "…" is missing in
skills.lock.json. Run sync first.` and `Missing resolved commit for "…" in
lock. Run sync first.` Both mean you have to run `lsm sync --update` before
publishing.

## Conflicts

```text
-- Local change guard --
Detected potential overwrite/delete conflicts: 1
  - [overwrite] .agents/skills/hello-lsm/SKILL.md (locally modified managed file)

Error: Standard sync cannot continue because local changes were detected in managed files.
```

LSM refuses to overwrite files that differ from the lock. Nothing has been
changed. Read the path list, then choose:

| Situation | Safe next step |
|---|---|
| You want to keep and share the edit | `lsm publish --dry-run`, then `lsm publish`; merge the PR; `lsm sync --update` |
| The same change is already upstream | `lsm sync --update` |
| You want to keep the edit privately | Do not sync those paths; copy the skill under another name |
| You do not need the edit | Save a copy if in doubt, then `lsm sync --force` |

Other conflict texts:

- `existing unmanaged path would be overwritten`: something LSM did not
  install already sits where a skill should go. Move or rename it, or use
  `--force` to replace it (its contents are lost).
- `[delete] … (locally modified managed file)`: the run wants to remove a
  skill you dropped from the manifest, but you edited it. Publish or copy your
  edits first.
- In a terminal LSM asks `Continue sync and overwrite/delete these paths?
  [y/N]`. Answer `n` (or anything but `y`/`yes`) to stop safely.

## Skill not found

`Requested skills were not found in the source; synchronization was not
applied.` One of the names in `skills` does not match a skill in the source.
Nothing was changed.

- Names are matched by frontmatter `name` or directory name, ignoring case.
- Check that the source URL, branch and subdirectory are the ones you meant,
  and that the skill has `name` and `description` in its frontmatter.
- A skill with `metadata.internal: true` is hidden and cannot be installed.

## Git and access

- `git not found in PATH`: install Git or fix `PATH`.
- `Git clone failed (exit=128)` with `could not read Username`,
  `Repository not found` or `Authentication failed`: the repository does not
  exist under that name or your Git credentials cannot read it. Check that
  `git clone <repository-url>` works in the same shell, using your credential
  helper or token. LSM only calls Git and never handles credentials.
- `Unsupported source: … (allowed: github)`: only GitHub sources are
  supported. See [Sources](configuration.md#sources).
- `Commit … not found in source history.` (publish): the commit in your lock
  is no longer in the repository, for example after a force-push upstream. Run
  `lsm sync --update` and publish again.

## Install failures

When copying a skill fails, for example because the disk is full or a
directory is not writable, the output ends like this:

```text
== Install summary ==
OK  : 0/1
FAIL: 1/1
  - https://github.com/wkulinski/lsm/tree/master/examples/skill-source exit=1
    cmd: internal-install https://github.com/wkulinski/lsm/tree/master/examples/skill-source
    error: EACCES: permission denied, rename '…/.agents/.lsm-swap-WyoMM1/new' -> '…/.agents/skills/hello-lsm'

Aborting before removals because installs failed.
```

The `error:` line is the underlying cause. The usual suspects are free disk
space and write permission to the agent's skills directory (here
`.agents/skills`).

What LSM guarantees in this case:

- The skill being replaced keeps its previous, complete version. LSM prepares
  the new content in a temporary directory first and swaps it in only when it
  is ready. If the swap itself fails, it moves the previous version back.
- A skill that was not installed before leaves nothing partial behind.
- No removals run and the lock is **not** updated (the run ends with `Lock NOT
  updated`), so a normal retry of the same command is safe and needs no
  `--force`.

What it does not guarantee:

- Skills already installed earlier in the same run stay installed. There is no
  rollback of the whole run.
- Recovery after a crash or power loss in the middle of a swap is not covered.

If the previous version could not be restored, the error names the directory
where it was preserved. Its name starts with `.lsm-swap-` and it sits next to
your skills directory (for example `.agents/.lsm-swap-…`), or inside it when the
parent directory is not writable or is on another volume. Copy the content
back by hand, then delete the temporary directory. LSM ignores directories with
that name when it looks for skills, so a leftover is harmless, but an agent that
scans the skills directory itself may still read a copy kept inside it.

Fix the cause (free disk space, permissions), then run the same command again.
`Aborting before removals because shared file sync failed.` and `…subagent
sync failed.` mean the same for shared files and subagents.

## Planned deletions

Only `publish` needs `--confirm-deletes`.

```text
Publish failed: Delete operations were planned but --confirm-deletes was not provided.
Planned delete paths:
  - [directory] examples/skill-source/skills/hello-lsm
  - [file] examples/skill-source/skills/_shared/hello-lsm.txt
```

The paths are deleted in the source repository's branch, not locally. Check the
list: a removed skill can take its shared files with it. If it is what you
intend, rerun with `--confirm-deletes`. Otherwise bring the files back and
publish again: `lsm sync` restores a skill directory or shared file you deleted
entirely, while a skill from which you removed only some files is reported as a
conflict, so review it and use `lsm sync --force`. `--dry-run` never needs the
flag.

`lsm sync` has no `--confirm-deletes`; its deletions follow the conflict rules
above.

## Publish problems

- `Multiple sources configured. Use --source <source>.`: add `--source` with the
  exact string from `skills.json`.
- `Source "…" not found in manifest.`: the `--source` value must match the
  manifest string exactly.
- `Invalid publish selection.` followed by details: for example the skill is
  not new, is still present locally for `--remove-skill`, or is managed by
  another source.
- `Conflicting publish selection.`: a skill cannot be both `--new-skill` and
  `--remove-skill`.
- `Failed to push publish branch.`: you cannot push to the source repository.
  Ask for access or publish to a repository you own.
- `gh CLI is not available or not authenticated; PR was not created
  automatically.`: the branch **was** pushed. Open the printed compare URL to
  create the pull request, or run `gh auth login` and use the URL. Pass
  `--no-pr` to skip this step intentionally.
- `Publish currently supports skills only; subagents are sync-only.`: nothing
  to publish for a subagents-only manifest.
- `No publishable changes found.`: your local skills match the lock.

## Manifest errors

Manifest problems stop the run before anything is changed.

| Message | Fix |
|---|---|
| `"skills.json": "schemaVersion" must be 2` | Set `"schemaVersion": 2`. |
| `at least one of "agents" or "subagents" must be non-empty` | Add an agent (the fresh template has none). |
| `Unsupported agent for copy sync: "…"` | Use an identifier from the [agent table](configuration.md#agents). |
| `"skills" must be true, false, or an array` | Fix the value type. |
| `duplicate source "…"` | List each source once. |
| `"copies" is no longer supported` | Declare `shared_files` in the skill instead. |
| `Invalid JSON: …` | Fix the syntax error shown. |
| `Manifest path contains a symbolic link` | Use a real path; LSM does not follow symlinks for its own files. |

## Still stuck?

Run the failing command again and keep the full output. Open an issue with the
LSM version (`lsm --version`), your Node version, the manifest with private
values removed, and the output. Do not paste tokens or private repository
contents.
