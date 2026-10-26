# Maintaining LSM

For people who release LSM or decide what it promises. Contributors should
start with [CONTRIBUTING.md](../CONTRIBUTING.md).

## What LSM promises

| Area | Commitment |
|---|---|
| Node.js | `engines` declares `>=20`. This is kept; raising it is a deliberate, announced change. |
| Verified environment | CI installs the packaged archive and checks it on Ubuntu with Node.js 20.0.0, 22 and 24. |
| Other systems | macOS, Windows and other Linux distributions are **unverified**, not known to be broken. Reports and fixes are welcome. |
| Versioning | The package is on `0.x`. Commands and file formats may change between minor versions. |
| Support | Only the latest release gets fixes. There are no parallel maintenance lines and no response-time commitments. |

### Breaking changes before 1.0

A change that requires users to edit their files or alter their workflow must be
named in the release notes, with the exact migration steps, and added to
[Upgrading older files](configuration.md#upgrading-older-files).

Do not add behavior that silently reinterprets existing files. Fail with an
explicit message instead.

## Before merging

Run the checks listed in [CONTRIBUTING.md](../CONTRIBUTING.md#checks-to-run).
CI runs them on pull requests and on pushes to `main`, `master` and `dev`;
confirm they passed before merging.

## Releasing

Releases are published from GitHub Releases through
`.github/workflows/publish.yml`. The npm Trusted Publisher must point at that
workflow.

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
5. **What the workflow does.** It packs **one** archive, records its SHA-256,
   and checks it on the Node.js versions listed above. Only after all checks
   pass does it verify the checksum again and publish the same archive, without
   rebuilding.
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
- Checks that passed (tests, package check on the Node.js matrix).

Full changelog: https://github.com/wkulinski/lsm/compare/vOLD...vNEW
```
