# ORBIT NEXUS — Arquitectura

Este documento describe la arquitectura técnica vigente de ORBIT NEXUS.

Es una fuente de verdad compartida para agentes y desarrolladores.

Para comportamiento funcional del producto:

`docs/PRODUCT.md`

Para desarrollo paralelo:

`docs/WORKTREE-RULES.md`

---

# 1. Principios arquitectónicos

ORBIT NEXUS es una plataforma SaaS multi-tenant orientada a operaciones financieras y fiscales.

Principios obligatorios:

- aislamiento estricto por Organization;
- autorización server-side;
- documentos privados;
- trazabilidad;
- aprobación humana en operaciones fiscales sensibles;
- idempotencia;
- separación entre gastos y facturación emitida;
- automatización externa detrás de adapters;
- integraciones externas explícitas, nunca simuladas;
- cambios de base de datos preferentemente aditivos y no destructivos.

---

# 2. Aplicación

## `src/app`

Contiene:

- páginas;
- layouts;
- route handlers;
- rutas públicas;
- rutas privadas.

La landing pública existe de manera independiente del producto autenticado y no debe modificarse salvo requerimiento explícito.

Las rutas privadas deben comprobar autenticación y autorización antes de acceder a recursos empresariales.

---

# 3. Autenticación

## Better Auth

La autenticación existente utiliza Better Auth.

Responsabilidades:

- registro;
- login;
- sesiones persistentes;
- logout;
- revocación;
- cambio de contraseña;
- cookies seguras;
- protección de rutas.

Las sesiones se almacenan en base de datos.

Las cookies de sesión utilizan las protecciones definidas por la configuración existente, incluyendo atributos seguros apropiados para producción.

No existe autorización únicamente por frontend.

---

# 4. Multi-tenancy

## Organization

`Organization` es la unidad principal de aislamiento empresarial.

Un usuario puede pertenecer a una o más Organizations mediante Membership.

Toda entidad empresarial debe estar asociada directa o indirectamente con una Organization autorizada.

Ejemplos:

- Ticket
- Expense
- Client
- FiscalProfile
- Invoice
- StampedInvoice
- MonthlyExpenseReport
- Notification
- Document
- BillingProvider custom
- BillingAttempt

La Organization activa se resuelve mediante la sesión y membresías autorizadas.

Una cookie de workspace puede funcionar como preferencia, pero nunca como prueba suficiente de autorización.

Nunca se debe confiar en un `organizationId` arbitrario recibido del cliente.

---

# 5. Tenant resolution

## `src/lib/tenant.ts`

Responsabilidades:

- resolver usuario autenticado;
- resolver Membership;
- determinar Organization activa;
- comprobar acceso;
- proporcionar contexto tenant-aware a servicios privados.

Organization A nunca debe poder leer o modificar recursos de Organization B.

---

# 6. Autorización

La autorización se aplica en servidor.

Las operaciones privadas deben comprobar:

- usuario;
- sesión;
- Membership;
- Organization;
- ownership del recurso;
- estado del recurso cuando corresponda.

Cambiar un ID en una URL o request nunca debe otorgar acceso a otro tenant.

---

# 7. Documentos privados

Los documentos fiscales y operativos se almacenan como recursos privados.

Ejemplos:

- tickets;
- Constancia de Situación Fiscal;
- CFDI XML;
- CFDI PDF;
- documentos de diagnóstico permitidos.

La entidad/document layer conserva según corresponda:

- Organization;
- MIME validado;
- hash SHA-256;
- contenido/storage reference;
- metadata segura.

La UI no recibe bytes privados salvo mediante endpoints autorizados.

No utilizar paths enviados por el cliente para descargar documentos.

---

# 8. Upload validation

La validación de uploads ocurre server-side.

Debe comprobar:

- MIME;
- tamaño;
- autorización;
- Organization;
- formato permitido.

La extensión del filename no es evidencia suficiente del tipo de archivo.

---

# 9. Datos financieros

Los valores monetarios persistidos utilizan Decimal o las utilidades monetarias existentes.

No utilizar floating point de JavaScript como fuente de verdad fiscal/financiera.

Los conceptos financieros principales son distintos.

## Expense

Representa gasto de la Organization.

Normalmente proviene de un ticket confirmado.

## CFDI recibido

Documento fiscal obtenido para un gasto/ticket.

Enriquece el gasto existente.

No crea automáticamente un segundo Expense.

## Factura emitida

Documento/facturación de la Organization hacia uno de sus clientes.

Pertenece al flujo de ventas/facturación emitida.

---

# 10. Métricas

Las métricas permanecen separadas.

## Gastos por mes

Fuente:

Ticket confirmado
→ Expense
→ agregación mensual

No incluye facturas emitidas a clientes.

## Facturación por mes

Fuente:

facturación emitida válida
→ fecha
→ total
→ agregación mensual

No incluye:

- Expenses;
- tickets;
- CFDI recibidos;
- drafts;
- facturas fallidas.

Las monedas distintas no deben sumarse incorrectamente como si fueran la misma moneda.

---

# 11. Tickets

Ticket es una entidad central.

Flujo conceptual actual:

UPLOADED
→ ANALYZING
→ NEEDS_REVIEW
→ CONFIRMED
→ READY_FOR_BILLING

El dominio puede incluir estados adicionales relacionados con facturación.

Estados de error pueden incluir equivalentes a:

- OCR_FAILED
- INVALID_FILE
- NEEDS_MANUAL_INPUT

`READY_FOR_BILLING` no significa que exista una factura.

---

# 12. Ticket Intelligence

Ticket Intelligence conserva tres capas diferentes.

## Raw

Salida original del OCR/provider.

Debe preservarse para:

- auditoría;
- debugging;
- mejora del extractor.

## Extracted

Datos normalizados por ORBIT.

Puede incluir:

- merchantName;
- merchantRfc;
- ticketNumber;
- folio;
- transactionNumber;
- storeNumber;
- terminalNumber;
- date;
- time;
- subtotal;
- tax;
- total;
- currency;
- paymentMethod;
- paymentReference;
- billingCode;
- billingUrl;
- qrPayload;
- confidence;
- warnings.

## Confirmed

Datos revisados/corregidos por el usuario.

Esta capa es la fuente de verdad para operaciones posteriores.

Corregir un ticket nunca debe sobrescribir el Raw original.

---

# 13. OCR

La arquitectura OCR se encuentra detrás de adapters/services.

Un proveedor OCR real debe ejecutarse server-side.

Las API keys nunca deben llegar al navegador.

Si no existe proveedor configurado:

- no inventar resultados;
- permitir revisión/manual input;
- expresar claramente que la integración no está configurada.

Los reintentos deben ser idempotentes y no crear múltiples Expenses.

---

# 14. Expense confirmation

Solo la confirmación explícita del usuario puede convertir los datos revisados del ticket en el gasto correspondiente.

La creación debe ser transaccional e idempotente.

Debe evitar:

- doble submit;
- doble Expense;
- races entre pestañas;
- reintentos duplicados.

El Expense utiliza los datos confirmados, no el OCR bruto.

---

# 15. Billing Providers

ORBIT dispone de arquitectura de proveedores de facturación.

Un provider representa un portal o mecanismo mediante el cual puede obtenerse la factura de un ticket.

Puede existir:

- provider conocido/global;
- provider asociado a una Organization;
- URL personalizada;
- provider manual;
- assisted;
- automated;
- unsupported.

Una Organization no puede modificar directamente providers globales.

---

# 16. Resolución de provider

La resolución puede utilizar:

1. merchant RFC;
2. dominio del billing URL;
3. identidad normalizada del comercio;
4. QR/URL;
5. confirmación manual del usuario.

Un fuzzy match no debe ser suficiente por sí solo para ejecutar automatización externa.

Cuando la confianza sea insuficiente, se requiere confirmación.

---

# 17. Provider adapters

La lógica específica de portales vive detrás de adapters.

No debe existir lógica específica de un comercio incrustada directamente en componentes UI.

El adapter puede definir operaciones equivalentes a:

- canHandle;
- inspectRequirements;
- prepare;
- fill;
- submit;
- collectResult.

Cada portal puede solicitar campos distintos.

---

# 18. Billing Context

La automatización trabaja con un contexto controlado que puede incluir:

- Ticket confirmado;
- BillingProvider;
- billing URL;
- FiscalProfile;
- Organization;
- user;
- BillingAttempt.

Los datos se obtienen server-side.

No se deben incluir secretos que el proceso no necesite.

---

# 19. Field mapping

El sistema puede mapear requisitos del portal desde diferentes fuentes.

Ejemplos:

RFC receptor
← FiscalProfile

Razón social
← FiscalProfile

Uso CFDI
← FiscalProfile

Número de ticket
← Ticket confirmado

Total
← Ticket confirmado

Código de facturación
← Ticket confirmado

La trazabilidad del origen del dato debe mantenerse cuando sea relevante.

---

# 20. Billing Automation Runner

La lógica de negocio no depende directamente de una implementación concreta de browser automation.

Existe/se utiliza una abstracción de runner para aislar:

- navegación;
- portal automation;
- pruebas;
- infraestructura externa.

Playwright u otra herramienta puede utilizarse en implementaciones concretas, pero no debe convertirse en el contrato de dominio.

Producción puede requerir un worker/browser runner externo.

Si no está configurado:

- no simular éxito;
- usar estado explícito;
- ofrecer fallback manual/asistido.

---

# 21. Seguridad de URLs y SSRF

Las URLs proporcionadas por tickets o usuarios son datos no confiables.

Antes de cualquier navegación deben aplicarse las protecciones SSRF existentes.

Bloquear:

- localhost;
- loopback;
- rangos privados;
- link-local;
- metadata endpoints;
- file:;
- javascript:;
- data:.

Validar:

- protocolo;
- hostname;
- resolución;
- redirects;
- destino después de redirects;
- timeouts;
- límites razonables de navegación.

ORBIT nunca debe convertirse en un proxy genérico hacia infraestructura arbitraria.

---

# 22. Fiscal Profile autofill

La preparación de facturación utiliza el FiscalProfile de la Organization activa.

Puede aportar:

- RFC;
- razón social;
- régimen fiscal;
- código postal fiscal;
- Uso CFDI;
- correo fiscal;
- información relacionada disponible.

No pedir nuevamente información que ya está almacenada correctamente.

Si el FiscalProfile está incompleto:

- detener preparación;
- indicar qué falta;
- permitir completar el perfil.

---

# 23. Human approval

El submit final hacia un portal externo requiere aprobación humana explícita.

Antes del envío, ORBIT presenta un resumen de la operación.

La aprobación se vincula server-side con:

- user;
- Organization;
- Ticket;
- BillingAttempt.

La autorización debe ser de corta duración y no reutilizable para otra operación.

No existe auto-submit previo a aprobación.

---

# 24. BillingAttempt

BillingAttempt representa una ejecución controlada del proceso de facturación de un ticket.

Puede contener conceptos equivalentes a:

- Organization;
- Ticket;
- Provider;
- status;
- adapter;
- billing URL;
- startedAt;
- completedAt;
- approvedBy;
- approvedAt;
- retry count;
- error code/category;
- idempotency data.

Los intentos no almacenan secretos innecesarios.

---

# 25. Billing lifecycle

El lifecycle puede contemplar estados equivalentes a:

PREPARING
→ AWAITING_APPROVAL
→ SUBMITTING
→ WAITING_PROVIDER
→ SUCCEEDED

o:

FAILED
NEEDS_MANUAL_ACTION

Presionar el botón del portal no significa éxito fiscal.

---

# 26. Idempotencia y concurrencia

La facturación protege contra:

- doble click;
- doble approval;
- doble submit;
- pestañas paralelas;
- retries simultáneos.

Un ticket ya facturado no debe volver a enviarse accidentalmente.

Las operaciones ambiguas no deben reintentarse automáticamente cuando existe riesgo de duplicación.

---

# 27. Evidencia de facturación

ORBIT no marca un ticket como facturado únicamente porque:

- el botón fue presionado;
- HTTP 200 ocurrió;
- hubo redirect;
- el DOM cambió.

Se necesita evidencia suficiente del resultado.

Puede incluir:

- UUID;
- XML;
- PDF;
- confirmación verificable del provider;
- confirmation page estructurada.

---

# 28. CFDI validation

Cuando se obtiene XML, el flujo existente valida información relevante.

Puede incluir:

- formato XML;
- namespaces esperados;
- UUID;
- RFC emisor;
- RFC receptor;
- total;
- fecha.

Se compara con:

- ticket confirmado;
- FiscalProfile esperado.

Mismatch puede producir revisión manual.

Un XML incorporado no certifica por sí solo vigencia SAT si no existe consulta SAT real.

---

# 29. Billing result and Expense

Cuando la facturación de ticket finaliza correctamente:

- Ticket actualiza estado;
- CFDI/documentos se relacionan;
- UUID puede registrarse;
- Expense existente se conserva;
- no se genera gasto duplicado;
- métricas de tickets pueden actualizarse;
- reportes pueden mostrar información fiscal obtenida.

El resultado de ticket billing afecta gastos.

No incrementa `Facturación por mes`.

---

# 30. Manual fallback

La automatización externa nunca debe bloquear completamente al usuario.

Si un portal:

- cambia;
- no es compatible;
- requiere credenciales;
- no tiene runner configurado;
- falla de forma ambigua;

ORBIT puede pasar a flujo manual/asistido.

El usuario puede:

- abrir el portal oficial;
- consultar los datos preparados por ORBIT;
- completar el proceso manualmente;
- incorporar después XML/PDF.

---

# 31. Notifications

Los eventos relevantes pueden integrarse con Notification.

Ejemplos:

- factura preparada;
- factura obtenida;
- facturación fallida;
- intervención requerida.

Las notificaciones relacionadas con operaciones empresariales son tenant-aware.

---

# 32. Audit

ActivityLog y los eventos de BillingAttempt proporcionan trazabilidad.

Eventos pueden incluir conceptos como:

- ticket upload;
- ticket analysis;
- expense confirmation;
- provider match;
- URL validation;
- form prepared;
- user approved;
- submitted;
- result received;
- CFDI validated;
- completed;
- failed.

No guardar secretos o perfiles fiscales completos innecesariamente.

---

# 33. Prisma

Prisma representa el modelo persistente.

Las migraciones deben mantener una única historia coherente.

Cambios:

- preferentemente aditivos;
- revisados antes de producción;
- probados primero en PostgreSQL local aislado.

Nunca permitir que dos agentes creen migraciones concurrentes sobre schemas divergentes.

Solo un agente puede poseer Prisma durante un trabajo paralelo.

---

# 34. Local QA

Los scripts existentes soportan desarrollo y E2E aislado mediante PostgreSQL local/embebido según la configuración actual.

Antes de producción se utilizan las suites existentes para:

- auth;
- tickets;
- Fase 3;
- Fase 4;
- billing;
- seguridad;
- responsive/accesibilidad cuando corresponde.

---

# 35. Security checks

El repositorio dispone de:

`npm run security:check`

El control revisa exposición accidental de secretos y archivos sensibles.

También se utilizan:

- npm audit;
- lint;
- typecheck;
- tests;
- E2E;
- build;
- git diff --check.

GitHub dispone de protecciones adicionales configuradas para secret scanning/push protection y análisis de dependencias según disponibilidad.

---

# 36. Producción

Producción utiliza:

- Vercel para la aplicación;
- Neon PostgreSQL para persistencia.

Los agentes de worktree no modifican producción.

No deben:

- ejecutar migraciones contra Neon;
- desplegar;
- cambiar variables de entorno;
- modificar DNS;
- rotar secretos.

Los cambios de producción se realizan únicamente desde `main`, después de revisión y autorización explícita.

---

# 37. Integraciones externas

La existencia de una interface no significa que la integración esté activa.

Integraciones posibles incluyen:

- OCR;
- browser automation worker;
- merchant billing portals;
- SAT;
- PAC/timbrado;
- email;
- payment provider.

Si configuración/credenciales no existen:

usar estados explícitos como:

- not configured;
- manual;
- assisted;
- unsupported.

Nunca simular éxito.

---

# 38. Invariantes críticas

Estas reglas no deben romperse.

1. Tenant isolation siempre server-side.
2. Un ticket confirmado no crea Expenses duplicados.
3. Raw OCR nunca se pierde al corregir datos.
4. Datos confirmados son la fuente de verdad.
5. Facturación externa exige aprobación humana.
6. HTTP 200 no significa factura obtenida.
7. Received CFDI no es issued invoice.
8. Gastos y facturación emitida permanecen separados.
9. Documentos fiscales permanecen privados.
10. Los agentes no modifican producción desde worktrees.