# Contributing

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
you want to solve.

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

## Code, tests and pull requests

Code style, test requirements, commit messages and pull request contents are
described in [AGENTS.md](AGENTS.md). Update [README.md](README.md) and
[docs/](docs/README.md) when user-facing behavior changes. Verified
environments are listed in [Maintaining](docs/maintaining.md#what-lsm-promises).
