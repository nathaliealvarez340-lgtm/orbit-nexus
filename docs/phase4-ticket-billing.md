# Fase 4: tickets y CFDI recibidos

Esta implementación amplía el flujo existente. No conecta PAC, SAT, Stripe ni emisión de facturas a clientes. `Expense` continúa siendo el gasto confirmado en MXN; `Invoice` conserva el CFDI recibido; `StampedInvoice` sigue siendo exclusivamente facturación emitida. No se ejecutan migraciones durante el build.

## Lectura y confirmación

`TicketOcrProvider` usa el endpoint de OCR configurado en servidor. Sin `OCR_API_URL`, devuelve revisión manual; no fabrica texto, confidence ni importes. `OCR_API_TOKEN` autentica al servicio cuando se configura. El contrato admite campos estructurados, `rawText`, confidence general y por campo. `normalize.ts` convierte las variantes del proveedor al contrato de ORBIT, conserva nulls y marca ambigüedades. Cada análisis crea `TicketOcrAttempt`; el resultado original nunca se reemplaza por correcciones. Un lease y su token impiden que un proceso viejo sobrescriba un análisis nuevo.

La lectura de QR en JPG/PNG/WEBP es local mediante sharp/jsQR. El QR de PDF requiere el proveedor OCR; no hay rasterización de PDF local. Decodificar no navega ni ejecuta el contenido. Los candidatos URL se revisan por el usuario. Los gastos se crean solo al confirmar, con Decimal. Tickets en otras monedas conservan la confirmación sin crear un gasto MXN ni convertir moneda. Los CFDI incorporados actualmente son CFDI 4.0 de ingreso en MXN.

## Catálogo y trazabilidad

`Company` es el catálogo global ya existente; se amplía con RFC, dominio, modo y adapter. OXXO, Walmart y Costco continúan **asistidos**, usando las direcciones ya presentes en el proyecto. Ningún comercio real queda declarado automatizado. `OrganizationBillingProvider` guarda asociaciones/favoritos privados; una URL del usuario no cambia el catálogo global. La sugerencia usa RFC exacto, dominio exacto y nombre normalizado exacto, por ese orden; un resultado ambiguo queda sin selección automática. El usuario confirma siempre el portal.

`BillingAttempt.context` guarda una copia privada de los campos confirmados, su origen y receptor esperado. `BillingAttemptEvent` contiene solo etapa, fecha y código de error. No contiene OCR, credenciales ni datos fiscales completos. El historial privado no devuelve hash de aprobación, idempotency key ni sesión del worker.

## Runner y adapters

`BillingPortalAdapter` expone canHandle, inspectRequirements, prepare, fill, submit y collectResult. `GenericManualAdapter` mantiene el ticket pendiente. `ManagedPortalAdapter` delega en `BillingAutomationRunner`.

`LocalBillingAutomationRunner` es una implementación de referencia para desarrollo/pruebas con Playwright. Recibe un Browser y manifests **de servidor** revisados; no acepta selectores desde el navegador del usuario ni OCR. La prueba `scripts/billing-e2e.mjs` ejecuta formulario, llenado, submit y descargas reales en un portal fixture servido completamente en memoria. No contacta comercios reales. Este runner no se carga en rutas Next ni pretende persistir un navegador dentro de Vercel. Mantiene sesiones en memoria, aisladas por contexto, durante diez minutos y las cierra; no genera screenshots fiscales, perfiles persistentes ni archivos descargados.

Para producción, `HttpBillingAutomationRunner` necesita un worker externo de confianza:

| Variable | Formato y función |
| --- | --- |
| `BILLING_AUTOMATION_URL` | Endpoint HTTPS del worker. HTTP loopback solamente para pruebas locales. Sin credenciales en URL. |
| `BILLING_AUTOMATION_TOKEN` | Secreto de autenticación creado/configurado en el worker y en el servidor de ORBIT; nunca NEXT_PUBLIC. |
| `BILLING_AUTOMATION_ADAPTERS` | Lista explícita de IDs revisados, separados por comas. Por sí sola no activa un comercio. |

El catálogo global debe tener la URL oficial exacta, `automationMode=AUTOMATED` y un `adapterKey` realmente instalado/probado. No hay API tenant para cambiar ese catálogo. Una URL personalizada diferente permanece manual.

Contrato HTTP: POST con Bearer de servidor, JSON `{version:1, action, context, sessionId?, networkPolicy:"orbit-public-pinned-v1"}`. Acciones: prepare/fill/submit/collect. Respuestas validadas: `state` PREPARED/SUBMITTED/PENDING/RESULT/MANUAL/FAILED; `sessionId` opaco; `verifiedFields` tras fill; `errorCode` del catálogo; `xmlBase64`, `pdfBase64`, `uuid` opcionales al recopilar. Tiempo máximo por petición 45 s, sin redirects del endpoint y respuesta limitada a 16 MiB. El worker debe verificar Bearer, vincular sesión e idempotencia al contexto inmutable, aplicar límites/retención y prohibir logging de payloads. Nunca debe reenviar al recopilar un resultado.

El worker externo todavía debe provisionarse; esta tarea no lo despliega. Antes de habilitar un adapter real hay que verificar sus selectores, endpoints de preparación/envío, requisitos, descarga, expiración y evidencias de CFDI. CAPTCHA o credenciales del comercio requieren intervención; ORBIT no almacena esos passwords.

## Seguridad de red

`url-security.ts` rechaza esquemas y destinos no públicos, IP literales, credenciales, puertos no estándar y DNS con cualquier dirección privada/especial IPv4/IPv6. Cada conexión utiliza el IP validado mediante lookup fijado: no hace una segunda resolución susceptible a rebinding. `guardedRequest` permite solo hosts y pares método/URL exactos del manifest para cada fase, revalida redirects y limita a cinco. El transporte limita tamaño y tiempo. Antes de aprobación no se permiten endpoints de submit. Se bloquean service workers y WebSockets, y todo el tráfico HTTP del contexto pasa por el transporte protegido.

La protección no se obtiene solamente enviando `networkPolicy`: el worker de producción debe implementar estas mismas restricciones y ejecutarse en una red sin acceso a metadata, redes privadas ni credenciales de infraestructura. No sustituir el transporte fijado por `route.continue`, `page.request` o un fetch libre. No convertir ORBIT en un proxy ni aceptar manifests/allowlists del cliente. La inyección de transporte en el runner local se usa exclusivamente para fixtures controlados.

## Aprobación y resultado

Preparar valida perfil fiscal completo, requisitos y campos llenados; no emite. El resumen muestra los datos exactos. Revisar obtiene una autorización aleatoria de diez minutos, almacenada solo como hash en servidor y ligada a usuario/organización/ticket/intento/contexto. El token del navegador permanece en memoria. Cambiar datos invalida la comparación. Solo «Confirmar y facturar» consume la aprobación mediante transacción y bloqueo del ticket.

Un `activeKey` único impide dos intentos activos y `submittedAt` evita doble submit. El estado SUBMITTING se persiste **antes** de la llamada externa. Un resultado perdido/ambiguo retiene el bloqueo y solo permite consultar o importar XML. Ni un timeout ni un restart autorizan otro envío. Cancelar preparación no cancela un CFDI ni una solicitud ya enviada. El worker también debe conservar idempotencia durante su retención operativa.

El éxito requiere un XML que pase el parser existente (namespace, versión, UUID, RFCs, fecha, importes), comparación exacta Decimal con el gasto, receptor esperado e identidad del emisor cuando se conoce. UUID solo, HTTP 200, click o PDF no marcan éxito. XML/PDF pasan la validación de archivos y se guardan privados por organización. Validar estructura y correspondencia **no equivale a verificar vigencia o firma con SAT**. La incorporación manual sigue disponible.

Se actualizan Ticket, el mismo Expense y el Invoice recibido. No se crea otro gasto ni una venta. Las notificaciones indican preparación, intervención y factura incorporada. Reportes nuevos almacenan el ID estable de cada ticket: sus importes/tickets quedan cerrados y las descargas/contadores añaden los CFDI posteriores. Reportes antiguos sin esos IDs mantienen su evidencia original; no se adivinan vínculos ni se recalculan importes históricos.

## Migraciones y comprobaciones

Migraciones aditivas pendientes de aplicar fuera de esta tarea:

1. `202609300001_ticket_intelligence`: extracción, historial OCR y campos de confirmación.
2. `202610010001_ticket_billing`: asociaciones de proveedores, intentos/eventos y vínculo al CFDI recibido.

Probadas en PostgreSQL local aislado (PGlite); `node scripts/verify-schema.mjs` compara únicamente esa base con Prisma. No se leyó ni alteró Neon. Antes de producción, revisar el historial real con `npx prisma migrate status`, disponer de respaldo y confirmar que coincide con la línea existente; entonces, con autorización separada, usar `npx prisma migrate deploy`. No usar reset, db push ni marcar migraciones aplicadas para ocultar divergencias.

Pruebas: `npm test`; `npm run test:phase4:e2e` (requiere build); regresiones con `npm run test:auth:e2e`, `npm run test:e2e`, `npm run test:phase3:e2e`. Los scripts inyectan DATABASE_URL local solamente en procesos hijos; no modifican `.env`. Ningún secreto, CFDI o credencial de usuario real se usa como fixture.

## Dependencias revisadas el 7 de octubre de 2026

Next y eslint-config-next se actualizaron a 16.3.6 por [GHSA-vcvr-r3jv-pc5j](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j). `source-map-js` se actualizó a 1.2.2 por [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q).

Riesgo externo pendiente: [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), `braces@3.0.3`, no tiene versión corregida publicada. Npm propaga cinco hallazgos altos por la cadena de desarrollo eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces. No se usa esa cadena en handlers ni con patrones glob aportados por clientes; se utiliza al ejecutar lint sobre este repositorio. No ejecutar lint con configuración/patrones no revisados de fuentes no confiables. La remediación que npm propone con `--force` baja eslint-config-next a Next 14; no se aplicó ese cambio incompatible ni se silenció la auditoría. Mantener este riesgo visible hasta que upstream publique un parche compatible.
