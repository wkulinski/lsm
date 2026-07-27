# Project conventions
- Four-space indentation and single quotes in TypeScript.
- Keep CLI/manager dependency direction toward core services/adapters; reuse existing filesystem, Git, hashing, manifest and path-safety helpers.
- Public CLI and `createManager()` behavior should remain backward compatible unless explicitly planned.
- Prefer focused classes/functions, explicit result types, stable public error messages.
- Filesystem sync must account for traversal, symlinks, unmanaged files, cleanup, ownership and executable permissions; tests should use temporary Git repositories for integration behavior.