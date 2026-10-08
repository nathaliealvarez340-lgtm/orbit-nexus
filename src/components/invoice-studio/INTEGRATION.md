# Invoice Studio — frontend integration pending Fase 5A

Canonical source: `docs/tasks/FASE5-CONTRACT.md`, sections 1–37.

This frontend does not modify Prisma, migrations, backend services, API handlers,
shared fiscal rules, authentication or navigation.

## Shared types

`pending-contract.d.ts` is a **temporary type-only declaration** copied verbatim
from the contract. All consumers import `@/types/invoice-studio`. Claude owns that
missing file. **Remove the temporary declaration when Claude's real module is
integrated**, then typecheck against that module. This is not a runtime mock.

## Backend required

- `GET /api/outgoing-invoices/context` → `InvoiceStudioContext`.
- `POST /api/outgoing-invoices/validate` → totals plus validation. The document
  defines those types but does not explicitly define this response envelope;
  confirm `{ totals, validation }` with Claude before real integration.
- `POST /api/outgoing-invoices` and `PATCH /api/outgoing-invoices/[id]` → the
  section 20 response. PATCH includes `expectedUpdatedAt`.
- `GET /api/outgoing-invoices/[id]` → document request fields, snapshots named
  `issuerSnapshot`/`receiverSnapshot` (existing aggregate names), ordered concepts,
  and section 20 fields. Section 26 does not provide a full named DTO; confirm this
  projection before integration. Date/Decimal values must be serialized strings.
- `POST /api/outgoing-invoices/[id]/ready` must verify on the server. The UI reads
  the detail again and only displays READY when it is confirmed there.
- `GET /api/fiscal-catalogs/[catalog]?q=...&limit=30` → `CatalogOption[]`.
  Concrete catalog identifiers are not specified in section 13. UI currently
  uses canonical field names `productCode`/`unitCode`; Claude must confirm these
  identifiers and the array response before integration. No SAT list is bundled.
- Saved concepts are supplied by context; this sprint's UI searches that list
  and creates snapshots. It does not implement another concept-management domain.
- Support `Idempotency-Key` on creation or document the definitive deduplication
  mechanism. Unknown save outcomes block further submissions; no automatic retry.

The legacy backend remains untouched and cannot provide these capabilities yet.
Missing context produces an honest unavailable state. An old creation response
without totals/validation is never accepted as confirmation of Fase 5 completion.
Fiscal errors do not disable saving; structural/security limits remain server-side.
E/T appear unavailable; only I can be marked READY. There is no PAC call.

## QA boundaries

Frontend E2E uses authenticated local accounts and an isolated local database,
with browser-only fixtures for missing Fase 5 API responses. Those fixtures are
tests, never app fallbacks. They validate UI behavior, not Claude's fiscal rules
or persistence. Re-run real integrated E2E after Fase 5A is available.

Run `npm run build` then `node tests/invoice-studio-e2e.mjs`. The runner starts
the local build at localhost:3101 with an ephemeral PGlite database and generated
test credentials. On Windows it uses installed Edge, overridable with
`PLAYWRIGHT_CHANNEL`. For interactive development use `PORT=3101 npm run dev:local`
(set PORT in the PowerShell session); never point this work at Neon.

The existing persisted preview and private logo access remain available. An edit
link opens the Studio; the Studio provides expanded preview/review without a
fictitious XML, UUID or seal. The recent server list currently includes DRAFT only;
READY is reopened by ID until Claude exposes a draft-list contract.
