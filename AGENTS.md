# ORBIT NEXUS — Agent Instructions

These instructions apply to every coding agent working in this repository.

Before significant work, read:

1. `docs/ARCHITECTURE.md`
2. `docs/PRODUCT.md`
3. `docs/WORKTREE-RULES.md`
4. The task-specific brief for the current branch/worktree.

Do not invent requirements outside those sources or the current task.

---

## Project

ORBIT NEXUS is a multi-tenant financial and fiscal operations platform.

Existing systems include:

- Better Auth and persistent sessions.
- Organization-based multi-tenancy.
- Strict tenant isolation.
- Private tickets and documents.
- Expense tracking.
- Monthly dashboards and reports.
- Fiscal profiles.
- Clients.
- Invoice preparation and issued-invoice flows.
- Ticket OCR / intelligence.
- Ticket billing automation.
- Billing providers and attempts.
- Human approval before external billing submission.
- Security checks and E2E QA.

Extend existing systems instead of rebuilding them.

---

## Source of truth

Technical architecture:
`docs/ARCHITECTURE.md`

Product behavior:
`docs/PRODUCT.md`

Parallel development rules:
`docs/WORKTREE-RULES.md`

If documentation and code disagree:

1. inspect the implementation;
2. identify the discrepancy;
3. do not silently redesign shared architecture;
4. report the conflict before making destructive or cross-cutting changes.

---

## Git and worktrees

Before editing, always check:

`git branch --show-current`

`git status --short`

When assigned to an agent worktree:

- remain on the assigned branch;
- modify only the assigned scope;
- never switch to `main`;
- never modify another agent's worktree;
- never merge another agent's branch yourself;
- never create extra worktrees unless requested.

Do not perform `git add`, `commit`, `push`, `merge`, `rebase`, `reset`, `checkout` or `restore` unless explicitly instructed by the user.

Task-specific file ownership rules are mandatory.

If a task requires changing a shared contract used by another agent, stop and report it first.

---

## Shared/high-risk files

Treat these as shared architectural surfaces:

- `prisma/schema.prisma`
- authentication core
- tenant resolution
- shared route contracts
- shared fiscal catalogs
- global navigation
- common financial/domain types

Do not casually modify them during parallel work.

---

## Multi-tenant security

Every business resource must belong to an authorized Organization.

Never authorize using an arbitrary `organizationId` supplied by the client.

Organization context must be validated server-side from the authenticated user/session/membership.

Organization A must never access Organization B:

- tickets;
- expenses;
- clients;
- invoices;
- reports;
- fiscal profiles;
- documents;
- billing attempts;
- provider configuration.

Tenant isolation is release-blocking.

---

## Authentication

Do not replace or bypass Better Auth.

Do not implement custom password hashing.

Do not weaken:

- session validation;
- secure cookies;
- authorization;
- CSRF/origin protection;
- logout/revocation;
- protected routes.

Authorization must exist server-side, not only in UI.

---

## Prisma and database

Inspect existing models before adding new ones.

Prefer extending existing entities over duplicating concepts.

Schema changes should be additive and non-destructive whenever possible.

Never apply migrations to Neon or production unless the user explicitly instructs you to.

Use the project's isolated local PostgreSQL workflow for development and QA.

Never use destructive production operations such as `prisma migrate reset` or `prisma db push`.

---

## Financial data

Use the existing Decimal/monetary utilities.

Do not use raw JavaScript floating point for persisted financial values.

Keep separate:

- ticket-derived expenses;
- CFDI received from ticket billing;
- invoices issued by the Organization to clients.

`Gastos por mes` and `Facturación por mes` must never be combined.

---

## Tickets

Maintain separation between:

- raw OCR;
- normalized/extracted data;
- user-confirmed data.

Confirmed data is the business source of truth.

Retries must not create duplicate Expenses.

Do not overwrite raw extraction after manual correction.

---

## Ticket billing

Human approval is required before final external submission.

Do not mark a ticket as invoiced merely because:

- a button was clicked;
- HTTP 200 was returned;
- a redirect occurred;
- a page changed.

Require actual billing evidence using the existing billing architecture.

Prevent duplicate submission with the existing idempotency/concurrency mechanisms.

---

## External portals

Use the provider adapter / automation runner architecture.

Do not create unsafe generic scraping.

Respect existing SSRF protections.

Never allow billing navigation to:

- localhost;
- loopback IPs;
- private network ranges;
- link-local addresses;
- cloud metadata endpoints;
- `file:`
- `javascript:`
- `data:`

Validate redirects as well as initial URLs.

If no verified adapter exists, preserve assisted/manual fallback.

---

## Files and documents

Tickets, CSF, CFDI XML/PDF and diagnostic artifacts are private.

Validate uploads server-side:

- MIME;
- size;
- tenant ownership;
- authorization.

Never expose storage paths or filesystem internals.

Do not log passwords, secrets, full fiscal profiles, private documents or full OCR payloads in production.

---

## Secrets

Never place credentials in:

- source code;
- `.env.example`;
- docs;
- tests;
- prompts;
- Git history.

`.env` and environment-specific secret files remain ignored.

Never print secret values while debugging.

Run `npm run security:check` before completing substantial work.

---

## External integrations

Never simulate success for an integration that is not actually configured.

Examples:

- OCR provider;
- SAT;
- PAC/timbrado;
- email;
- browser automation worker;
- payment provider.

Use explicit states such as:

- not configured;
- manual;
- assisted;
- unsupported.

---

## UI

Preserve ORBIT NEXUS visual language unless the task explicitly changes it:

- dark surfaces;
- graphite/black;
- glass treatment;
- current typography;
- user-selected accent;
- responsive layouts.

Do not modify the public landing unless explicitly requested.

Maintain accessibility:

- labels;
- keyboard navigation;
- visible focus;
- contrast;
- accessible icon buttons.

---

## Validation

Use existing project scripts.

For substantial work, validate with the relevant combination of:

- `npm run security:check`
- `npm audit`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- relevant E2E suites
- `npm run build`
- `git diff --check`
- `git status --short`

Do not declare success while relevant tests fail.

Do not change correct product behavior merely to satisfy a broken test.

---

## Completion report

At the end report concisely:

- what changed;
- material files/modules;
- tests executed;
- validation results;
- known limitations;
- external configuration required;
- migration status;
- Git status.

Do not commit, push or deploy unless explicitly instructed.

---

<!-- BEGIN:nextjs-agent-rules -->
# Next.js Agent Rules

This is NOT the Next.js you know.

This version has breaking changes — APIs, conventions, and file structure may differ from training data.

Read the relevant guide in `node_modules/next/dist/docs/` before writing Next.js-specific code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->