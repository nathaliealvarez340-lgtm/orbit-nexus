# ORBIT NEXUS — Product Reference

This document describes the current product behavior and functional boundaries of ORBIT NEXUS.

It is a source of truth for coding agents working in parallel.

For technical implementation details, read:

`docs/ARCHITECTURE.md`

For worktree and parallel-development rules, read:

`docs/WORKTREE-RULES.md`

---

# 1. Product purpose

ORBIT NEXUS is a multi-tenant financial and fiscal operations platform for businesses.

Its purpose is to centralize and automate workflows such as:

- ticket capture;
- expense registration;
- invoice retrieval from purchase tickets;
- fiscal profile management;
- client management;
- invoice preparation;
- monthly financial reporting;
- fiscal documents;
- controlled ticket billing automation.

ORBIT must reduce repetitive fiscal/administrative work without sacrificing:

- human approval;
- traceability;
- tenant isolation;
- fiscal-data integrity;
- security.

---

# 2. Public product

The public landing page is already implemented.

Do not redesign or modify it unless a task explicitly requests changes.

The public product includes:

- ORBIT NEXUS branding;
- product explanation;
- ticket/fiscal workflow explanation;
- authentication entry points;
- responsive public layout.

---

# 3. Authentication

ORBIT supports:

- registration;
- login;
- persistent sessions;
- logout;
- protected routes;
- organization membership;
- active workspace selection.

Authentication uses Better Auth.

Password inputs support show/hide controls where applicable.

Password changes require the current password.

---

# 4. Multi-tenancy

The business isolation unit is:

`Organization`

An Organization represents a company/workspace.

Users may belong to one or more Organizations through memberships.

Every business resource must belong to the active authorized Organization.

Examples:

- tickets;
- expenses;
- clients;
- invoices;
- reports;
- fiscal profiles;
- notifications;
- documents;
- billing attempts.

Cross-Organization access is prohibited.

---

# 5. Main navigation

Authenticated navigation is organized into:

## PRINCIPAL

- Dashboard
- Reportes
- Notificaciones
- Soporte

## ADMINISTRACIÓN

- Empresas
- Perfil fiscal
- Usuario

## FACTURACIÓN

- Facturas
- Tickets

## CATÁLOGO

- Clientes

## ACCESO RÁPIDO

- Nueva factura
- Realizar ticket

- Cerrar sesión

The sidebar supports collapsed/expanded behavior, nested navigation, responsive mobile behavior and the user's selected accent color.

---

# 6. Dashboard

The Dashboard presents real Organization-scoped financial information.

Two primary financial concepts must remain separate.

## Gastos por mes

Represents expenses derived from tickets / purchase activity.

Conceptually:

Ticket
→ confirmed data
→ Expense
→ monthly expense aggregation

This metric must not include invoices issued by the Organization to clients.

## Facturación por mes

Represents invoices issued by the Organization to its clients.

This metric must not include:

- ticket expenses;
- received CFDI;
- invoice drafts;
- failed invoices.

Different currencies must not be incorrectly summed into one value.

The dashboard also presents operational metrics related to tickets, expenses and invoice activity.

---

# 7. Reports

ORBIT provides monthly expense reports for closed calendar months.

Reports are Organization-scoped and idempotent.

A report can include:

- Organization;
- RFC;
- year/month;
- generation date;
- total expenses;
- ticket count;
- invoiced ticket count;
- pending ticket count;
- expense detail;
- merchant;
- issuer RFC when available;
- ticket/folio;
- UUID when available;
- amount;
- billing status.

Reports support:

- PDF export;
- real XLSX export.

XLSX includes:

- summary;
- expense detail.

Reports must not duplicate monthly records for the same Organization/year/month.

---

# 8. Companies / Organizations

The Companies interface uses the existing `Organization` domain.

Users can:

- view Organizations they belong to;
- see their role;
- switch active Organization;
- create a new Organization where permitted.

Do not create a separate competing Company entity unless architecture explicitly changes.

---

# 9. Fiscal profile

Fiscal Profile belongs to the active Organization.

Current fiscal-profile concepts include:

- RFC;
- legal/fiscal name;
- person type;
- tax regime;
- fiscal postal code;
- default CFDI use;
- fiscal email;
- structured fiscal address;
- Constancia de Situación Fiscal.

The Constancia de Situación Fiscal is required by ORBIT to consider the profile complete.

This is an ORBIT product requirement, not a claim that the SAT legally requires uploading the document to ORBIT.

Fiscal documents remain private.

Uso CFDI must use structured SAT catalog data rather than arbitrary free text.

---

# 10. User settings

The User area includes:

## Account

- name;
- email;
- password change.

## Personalization

Dashboard accent options:

- purple;
- blue;
- orange;
- red.

Purple is the default.

The accent affects authenticated product highlights/components, not the public brand or semantic success/error colors.

## Subscription

Product plan concepts:

- FREE
- PRO
- MAX

Pricing and commercial limits may evolve separately.

Feature gating must exist server-side where required.

---

# 11. Clients

Clients belong to the active Organization.

The Client catalog supports:

- list;
- create;
- read;
- edit;
- archive/delete when safe.

Client data can include:

- RFC;
- legal/name;
- person type;
- internal reference;
- foreign tax identifier;
- tax regime;
- default CFDI use;
- default payment method;
- phone;
- email;
- additional emails;
- notes;
- structured address.

A client with historical references should be archived instead of destroying accounting/fiscal integrity.

---

# 12. Invoice preparation

Invoice preparation for invoices issued by the Organization is distinct from ticket billing.

The invoice workflow includes concepts such as:

- issuer from Fiscal Profile;
- receiver from Client;
- voucher type;
- CFDI use;
- payment form;
- payment method;
- currency;
- date;
- series/prefix;
- folio;
- multiple concepts;
- subtotal;
- tax;
- total.

Financial calculations must use appropriate decimal handling.

Where a real PAC is not configured, ORBIT must not falsely claim that an invoice was timbrada.

Draft/preparation states must remain explicit.

---

# 13. Invoice settings

Organization invoice settings can include:

- company logo;
- folio prefix;
- server-managed sequential folio;
- visual color;
- predefined invoice template.

Users control the prefix, not the sequential numeric counter.

The sequence must be concurrency-safe.

---

# 14. Issued CFDI

The issued-CFDI area is for invoices actually emitted by the Organization to clients.

It can display:

- folio;
- UUID;
- client;
- RFC;
- date;
- subtotal;
- taxes;
- total;
- status;
- XML;
- PDF.

Drafts are not considered issued CFDI.

---

# 15. Tickets

Tickets are a central ORBIT workflow.

Users can:

- capture from camera;
- upload supported files;
- preview;
- retry capture;
- analyze;
- review detected data;
- manually correct data;
- confirm.

Supported ticket-document formats include the currently validated image/PDF formats in the implementation.

Ticket documents are private and tenant-scoped.

---

# 16. Ticket Intelligence

Ticket Intelligence preserves three different layers:

1. raw OCR/provider output;
2. normalized/extracted data;
3. user-confirmed data.

User-confirmed data is the source of truth for downstream business operations.

Extraction may include:

- merchant;
- merchant RFC;
- ticket number;
- folio;
- operation;
- store;
- terminal;
- date/time;
- subtotal;
- tax;
- total;
- currency;
- payment information;
- billing code;
- QR;
- billing URL;
- confidence/warnings.

Missing data must remain missing rather than being invented.

---

# 17. Ticket billing

Ticket billing concerns obtaining a fiscal invoice for a purchase ticket.

It is NOT the same as issuing an invoice to one of the Organization's clients.

The conceptual workflow is:

Ticket
→ extraction
→ user confirmation
→ billing portal/provider identification
→ requirements preparation
→ Fiscal Profile data mapping
→ billing attempt
→ human approval
→ controlled submission
→ provider result
→ CFDI validation
→ CFDI/document storage
→ ticket status update
→ existing Expense enrichment

A billing attempt must not silently create duplicate Expenses.

---

# 18. Billing providers

ORBIT supports a billing-provider architecture.

Providers may be:

- known by ORBIT;
- associated with a specific Organization;
- manual;
- assisted;
- automated;
- unsupported.

Provider resolution may use:

- merchant RFC;
- billing domain;
- normalized merchant identity;
- billing URL;
- explicit user confirmation.

Do not assume fuzzy merchant matching is sufficient to run automation.

---

# 19. Billing portal automation

External billing automation must use the provider-adapter / automation-runner architecture.

Automation must never become a generic unsafe browser proxy.

Billing URLs are validated using the existing SSRF protections.

Automation may prepare and fill supported portals.

Final external submission requires explicit human approval.

---

# 20. Human approval

ORBIT must present a billing summary before final submission.

The user must be able to review relevant information such as:

- provider;
- ticket;
- date;
- amount;
- fiscal receiver;
- CFDI use;
- fiscal email;
- warnings.

A billing attempt cannot perform final submit before valid approval.

Approval is tied to the correct:

- user;
- Organization;
- ticket;
- billing attempt.

---

# 21. Billing result

A billing attempt must not be marked successful only because:

- the submit control was clicked;
- HTTP 200 was received;
- a redirect occurred;
- the page changed.

ORBIT requires sufficient billing evidence.

When CFDI XML is obtained, the existing validation flow may verify data such as:

- UUID;
- issuer RFC;
- receiver RFC;
- amount;
- date.

Mismatch can require manual review.

PDF and XML remain private documents.

---

# 22. Expense integration

A confirmed purchase ticket can create or relate to an Expense.

When ticket billing later obtains a CFDI:

- do not create a second Expense;
- enrich the existing ticket/Expense relationship;
- update invoicing status;
- store CFDI references/documents.

Ticket-derived expenses affect:

`Gastos por mes`

They do not affect:

`Facturación por mes`

---

# 23. Notifications

Notifications are Organization-aware where applicable.

Current notification concepts include events such as:

- ticket processed;
- expense registered;
- invoice incorporated;
- monthly report available;
- fiscal profile incomplete;
- billing prepared;
- billing succeeded;
- billing failed;
- user intervention required.

Notifications support read/unread behavior.

---

# 24. Support

The Support area provides the product shell for help/support experiences.

Do not invent:

- phone numbers;
- emails;
- working hours;
- human support availability;

unless official product data is explicitly provided.

---

# 25. Current external-integration status

Architecture exists for external integrations, but production capability depends on actual configuration.

Do not assume any integration is active solely because an interface/adapter exists.

Potential external systems include:

- OCR provider;
- browser automation worker;
- merchant billing portals;
- SAT validation;
- PAC/timbrado;
- email;
- payment/billing provider.

If required credentials/endpoints are absent, expose an honest manual/assisted/not-configured state.

---

# 26. Important product boundaries

Never conflate:

### Expense
Money spent by the Organization.

### Received invoice / ticket CFDI
Fiscal document obtained for an Organization expense.

### Issued invoice
Invoice the Organization creates for one of its clients.

They belong to different workflows and metrics.

---

# 27. Current production baseline

As of the current production baseline:

- authentication is operational;
- multi-tenancy has passed isolation QA;
- dashboard/reporting is operational;
- fiscal profile is implemented;
- clients are implemented;
- invoice preparation/settings are implemented;
- ticket capture is implemented;
- ticket intelligence architecture is implemented;
- ticket billing architecture and controlled billing flow are implemented;
- security checks and E2E suites are part of the release process.

Neon and Vercel production must not be modified from an agent worktree without explicit user instruction.

---

# 28. Future work

Future tasks may include, depending on product priorities:

- additional verified billing-provider adapters;
- production OCR configuration;
- production automation-worker configuration;
- deeper SAT integrations;
- real PAC/timbrado for invoices issued by ORBIT;
- cancellation/substitution flows;
- commercial plan billing;
- advanced reporting;
- additional automation.

These are not automatically authorized merely because they appear on the roadmap.

Each must be assigned explicitly.