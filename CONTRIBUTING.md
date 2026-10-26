# Contributing

Thanks for your interest in LSM. This page explains how to report problems,
propose changes and run the checks.

Please report **security vulnerabilities privately**, as described in
[SECURITY.md](SECURITY.md), not in public issues.

## Reporting a bug

Open an issue at <https://github.com/wkulinski/lsm/issues> with:

- `lsm --version`, `node --version`, `git --version` and your operating system,
- the command you ran and its full output,
- your `skills.json` with private values removed, and whether `skills.lock.json`
  existed,
- what you expected and what happened.

The best reports reproduce with a small local Git repository as the source, so
no network access or private repository is needed. Do not paste tokens,
credentials or private repository contents.

## Proposing a change

For anything beyond a small fix, open an issue first and describe the problem
you want to solve. Changes that add options, new artifact types or new sources
increase the surface that must be tested and documented, so they need a clear
reason.

## Setting up

Develop on Node.js 22.13 or newer (what CI uses and what the lint tooling
requires) with `git`. The packaged CLI itself supports Node.js 20 and newer.

```bash
git clone https://github.com/wkulinski/lsm.git
cd lsm
npm ci
```

Run the CLI from the checkout with `node bin/lsm.mjs --help`.

## Checks to run

These are the same checks CI runs; run them before opening a pull request:

```bash
npm test
npm run test:coverage
npm run typecheck
npm run test:typecheck
npm run lint:js
npm run build
npm run test:package      # needs the build; installs the packed archive and checks it
npm audit --omit=dev
```

`npm test -- tests/SomeFile.test.ts` runs a single test file.

## Code and tests

- TypeScript, four-space indentation, single quotes; ESLint enforces the style.
- Keep public CLI and `createManager()` behavior backward compatible unless the
  change is explicitly planned and documented.
- Every behavior change needs a focused Vitest test. Use temporary local Git
  repositories; tests must not depend on the network or on your real
  workspace.
- Filesystem changes need coverage for path traversal, symbolic links,
  unmanaged files and cleanup.
- Sync changes need coverage for both locked mode and `--update`.
- Update the documentation in [README.md](README.md) and [docs/](docs/README.md)
  when user-facing behavior changes.

Repository layout and further conventions are in [AGENTS.md](AGENTS.md).

## Environments

LSM declares Node.js `>=20`. CI installs the packaged archive and checks it on
Ubuntu with Node.js 20.0.0, 22 and 24. Other operating systems, including macOS
and Windows, are not verified. That means untested, not unsupported: reports
and fixes are welcome.

## Commits and pull requests

Use short conventional commit messages, for example `fix(sync): avoid false
conflicts after upstream changes`.

A pull request should include:

- a short problem and solution summary,
- the validation commands you ran and their results,
- any compatibility or release implications, such as a manifest change that
  needs a manual migration.
