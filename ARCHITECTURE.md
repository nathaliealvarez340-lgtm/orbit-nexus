# ORBIT NEXUS Architecture

## Boundaries

- `src/app`: route composition and layouts.
- `src/components`: reusable presentation and interactive controls.
- `src/features`: reserved for domain workflows as integrations become real.
- `src/services/ocr`: provider-neutral OCR contract and adapters.
- `src/services/invoice-provider`: provider-neutral PAC contract and adapters.
- `src/data/mock`: the only source of MVP sample data.
- `prisma`: PostgreSQL domain model prepared for Neon.

## Routes

- `/`: premium marketing experience.
- `/login`, `/register`: validated authentication entry points.
- `/dashboard`: financial and fiscal overview.
- `/dashboard/tickets`, `/dashboard/tickets/new`: ticket workflow and upload.
- `/dashboard/companies`: compatible company rules.
- `/dashboard/fiscal-profile`: confirmed fiscal identity.
- `/dashboard/fiscal-documents`: assisted fiscal document extraction.
- `/dashboard/stamping`: manual CFDI preparation and PAC-ready preview.

## Integration strategy

OCR and PAC implementations depend on small interfaces. Real providers can be
added as adapters without changing product screens. Uploaded files must later
move through signed uploads, MIME validation, malware scanning, encryption,
retention rules, and auditable confirmation before persistence.

