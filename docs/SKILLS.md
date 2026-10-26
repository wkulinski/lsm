# Skills Index

Project-local skills are installed below `.agents/skills/`. The active skill
definitions are maintained by the configured skills source and should be
updated through the skills synchronization workflow.

The main workflow routing is defined in
[`skill-routing-policy.md`](../.agents/skills/_shared/references/skill-routing-policy.md).
The trigger table selects a skill by intent; the alphabetical list is at the
end.

## Trigger table

### Planning

| Intent | Skill | Next step |
| --- | --- | --- |
| Prepare an execution plan from an issue, a file or a description | `$task-plan` | critical verification, then plan validation |
| New requirement, scope correction or a request to record something during active plan work | `$task-plan` | plan change and its review, no repository changes |
| Execute or resume an existing plan or WP | `$plan-execute` | the selected WP goes to `$code-implement` |

### Implementation

| Intent | Skill | Next step |
| --- | --- | --- |
| Implement a change, bug fix or refactor without an existing plan | `$code-implement` | implementation, evidence and light verification |

### Code and plan review

| Intent | Skill | Next step |
| --- | --- | --- |
| Review code or current changes, or run a separate read-only plan review | `$code-review` | findings first, coverage and a verdict before merge or plan execution |
| Quickly check an increment during a task, or explicitly choose a quick check | `$review-quick` | findings-first report without a formal verdict |
| Delegate a read-only code review from OpenCode to Claude Code (Opus) through Paseo | `$claude-review` | reviewer report evaluated by the `$code-review` gate |

### Instruction review

| Intent | Skill | Next step |
| --- | --- | --- |
| Audit a skill, local rules, an agent or a whole directory against the authoring standard | `$skill-review` | findings or standard gaps with evidence, no file edits |
| Clean up local rules and remove duplicates of the `_shared` baseline | `$rules-sync` | synchronized rules with overrides reported explicitly |

### QA and commit

| Intent | Skill | Next step |
| --- | --- | --- |
| Run deterministic QA from the command matrix: linters, tests and review | `$qa-run` | QA report and QA session |
| Commit changes following the repository workflow | `$git-commit` | full test, validation and commit procedure |
| Prepare only the commit message | `$commit-message-write` | written to `COMMIT_MESSAGE_DIR/commit-message.txt` |

### Documentation

| Intent | Skill | Next step |
| --- | --- | --- |
| Tidy up documentation after larger changes | `$docs-sync` | merged duplicates and consistent references |
| List open TODO items from the documentation | `$docs-todo` | task list without implementation |
| Refresh the skills index: list and trigger table | `$skills-index-refresh` | `SKILLS_INDEX_DOC` matches the skills directory |

### Issue handling

| Intent | Skill | Next step |
| --- | --- | --- |
| Start work on an issue | `$gh-issue-start` | branch, In progress status and assignee |
| Send an issue to review | `$gh-issue-review` | push, PR, In review status and optional reviewer |
| Set an issue status in GitHub Projects v2 | `$gh-issue-status-set` | status updated from the branch or issue number |

### Diagnostics and maintenance

| Intent | Skill | Next step |
| --- | --- | --- |
| Load or refresh the project context | `$context-refresh` | context manifest and repository state |
| Hand the context over to the next agent | `$handoff-refresh` | state snapshot for a new session |
| Clear the local agent cache | `$agent-cache-clear` | state removed from `CACHE_PATH` |

### Skills and release management

| Intent | Skill | Next step |
| --- | --- | --- |
| Sync, publish or change the selection of skills from the source repository | `$llm-skills-manager` | sync/publish through the CLI or API with plan review |
| Prepare and release a new npm package version | `$npm-release-manager` | GitHub Release and Trusted Publishing |

## Skill list

- `$agent-cache-clear`
- `$claude-review`
- `$code-implement`
- `$code-review`
- `$commit-message-write`
- `$context-refresh`
- `$docs-sync`
- `$docs-todo`
- `$gh-issue-review`
- `$gh-issue-start`
- `$gh-issue-status-set`
- `$git-commit`
- `$handoff-refresh`
- `$llm-skills-manager`
- `$npm-release-manager`
- `$plan-execute`
- `$qa-run`
- `$review-quick`
- `$rules-sync`
- `$skill-review`
- `$skills-index-refresh`
- `$task-plan`
