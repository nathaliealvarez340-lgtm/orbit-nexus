# ORBIT NEXUS — Fase 5 Shared Contract

This document defines the shared contract between:

- Claude: fiscal foundation/backend
- Codex: Invoice Studio/frontend

Both agents must treat this document as authoritative for Fase 5A/5B.

Do not independently rename fields, invent alternate response shapes or create competing invoice concepts.

---

# 1. Existing architecture

ORBIT already has:

- `StampedInvoice`
- `StampedInvoiceConcept`
- invoice drafts
- invoice settings
- client catalog
- fiscal profile
- outgoing invoice service
- `/api/outgoing-invoices`
- draft preview flow
- invoice plan gating

Fase 5 extends these systems.

Do not create a second invoice domain.

---

# 2. Scope of this first parallel sprint

This sprint covers:

## Claude

Fiscal/backend foundation:

- SAT catalogs
- fiscal validation rules
- reusable invoice concept catalog
- draft contract expansion
- server-side totals
- server-side validation
- API/domain support required by Invoice Studio

## Codex

Invoice Studio frontend:

- professional invoice editor
- issuer section
- receiver/client section
- document type
- CFDI use
- payment method
- payment form
- currency
- concept editor
- taxes/totals display
- validation panel
- draft/save UX
- review screen
- responsive/accessibility

This sprint does NOT include real PAC submission.

No agent may simulate successful timbrado.

---

# 3. Current invoice entity

`StampedInvoice` remains the outgoing invoice aggregate.

Existing states remain valid for this sprint:

- `DRAFT`
- `READY`
- `ISSUED`
- `CANCELLED`
- `ERROR`

For Fase 5A/5B:

- new editable invoice = `DRAFT`
- fiscally complete draft may become `READY`
- `ISSUED` remains reserved for a real future stamped CFDI

Do not mark invoices as `ISSUED` in this sprint.

---

# 4. Invoice Studio context

The frontend requires an invoice creation context with the following conceptual shape.

```ts
type InvoiceStudioContext = {
  issuer: {
    organizationId: string;
    legalName: string;
    rfc: string;
    fiscalRegime: string;
    postalCode: string;
    email: string;
    profileComplete: boolean;
  };

  settings: {
    prefix: string;
    nextNumberPreview?: number;
    currencyDefault: string;
    paymentMethodDefault?: string;
    paymentFormDefault?: string;
    template?: string;
    color?: string;
    logoAvailable: boolean;
  };

  clients: InvoiceStudioClient[];

  savedConcepts: SavedInvoiceConcept[];

  catalogs: InvoiceFiscalCatalogs;
};