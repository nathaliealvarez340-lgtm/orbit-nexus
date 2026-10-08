# ORBIT NEXUS — CLAUDE · FASE 5A

## Objetivo

Construir la base fiscal y backend de la Fase 5 de ORBIT NEXUS.

Esta fase prepara el sistema para un Invoice Studio profesional y, posteriormente, para timbrado real mediante PAC.

En este sprint NO se implementa el timbrado real.

Antes de trabajar, leer obligatoriamente:

- `AGENTS.md`
- `CLAUDE.md`
- `docs/ARCHITECTURE.md`
- `docs/PRODUCT.md`
- `docs/WORKTREE-RULES.md`
- `docs/tasks/FASE5-CONTRACT.md`

---

# 1. Rama asignada

Claude trabaja exclusivamente en:

`claude/fase5-fiscal-foundation`

Antes de modificar archivos ejecutar:

`git branch --show-current`

`git status --short`

Si la rama no es la correcta, detenerse.

---

# 2. Responsabilidad principal

Claude es responsable del backend y dominio fiscal de Fase 5A.

Debe extender la arquitectura existente.

NO debe construir un sistema de facturación paralelo.

Debe reutilizar:

- `StampedInvoice`
- `StampedInvoiceConcept`
- `FiscalProfile`
- `Client`
- invoice settings
- outgoing invoice service
- invoice drafts
- plan gating existente

---

# 3. Alcance

Implementar o mejorar:

## Catálogos fiscales

Crear una fuente estructurada y reutilizable para catálogos necesarios por Invoice Studio.

Como mínimo considerar:

- Tipo de comprobante
- Método de pago
- Forma de pago
- Uso CFDI
- Régimen fiscal
- Moneda
- Objeto de impuesto
- Exportación
- unidades
- productos/servicios cuando corresponda

No hardcodear catálogos de forma duplicada entre backend y frontend.

Para catálogos grandes, implementar búsqueda eficiente en lugar de enviar todos los registros al navegador.

---

## Reglas fiscales

Crear una capa central de validación fiscal para borradores.

Debe validar, cuando corresponda:

- perfil fiscal del emisor;
- RFC;
- régimen fiscal;
- código postal fiscal;
- datos del receptor;
- Uso CFDI;
- método de pago;
- forma de pago;
- tipo de comprobante;
- moneda;
- conceptos;
- claves SAT;
- objeto de impuesto;
- impuestos;
- importes;
- combinaciones fiscales inválidas.

El backend es la autoridad.

El frontend podrá mostrar sugerencias, pero no sustituye estas validaciones.

---

# 4. Método y forma de pago

Mantener estos nombres de contrato:

- `paymentMethod`
- `paymentForm`

Método de pago:

- `PUE`
- `PPD`

Forma de pago:

- códigos del catálogo SAT correspondiente.

Implementar validación server-side de combinaciones.

Por ejemplo, cuando una regla fiscal determine que una combinación no es válida, devolver un error estructurado mediante el contrato definido en:

`docs/tasks/FASE5-CONTRACT.md`

No depender únicamente de validaciones del frontend.

---

# 5. Uso CFDI

Mantener el campo:

`cfdiUse`

Debe utilizar un código estructurado.

No aceptar texto libre como valor fiscal persistido.

La validación debe considerar compatibilidad con los datos fiscales relevantes del receptor.

---

# 6. Catálogo reutilizable de conceptos

Crear o extender el dominio necesario para guardar productos/servicios frecuentes de una Organization.

Un concepto guardado puede incluir:

- nombre;
- descripción;
- clave producto/servicio;
- clave unidad;
- cantidad predeterminada opcional;
- precio habitual opcional;
- objeto de impuesto;
- tasa IVA;
- retención IVA opcional;
- retención ISR opcional;
- estado activo/inactivo.

Debe ser multi-tenant.

Una Organization nunca puede leer conceptos de otra.

Seleccionar un concepto guardado en una factura debe crear un snapshot dentro de la factura.

Cambiar posteriormente el concepto del catálogo NO puede modificar facturas históricas.

---

# 7. Prisma

Claude tiene ownership exclusivo de Prisma durante este sprint.

Puede modificar:

- `prisma/schema.prisma`
- crear migración necesaria

Solo si realmente hace falta.

Preferir cambios aditivos y no destructivos.

No aplicar migraciones contra Neon.

No usar producción.

Probar exclusivamente con la infraestructura PostgreSQL local del worktree.

Si no es necesario cambiar Prisma, no hacerlo.

---

# 8. Draft de factura

Extender el flujo actual de borradores.

Mantener preferentemente:

`POST /api/outgoing-invoices`

El request debe seguir el contrato definido en:

`docs/tasks/FASE5-CONTRACT.md`

Soportar, cuando corresponda:

- clientId
- invoiceDate
- documentType
- currency
- exchangeRate
- cfdiUse
- paymentMethod
- paymentForm
- exportCode
- concepts

Los conceptos pueden incluir:

- savedConceptId
- description
- productCode
- unitCode
- quantity
- unitPrice
- discount
- taxObject
- vatRate
- withholdingVatRate
- withholdingIsrRate

---

# 9. Totales

Los cálculos fiscales persistidos son responsabilidad del backend.

Utilizar Decimal y las utilidades monetarias existentes.

Calcular correctamente:

- subtotal;
- descuentos;
- impuestos trasladados;
- impuestos retenidos;
- total.

No confiar en cálculos enviados por el navegador.

El frontend solo puede hacer cálculos de preview.

---

# 10. Validación estructurada

Implementar un resultado de validación compatible con:

`InvoiceValidationResult`

y:

`InvoiceValidationIssue`

definidos en `FASE5-CONTRACT.md`.

Ejemplo de issue:

- code
- severity
- field
- conceptIndex
- message

Los mensajes deben ser comprensibles para el usuario.

No devolver únicamente códigos técnicos cuando pueda ofrecerse una explicación clara.

---

# 11. Estados

Durante esta fase:

- `DRAFT` = borrador editable
- `READY` = borrador fiscalmente completo/listo para revisión
- `ISSUED` = reservado para CFDI realmente timbrado posteriormente

NO marcar ninguna factura como `ISSUED`.

NO generar UUID falso.

NO generar respuesta PAC simulada.

---

# 12. Seguridad

Preservar:

- autenticación Better Auth;
- tenant isolation;
- authorization server-side;
- plan gating;
- rate limiting;
- protección CSRF/origin cuando corresponda;
- documentos privados;
- auditoría.

Nunca confiar en `organizationId` enviado libremente por cliente.

Todos los conceptos, clientes y facturas deben resolverse dentro de la Organization autorizada.

---

# 13. Archivos que Claude puede modificar

Claude puede modificar, cuando sean necesarios para este alcance:

- `src/services/outgoing-invoices.ts`
- backend relacionado con conceptos/fiscal catalogs
- validaciones fiscales
- API route handlers de outgoing invoices
- API para catálogo de conceptos
- API para búsqueda de catálogos
- tipos backend/shared necesarios
- tests relacionados
- `prisma/schema.prisma`
- nueva migración Prisma si realmente se requiere

Puede crear nuevos archivos backend dentro de:

- `src/services/`
- `src/lib/`
- `src/types/`
- `src/app/api/`

si encajan con la arquitectura actual.

---

# 14. Read-only para Claude

Claude puede leer pero NO debe rediseñar durante este sprint:

- Invoice Studio visual de Codex
- componentes frontend que Codex esté modificando
- diseño global del dashboard
- sidebar
- landing pública

En particular tratar como read-only salvo necesidad crítica reportada:

- `src/components/forms/outgoing-invoice-form.tsx`
- frontend de `/dashboard/invoices/new`

Si necesita un cambio frontend para soportar el backend:

DETENERSE y reportar el contrato necesario.

No editar silenciosamente archivos propiedad de Codex.

---

# 15. Prohibido

No:

- implementar PAC real todavía;
- llamar SAT producción;
- usar Neon;
- desplegar Vercel;
- modificar producción;
- crear Stripe;
- implementar cancelaciones;
- implementar complemento de pagos;
- implementar nómina;
- modificar Ticket Billing de Fase 4;
- crear otro dominio paralelo de invoices;
- cambiar nombres del contrato sin reportarlo.

---

# 16. Pruebas

Añadir o actualizar pruebas para cubrir:

- tenant isolation;
- conceptos multi-tenant;
- validaciones fiscales;
- combinaciones de pago;
- cálculos Decimal;
- borrador válido;
- borrador inválido;
- idempotencia relevante;
- límites/autorización.

Ejecutar como mínimo:

- `npm run security:check`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- tests E2E relevantes
- `npm run build`
- `git diff --check`
- `git status --short`

Usar únicamente la base PostgreSQL local del worktree.

---

# 17. Git

Claude NO debe ejecutar:

- `git add`
- `git commit`
- `git push`
- `git merge`
- `git rebase`

salvo instrucción explícita posterior.

No cambiar de rama.

No tocar el worktree de Codex.

---

# 18. Entrega

Al terminar, Claude debe reportar:

1. qué implementó;
2. archivos modificados;
3. si cambió Prisma;
4. migración creada si existe;
5. contrato API final;
6. reglas fiscales implementadas;
7. pruebas ejecutadas;
8. resultados;
9. limitaciones;
10. dependencias necesarias para Codex;
11. `git status --short`.

No hacer commit ni push.