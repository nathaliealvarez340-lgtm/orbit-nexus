# ORBIT NEXUS - FASE 5 CONTRATO COMPARTIDO

Este documento define el contrato obligatorio entre:

- Claude: Fase 5A, foundation fiscal y backend.
- Codex: Fase 5B, Invoice Studio y frontend.

Ambos agentes deben trabajar contra estas definiciones.

Ningún agente puede cambiar silenciosamente nombres, rutas, estados o semántica compartida.

---

# 1. Objetivo del sprint

Construir la base de emisión profesional de CFDI de ORBIT NEXUS.

Este primer sprint incluye:

## Claude

- catálogos fiscales;
- reglas fiscales;
- catálogo reutilizable de conceptos;
- ampliación del dominio de borradores;
- actualización de borradores existentes;
- cálculos fiscales server-side;
- validación server-side;
- APIs requeridas por Invoice Studio;
- cambios Prisma necesarios.

## Codex

- Invoice Studio;
- selección de emisor/receptor;
- datos del comprobante;
- datos de pago;
- editor de conceptos;
- catálogos buscables;
- impuestos y totales;
- panel de validación;
- vista previa;
- guardado y edición de borradores;
- revisión final;
- responsive y accesibilidad.

Este sprint NO incluye PAC real.

Ningún flujo puede simular un CFDI timbrado.

---

# 2. Dominio existente que se reutiliza

Se mantiene la arquitectura existente:

- `StampedInvoice`
- `StampedInvoiceConcept`
- `FiscalProfile`
- `Client`
- `InvoiceSettings`
- outgoing invoice service
- invoice drafts
- plan gating
- tenant resolution
- ActivityLog

No crear un segundo dominio de facturas emitidas.

---

# 3. Ownership

## Claude

Claude tiene ownership de:

- Prisma;
- migraciones;
- servicios backend;
- reglas fiscales;
- catálogos;
- APIs;
- cálculos;
- tipos compartidos;
- tests backend.

## Codex

Codex tiene ownership de:

- `/dashboard/invoices/new/**`
- `OutgoingInvoiceForm`
- componentes de Invoice Studio;
- UI de preview/review autorizada;
- estilos específicos;
- responsive;
- accesibilidad;
- tests frontend.

Codex NO modifica Prisma, servicios backend ni route handlers.

Claude NO rediseña Invoice Studio.

---

# 4. Tipos compartidos

Claude debe crear:

`src/types/invoice-studio.ts`

Este archivo NO será `server-only`.

Será la fuente compartida de tipos consumidos por backend y frontend.

Como mínimo contendrá:

- `InvoiceStudioContext`
- `InvoiceStudioClient`
- `SavedInvoiceConcept`
- `CatalogOption`
- `InvoiceFiscalCatalogs`
- `InvoiceDraftConcept`
- `CreateInvoiceDraftRequest`
- `InvoiceTotals`
- `InvoiceValidationIssue`
- `InvoiceValidationResult`

Codex debe importar estos tipos.

No crear copias locales incompatibles.

---

# 5. Tipo de comprobante en este sprint

El contrato reconoce:

- `I` - Ingreso
- `E` - Egreso
- `T` - Traslado

Sin embargo, durante Fase 5A/5B:

## Ingreso

`I` es el único tipo autorizado para llegar a:

`READY`

## Egreso y Traslado

`E` y `T` pueden quedar preparados arquitectónicamente, pero NO deben declararse fiscalmente completos en este sprint.

La UI puede mostrarlos como no disponibles/próximos si el backend todavía no implementa sus reglas completas.

No implementar:

- Nómina;
- Complemento de Pago.

---

# 6. Estados

Se reutiliza `InvoiceStatus`.

Durante Fase 5:

- `DRAFT` = borrador editable.
- `READY` = borrador de tipo Ingreso que pasó validación fiscal server-side.
- `ISSUED` = exclusivamente CFDI realmente timbrado en una fase posterior.
- `CANCELLED` = reservado para flujo fiscal posterior.
- `ERROR` = error persistente cuando corresponda.

Guardar un borrador NO lo convierte automáticamente en `READY`.

Editar una factura `READY` debe regresarla a `DRAFT` hasta volver a validar.

Nunca generar:

- UUID falso;
- XML falso;
- PAC success falso.

---

# 7. Guardar borradores con errores

ORBIT debe permitir guardar un borrador aunque tenga errores fiscales.

Requisitos:

- el payload debe ser estructuralmente válido;
- el usuario debe estar autorizado;
- el tenant debe ser válido;
- no debe contener datos peligrosos o fuera de límites.

El borrador se conserva como:

`DRAFT`

junto con su estado de validación cuando corresponda.

Los errores fiscales bloquean `READY`, no necesariamente el guardado.

---

# 8. InvoiceStudioContext

Contrato conceptual:

```ts
export type InvoiceStudioContext = {
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
    paymentMethodDefault?: "PUE" | "PPD";
    paymentFormDefault?: string;
    template?: string;
    color?: string;
    logoAvailable: boolean;
  };

  clients: InvoiceStudioClient[];

  savedConcepts: SavedInvoiceConcept[];

  catalogs: InvoiceFiscalCatalogs;
};
