# Invoice Studio — final Fase 5A/5B integration

The frontend imports canonical types from `src/types/invoice-studio.ts`.
There is no ambient type bridge, backend fallback or bundled alternate SAT catalog.

## Real APIs

- `GET /api/outgoing-invoices/context`: issuer, settings, clients and small catalogs.
- `POST /api/outgoing-invoices/validate`: `ValidateInvoiceDraftResponse`; `totals: null`
  is a valid structural-error result. Backend issues remain visible and focusable.
- `POST /api/outgoing-invoices`: canonical draft with `Idempotency-Key`.
- `PATCH /api/outgoing-invoices/[id]`: canonical editable fields plus `expectedUpdatedAt`.
- `GET /api/outgoing-invoices/[id]`: real `InvoiceDraftDetail`, snapshots and ordered concepts.
- `POST /api/outgoing-invoices/[id]/ready`: concurrency token, then confirmed detail.
- `GET /api/invoice-concepts?q=...`: live tenant-scoped template search; selections
  become independent editable invoice line snapshots.
- `GET /api/fiscal-catalogs/product-services|units?q=...&limit=30`:
  `FiscalCatalogSearchResponse`. The UI displays partial coverage when `complete=false`.

Transport validates response shape, not fiscal rules. `DRAFT_CONFLICT` blocks
further writes while preserving the capture. Other 409 codes show the backend
message without pretending they are concurrent edits. Fiscal errors allow DRAFT
when structurally valid; the backend controls READY. Existing requirements for a
stored profile and invoice configuration/logo remain server-side and unchanged.

The recent list includes DRAFT and READY through the existing authorized service.
Private preview/logo access remains available. No PAC, fictitious UUID or seal.

## Local verification

`npm run build`, then `node tests/invoice-studio-e2e.mjs`.
The suite starts the local build at localhost:3101 with ephemeral PGlite and
synthetic local users, CSF and logo documents. All business API responses and
persistence are real; no browser response mocks. On Windows it uses installed Edge
or `PLAYWRIGHT_CHANNEL`. SQL is restricted to local plan setup and assertions.

For interactive development: set PORT to 3101 and run `npm run dev:local`.
For legacy regression: set PORT to 3101 and run `npm run test:phase3:e2e`.
Do not connect these tests to Neon or production.
