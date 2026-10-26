# LSM example

A minimal, harmless demo used by the LSM quick start and by the package tests.

- `skill-source/skills/hello-lsm/SKILL.md` is a skill that only prints a greeting.
- `skill-source/skills/_shared/hello-lsm.txt` is the shared file declared by that skill.
- `skills.json` is a manifest that installs only `hello-lsm` for the `codex` agent from this directory
  on the `master` branch of `https://github.com/wkulinski/lsm`.

Follow the [quick start](../README.md#quick-start), or download the manifest
into an empty directory:

```bash
mkdir lsm-demo && cd lsm-demo
curl -fsSLO https://raw.githubusercontent.com/wkulinski/lsm/master/examples/skills.json
lsm sync --update
```
