# ORBIT NEXUS — Worktree Rules

This document defines how parallel development works in ORBIT NEXUS.

The goal is to allow Codex and Claude Code to work simultaneously without creating merge conflicts, duplicating architecture or changing shared contracts independently.

---

# 1. Main branch

`main` is the stable integration branch.

Agents do NOT perform feature development directly on `main`.

`main` should represent the latest reviewed and integrated production-ready baseline.

Only the user/integrator decides when work is merged into `main`.

---

# 2. Worktree model

Parallel development uses separate Git worktrees.

Expected structure:

```text
ORBIT NEXUS/
ORBIT NEXUS - CODEX/
ORBIT NEXUS - CLAUDE/