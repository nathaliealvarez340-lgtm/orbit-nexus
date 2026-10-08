# ORBIT NEXUS — Claude Code Instructions

@AGENTS.md

Claude Code is working as one agent in a parallel-development workflow.

Before starting any assigned task:

1. Read `AGENTS.md`.
2. Read `docs/ARCHITECTURE.md`.
3. Read `docs/PRODUCT.md`.
4. Read `docs/WORKTREE-RULES.md`.
5. Read the task-specific brief supplied for this worktree.
6. Run:
   - `git branch --show-current`
   - `git status --short`

## Worktree behavior

When working from the Claude worktree:

- remain on the assigned `claude/...` branch;
- never switch to `main`;
- never modify the Codex worktree;
- never merge Codex work yourself;
- respect the file ownership defined in the task brief;
- do not modify shared contracts unless the task explicitly authorizes it.

If completing the task requires changing a shared contract or a file owned by Codex:

STOP and report the dependency instead of editing it.

## Working style

Prefer:

- understanding existing implementation before adding abstractions;
- extending existing modules instead of duplicating systems;
- small cohesive changes;
- existing utilities, components and patterns;
- explicit verification after implementation.

Do not redesign unrelated areas while completing a scoped task.

## Git

Do not run:

- `git add`
- `git commit`
- `git push`
- `git merge`
- `git rebase`
- destructive Git commands

unless explicitly instructed by the user.

## Completion

Before declaring a task complete:

- run the tests relevant to the assigned work;
- run the validation required by `AGENTS.md`;
- report files materially changed;
- report tests/results;
- report dependencies on Codex or shared contracts;
- report Git status.

Do not deploy or modify production unless explicitly instructed.