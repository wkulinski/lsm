# Maintaining LSM

For people who release LSM or decide what it promises. Contributors should
start with [CONTRIBUTING.md](../CONTRIBUTING.md).

## What LSM promises

| Area | Commitment |
|---|---|
| Node.js | `engines` declares `>=20`. This is kept; raising it is a deliberate, announced change. |
| Verified environment | CI installs the packaged archive and checks it on Ubuntu with Node.js 20.0.0, 22 and 24. |
| Other systems | macOS, Windows and other Linux distributions are **unverified**, not known to be broken. |
| Versioning | The package is on `0.x`. Commands and file formats may change between minor versions. |
| Support | Only the latest release gets fixes. There are no parallel maintenance lines and no response-time commitments. |

### Breaking changes before 1.0

A change that requires users to edit their files or alter their workflow must be
named in the release notes, with the exact migration steps. There is no
automatic migration today; all migrations are manual.

Migrations that exist now:

| Change | What to do |
|---|---|
| Manifest `schemaVersion` must be `2`. | Set `"schemaVersion": 2` and review selections. |
| A missing `skills` or `subagents` field means *none*, not *all*. | Add an explicit `true` where you relied on "all". |
| `copies` is no longer supported. | Declare `shared_files` in the skill's frontmatter. |
| `publish.includeNewByDefault` is no longer supported. | Remove it; select new skills with `--new-skill`. |
| Lock version 5 is read, version 6 is written. | Run `lsm sync --update`; a manifest with subagents requires it. |

Do not add behavior that silently reinterprets existing files. Fail with an
explicit message instead.

## Before merging

Run the checks listed in [CONTRIBUTING.md](../CONTRIBUTING.md#checks-to-run).
CI runs them on pull requests and on pushes to `main`, `master` and `dev`. At
the time of writing the repository has no branch protection or rulesets, so
nothing enforces these checks remotely: confirm they passed before merging.

## Releasing

Releases are published from GitHub Releases through
`.github/workflows/publish.yml`. The npm Trusted Publisher must point at that
workflow. Publishing is irreversible for a given version, so finish the
preparation first.

1. **Prepare.** Start from an up-to-date default branch with all intended
   changes merged. Run every check in
   [CONTRIBUTING.md](../CONTRIBUTING.md#checks-to-run), including
   `npm run test:package`.
2. **Write the release notes** (see below) and note any migration.
3. **Bump the version** with `npm version patch|minor` (it creates the commit and
   the `vX.Y.Z` tag). Never edit `version` by hand: the workflow requires the
   tag and `package.json` to match.
4. **Push and release:**

   ```bash
   git push --follow-tags
   gh release create vX.Y.Z --notes-file release-notes.md
   ```

   Do not mark it as a pre-release; the workflow skips pre-releases.
5. **What the workflow does.** It verifies tag and version, installs
   dependencies, runs tests, coverage, typecheck, lint, build and the production
   dependency audit, then packs **one** archive and records its SHA-256. That
   archive is installed and checked on Node.js 20.0.0, 22 and 24. Only if all
   pass does the publish job re-check the checksum and `npm publish` the same
   file. Nothing is rebuilt between the check and the publish.
6. **After publishing.** Confirm `npm view @wkulinski/lsm version`, and run the
   README quick start against the released version.

If any matrix job fails, nothing is published. Fix the cause, then release a new
version; do not reuse or move a tag.

### Release notes

Generated comparisons are not enough. Each release should state:

```markdown
## Changes for users
- What changed and why it matters.

## Migration
- Exact steps, or "None".

## Limitations
- Known gaps relevant to this release.

## Verification
- Checks that passed (tests, package check on Node 20.0.0 / 22 / 24).

Full changelog: https://github.com/wkulinski/lsm/compare/vOLD...vNEW
```

## Repository settings

- Private vulnerability reporting is enabled; reports arrive as GitHub security
  advisories and are described in [SECURITY.md](../SECURITY.md).
- Keep the repository description, topics and npm keywords consistent with what
  LSM does.
