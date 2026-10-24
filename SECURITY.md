# Security policy

## Reporting a vulnerability

Please report vulnerabilities **privately**. Do not open a public issue or pull
request for them.

Use GitHub's private vulnerability reporting:
<https://github.com/wkulinski/lsm/security/advisories/new> (you need to be
signed in to GitHub). Only the maintainers can see the report.

Include what you need to make the problem reproducible:

- the LSM version (`lsm --version`), Node.js version and operating system,
- a minimal manifest with private values removed,
- the steps or commands, and what you expected versus what happened,
- the impact you see.

Never include tokens, passwords or the contents of private repositories. If a
proof of concept needs a repository, use a throwaway local one.

LSM is maintained by individuals, so this policy does not promise a response
time. Reports are read and handled as capacity allows.

## What counts as a vulnerability

LSM reads and writes files in your project, pulls content from Git repositories
and can push branches. Examples of issues to report privately:

- writing, overwriting or deleting files outside the intended directories
  (path traversal, symbolic-link escapes),
- deleting or overwriting local files that LSM should have protected without
  `--force` or an explicit confirmation,
- leaking credentials or other secrets through output, files or Git operations,
- publishing content that was not selected or confirmed.

## What is not a vulnerability

- **The content of a source you chose to sync.** Skills, subagents and plugins
  are instructions and code that your agents follow or run. The lock makes an
  install reproducible; it does not make the content safe. Only sync sources you
  trust and review updates.
- Behavior that `--force` or a confirmation prompt is documented to cause.

Ordinary bugs, including data-loss bugs that do not involve an attacker, go to
the [public issue tracker](https://github.com/wkulinski/lsm/issues). See
[CONTRIBUTING.md](CONTRIBUTING.md).

## Supported versions

Fixes are made on the current code and released as a new version of the
package. LSM does not maintain older release lines separately; update to the
latest version to receive a fix.
