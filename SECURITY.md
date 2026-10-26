# Security policy

## Reporting a vulnerability

Please report vulnerabilities **privately**. Do not open a public issue or pull
request for them.

Use GitHub's private vulnerability reporting:
<https://github.com/wkulinski/lsm/security/advisories/new>.

Include the same information as a [bug report](CONTRIBUTING.md#reporting-a-bug)
and the impact you see. Never include tokens, passwords or the contents of
private repositories; if a proof of concept needs a repository, use a throwaway
local one.

There is no response-time commitment.

## What counts as a vulnerability

Examples of issues to report privately:

- writing, overwriting or deleting files outside the intended directories
  (path traversal, symbolic-link escapes),
- deleting or overwriting local files that LSM should have protected without
  `--force` or an explicit confirmation,
- leaking credentials or other secrets through output, files or Git operations,
- publishing content that was not selected or confirmed.

## What is not a vulnerability

- **The content of a source you chose to sync.** See
  [Safety](README.md#safety).
- Behavior that `--force` or a confirmation prompt is documented to cause.

Ordinary bugs, including data-loss bugs that do not involve an attacker, are
[reported publicly](CONTRIBUTING.md#reporting-a-bug).

## Supported versions

Only the latest release receives fixes.
