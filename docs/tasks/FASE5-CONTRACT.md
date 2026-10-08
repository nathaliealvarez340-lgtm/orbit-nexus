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

```
# 9. Cliente receptor

```ts
export type InvoiceStudioClient = {
  id: string;
  legalName: string;
  rfc: string;
  fiscalRegime: string;
  postalCode: string;
  cfdiUse?: string;
  defaultPaymentForm?: string;
  email?: string;
  personType?: string;
  foreignTaxId?: string;
  country?: string;
};

---

# 10. Defaults de InvoiceSettings

Fase 5 puede extender `InvoiceSettings` de forma aditiva para incluir:

- `currencyDefault`
- `paymentMethodDefault`
- `paymentFormDefault`

Defaults recomendados para nuevas configuraciones:

- moneda: `MXN`
- método: `PUE`

La forma de pago no debe inventarse silenciosamente si la Organization no definió una.

No modificar settings históricos de forma destructiva.

---

# 11. Catálogo reutilizable de conceptos

Claude puede crear un modelo tenant-aware equivalente a:

`SavedInvoiceConcept`

Contrato frontend:

```ts
export type SavedInvoiceConcept = {
  id: string;
  name: string;
  description: string;
  productCode: string;
  unitCode: string;
  defaultQuantity?: string;
  unitPrice?: string;

  taxObject: string;

  vatFactor: "TASA" | "EXENTO";
  vatRate?: string;

  withholdingVatRate?: string;
  withholdingIsrRate?: string;

  active: boolean;
};
```

No representar `EXENTO` como un valor especial dentro de `vatRate`.

Un concepto guardado es una plantilla.

Al agregarlo a una factura se crea un snapshot.

Modificar o desactivar el concepto posteriormente NO modifica facturas existentes.

---

# 12. Catálogos fiscales pequeños

Debe existir una única fuente compartida para catálogos pequeños.

Como mínimo:

- Tipo de comprobante
- Método de pago
- Forma de pago
- Uso CFDI
- Régimen fiscal
- Moneda
- Objeto de impuesto
- Exportación

Contrato:

```ts
export type CatalogOption = {
  code: string;
  label: string;
  active: boolean;
};
```

```ts
export type InvoiceFiscalCatalogs = {
  documentTypes: CatalogOption[];
  paymentMethods: CatalogOption[];
  paymentForms: CatalogOption[];
  cfdiUses: CatalogOption[];
  fiscalRegimes: CatalogOption[];
  currencies: CatalogOption[];
  taxObjects: CatalogOption[];
  exportCodes: CatalogOption[];
};
```

No duplicar los mismos catálogos en React y backend.

---

# 13. Catálogos SAT grandes

Ejemplos:

- producto/servicio;
- unidades.

No enviar miles de opciones durante la carga inicial.

Debe existir infraestructura de búsqueda server-side.

Ruta conceptual:

`GET /api/fiscal-catalogs/[catalog]?q=...&limit=...`

Debe permitir búsqueda por:

- código;
- descripción.

Debe tener:

- autenticación;
- rate limit;
- límites de resultados;
- cancelación/descartado de resultados antiguos desde frontend.

IMPORTANTE:

Un subconjunto curado NO puede presentarse como catálogo SAT completo.

Hasta cargar/verificar una fuente oficial completa:

- una coincidencia conocida puede mostrarse;
- una clave desconocida no debe declararse fiscalmente válida solo por tener formato correcto;
- puede producir warning/revisión pendiente.

La infraestructura debe permitir sustituir posteriormente la fuente sin cambiar el contrato frontend.

---

# 14. Request para crear/guardar draft

Contrato:

```ts
export type CreateInvoiceDraftRequest = {
  clientId: string;

  invoiceDate: string;

  documentType: "I" | "E" | "T";

  currency: string;
  exchangeRate?: string;

  cfdiUse: string;

  paymentMethod?: "PUE" | "PPD";
  paymentForm?: string;

  exportCode: string;

  concepts: InvoiceDraftConcept[];
};
```

No aceptar `organizationId` como autoridad enviada por navegador.

---

# 15. Línea de concepto

```ts
export type InvoiceDraftConcept = {
  savedConceptId?: string;

  description: string;
  productCode: string;
  unitCode: string;

  quantity: string;
  unitPrice: string;

  discount?: string;

  taxObject: string;

  vatFactor: "TASA" | "EXENTO";
  vatRate?: string;

  withholdingVatRate?: string;
  withholdingIsrRate?: string;
};
```

Todos los valores decimales viajan como strings en API.

El servidor los convierte y valida con Decimal.

---

# 16. Totales

Backend es autoridad.

```ts
export type InvoiceTotals = {
  subtotal: string;
  discount: string;

  transferredTaxes: string;
  withheldTaxes: string;

  total: string;

  lines: {
    subtotal: string;
    discount: string;
    transferredTaxes: string;
    withheldTaxes: string;
    total: string;
  }[];
};
```

Conceptualmente:

`base = cantidad × precio - descuento`

`total = subtotal - descuentos + traslados - retenciones`

La implementación usa Decimal.

Frontend puede calcular preview, pero sus cálculos nunca son autoridad persistida.

No usar floating point de JavaScript como fuente fiscal.

---

# 17. Payment Method y Payment Form

Nombres canónicos:

- `paymentMethod`
- `paymentForm`

## paymentMethod

- `PUE`
- `PPD`

## paymentForm

Código SAT correspondiente.

Regla inicial:

- `PPD` requiere `paymentForm = "99"`.
- `PUE` no debe usar `"99"`.

Estas reglas deben vivir en backend.

Frontend puede ayudar/autoseleccionar, pero backend valida.

---

# 18. InvoiceValidationIssue

Contrato definitivo:

```ts
export type InvoiceValidationIssue = {
  code: string;

  severity: "ERROR" | "WARNING";

  section:
    | "issuer"
    | "receiver"
    | "document"
    | "payment"
    | "concepts"
    | "totals";

  field?: string;

  conceptIndex?: number;

  message: string;
};
```

---

# 19. InvoiceValidationResult

```ts
export type InvoiceValidationResult = {
  valid: boolean;

  canMarkReady: boolean;

  sections: {
    issuer: "OK" | "WARNING" | "ERROR";
    receiver: "OK" | "WARNING" | "ERROR";
    document: "OK" | "WARNING" | "ERROR";
    payment: "OK" | "WARNING" | "ERROR";
    concepts: "OK" | "WARNING" | "ERROR";
    totals: "OK" | "WARNING" | "ERROR";
  };

  issues: InvoiceValidationIssue[];
};
```

Semántica:

- `valid = true` cuando no existen errores fiscales.
- warnings NO invalidan por sí solos.
- `canMarkReady = true` solo cuando:
  - `valid = true`;
  - documentType = `I`;
  - se cumplen reglas soportadas en este sprint.

Codex consume este resultado.

Codex NO recrea las reglas fiscales completas en React.

---

# 20. Respuesta de creación de draft

```ts
export type CreateInvoiceDraftResponse = {
  id: string;
  folio: string | null;

  status: "DRAFT" | "READY";

  totals: InvoiceTotals;

  validation: InvoiceValidationResult;

  updatedAt: string;
};
```

Crear un draft no significa que tenga que salir `READY`.

---

# 21. Actualizar un draft existente

Debe existir:

`PATCH /api/outgoing-invoices/[id]`

Solo permite editar:

- `DRAFT`
- `READY`

Editar una factura `READY` la devuelve a `DRAFT`.

Debe recalcular:

- snapshots relevantes;
- conceptos;
- totales;
- validación.

No crear un nuevo folio por cada guardado.

---

# 22. Concurrencia

La actualización debe proteger contra dos pestañas editando el mismo draft.

Frontend enviará un valor equivalente a:

`expectedUpdatedAt`

o mecanismo equivalente acordado por backend.

Si el registro cambió desde que se abrió:

- no sobrescribir silenciosamente;
- devolver conflicto;
- pedir al usuario recargar/revisar.

---

# 23. Marcar como READY

Ruta:

`POST /api/outgoing-invoices/[id]/ready`

Servidor:

1. recupera factura tenant-aware;
2. recalcula validación;
3. comprueba reglas;
4. si existen ERROR devuelve validación;
5. si `canMarkReady = false`, no cambia estado;
6. si todo es válido, cambia:
   `DRAFT -> READY`.

Nunca:

`READY -> ISSUED`

en este sprint.

---

# 24. Validar sin guardar

Ruta:

`POST /api/outgoing-invoices/validate`

Uso:

- validación previa;
- panel en vivo;
- preview;
- feedback del formulario.

No persiste una factura.

Debe aplicar:

- auth;
- tenant context;
- rate limit;
- validación estructural.

---

# 25. Contexto de Invoice Studio

Ruta:

`GET /api/outgoing-invoices/context`

Debe entregar un DTO basado en:

`InvoiceStudioContext`

No devolver filas Prisma completas.

No exponer información privada innecesaria.

---

# 26. Detalle de invoice

Ruta:

`GET /api/outgoing-invoices/[id]`

Debe devolver el borrador tenant-aware con:

- datos del documento;
- receptor snapshot;
- issuer snapshot;
- conceptos ordenados;
- totales;
- validación;
- status;
- updatedAt.

Codex utilizará este endpoint para reabrir un draft.

---

# 27. Catálogo de conceptos

Rutas conceptuales:

`GET /api/invoice-concepts`

`POST /api/invoice-concepts`

`PATCH /api/invoice-concepts/[id]`

`DELETE /api/invoice-concepts/[id]`

DELETE significa desactivar:

`active = false`

No eliminación física si puede comprometer trazabilidad.

Siempre tenant-aware.

---

# 28. Idempotencia

Crear un draft puede aceptar:

`Idempotency-Key`

si Claude determina que encaja con la arquitectura existente.

Nunca permitir que un reintento accidental cree múltiples borradores idénticos sin control.

Timbrado real tendrá idempotencia más estricta en Fase 5C.

---

# 29. Tamaño máximo del payload

El límite global existente NO debe ampliarse indiscriminadamente.

Para rutas específicas de Invoice Studio que acepten múltiples conceptos puede utilizarse un límite máximo dedicado de:

`256 KiB`

Mantener el resto de endpoints con sus límites actuales.

No modificar globalmente seguridad de uploads.

---

# 30. Vista previa

Codex tiene ownership de la experiencia visual de preview/review relacionada con Invoice Studio.

Claude puede proporcionar DTO/API necesarios.

Claude NO rediseña esas páginas.

Vista previa debe indicar:

`Documento aún no timbrado`

No mostrar:

- UUID falso;
- sello falso;
- estado ISSUED falso.

---

# 31. Revisión final

La revisión muestra:

- emisor;
- receptor;
- tipo;
- Uso CFDI;
- método;
- forma de pago;
- conceptos;
- descuentos;
- impuestos;
- retenciones;
- total;
- validación.

En Fase 5A/5B la acción final NO llama un PAC.

Puede mostrar:

`Timbrado pendiente de configuración`

Fase 5C implementará la operación real.

---

# 32. Seguridad

Toda ruta privada debe mantener:

- Better Auth;
- Membership;
- Organization;
- plan gating;
- server-side authorization;
- same-origin cuando aplique;
- rate limiting;
- tenant-aware lookup.

Nunca confiar en:

- organizationId enviado por browser;
- totals enviados por browser;
- RFC libre sin validar contra Client;
- estado solicitado por browser.

---

# 33. Auditoría

Eventos relevantes pueden incluir:

- `INVOICE_DRAFT_CREATED`
- `INVOICE_DRAFT_UPDATED`
- `INVOICE_MARKED_READY`
- `INVOICE_CONCEPT_CREATED`
- `INVOICE_CONCEPT_UPDATED`
- `INVOICE_CONCEPT_DEACTIVATED`

No guardar datos fiscales completos o secretos innecesariamente en ActivityLog.

---

# 34. Producción

Prohibido durante este sprint:

- Neon;
- migraciones producción;
- Vercel deploy;
- SAT producción;
- PAC producción;
- secretos producción.

Claude usa PostgreSQL local de su worktree.

Codex usa PostgreSQL local de su worktree para UI/E2E cuando sea necesario.

---

# 35. Fuera de alcance

No implementar todavía:

- PAC real;
- timbrado;
- cancelación;
- sustitución;
- Complemento de Pago;
- Nómina;
- Stripe;
- SAT consulta real;
- comercio exterior;
- Carta Porte;
- CFDI relacionados completos.

Si una regla requiere uno de estos módulos, devolver warning/error de "no soportado en este sprint".

---

# 36. Orden de integración

1. Claude implementa Fase 5A backend.
2. Claude ejecuta pruebas y entrega reporte.
3. Se revisa diff.
4. Claude se integra primero en `main`.
5. Codex actualiza su worktree desde el nuevo `main`.
6. Codex conecta Invoice Studio al backend definitivo.
7. Codex ejecuta sus pruebas.
8. Codex se integra.
9. Se ejecuta regresión completa sobre `main`.

---

# 37. Regla de cambio de contrato

Si Claude o Codex consideran necesario cambiar:

- nombre de campo;
- tipo;
- endpoint;
- estado;
- semántica;
- ownership;

deben detenerse y reportarlo.

No modificar silenciosamente este contrato.
