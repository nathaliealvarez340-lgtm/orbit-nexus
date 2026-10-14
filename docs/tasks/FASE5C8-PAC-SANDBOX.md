# FASE 5C.8 — PAC sandbox con SW sapien / SmarterWEB

Estado: **implementado y probado contra un SW simulado; prueba real en sandbox NO ejecutada**
porque no existen credenciales SW de pruebas en ningún entorno (§21). Producción del PAC sigue
bloqueada. La factura **no** pasa a `ISSUED` en esta fase.

Flujo: autorización explícita por factura → `StampAttempt` (uno activo por factura) → sello
con el CSD custodiado (5C.6) → XSD oficial (5C.7) → bytes exactos persistidos →
SW `Timbrado V4 – CustomID` → verificación completa de la respuesta → `SUCCEEDED`, `FAILED`
o `UNKNOWN`.

---

## 1. Contrato SW auditado (fuentes oficiales, 2026-10-14)

| Fuente | Qué se tomó |
|---|---|
| developers.sw.com.mx/knowledge-base/timbradov4-customid/ (actualizada 2026-02-16) | Endpoint `POST /v4/cfdi33/stamp/{version}/{format}`; headers `Authorization: Bearer`, `customid` (máx. 100 caracteres, sin formato, **vigencia 72 h desde su primer uso**, colapsar espacios); campo multipart `xml`; duplicado de CustomID `CFDI3307`; tabla de versiones de respuesta (v4 = "todos los datos del timbrado"; mismo CustomID en v4 = "UUID y mensaje"; mismo sello = "toda la información relevante del CFDI") |
| developers.sw.com.mx/knowledge-base/stamp/ (actualizada 2026-10-12) | Respuesta v4: `cadenaOriginalSAT`, `noCertificadoSAT`, `noCertificadoCFDI`, `uuid`, `selloSAT`, `selloCFDI`, `fechaTimbrado`, `qrCode`, `cfdi`. Errores: `301` (estructura), `CFDI40xxx` (validación SAT; `messageDetail` trae valores), `307. El comprobante contiene un timbre previo.` (`data` = el timbre anterior), 401 (`El token debe contener 3 partes`, `AU2001 - El usuario no tiene saldo en timbres.`) |
| developers.sw.com.mx/knowledge-base/autenticacion-v2/ | `POST /v2/security/authenticate` con usuario/contraseña → token de 2 h; token "infinito" asignado desde el portal (portal.sw.com.mx). Credenciales de pruebas y productivas distintas |
| SDK oficial `lunasoft/sw-sdk-nodejs` (`RequestHelper._buildPath`, `StampServiceV4`) | Ruta V4 = `/v4/cfdi33/stamp/{version}` con XML plano (sufijo `/b64` solo para Base64); parte multipart `xml`, `Content-Type: text/xml`; header `customid` |

SW **no documenta** una API de consulta/recuperación por UUID o CustomID (búsqueda en la
documentación oficial sin resultados). La reconciliación usa únicamente los mecanismos
documentados de duplicado (§9). No se inventó ningún endpoint.

**Discrepancia documentada por SW:** la tabla dice que en v4 un CustomID duplicado devuelve
"el UUID y el mensaje", y el ejemplo de la misma página muestra `data.tfd` y `cfdi: ""`. ORBIT
acepta ambas formas y en ninguna de las dos marca la factura como timbrada (§9).

## 2. Endpoint usado

`POST https://services.test.sw.com.mx/v4/cfdi33/stamp/v4` (respuesta v4, XML plano). El path
dice `cfdi33` por compatibilidad; SW documenta que acepta CFDI 4.0.

- Orígenes constantes en `src/lib/pac/sw/config.ts`: SANDBOX `https://services.test.sw.com.mx`,
  PRODUCTION `https://services.sw.com.mx`. Ninguna petición, fila de base de datos ni dato del
  usuario elige el host. `SW_SANDBOX_BASE_URL` no existe a propósito: un origen configurable
  no aporta nada que la allowlist no fije.
- `swHostAllowed`: solo `https:`, host exacto, sin puerto ni credenciales en la URL; PRODUCTION
  se rechaza en esta fase. `createSwPacAdapter` solo construye un adaptador SANDBOX.

## 3. Autenticación

- Variable única `SW_SANDBOX_TOKEN` (token Bearer de la cuenta de pruebas de SW, recomendado el
  token infinito del portal). Forma JWT obligatoria (3 partes Base64url, ≤ 4096 caracteres, sin
  espacios ni CR/LF, que impide inyección de headers).
- Sin token → `PAC_SANDBOX_UNAVAILABLE`: no se crea intento ni se envía nada. Con
  `PAC_ENVIRONMENT=PRODUCTION` → `PAC_PRODUCTION_BLOCKED`. Nunca hay fallback a producción.
- El token solo se lee en `resolveSwPacConfiguration` y solo se usa para el header
  `Authorization`. Nunca está en DB, auditoría, logs, errores, respuestas ni navegador.
- No se llama a `/v2/security/authenticate`. Si el token expira, SW responde 401 y el intento queda
  `FAILED` con `PAC_AUTH_FAILED`, que es distinto de un rechazo fiscal y es reintentable.

## 4. Modelo `StampAttempt` y migración

Migración local `prisma/migrations/202610140001_phase5c8_pac_sandbox` (aditiva, sin `DROP`,
**no aplicada a Neon**):

- `StampAttemptStatus` = `PENDING | SIGNING | SUBMITTING | WAITING_PROVIDER | SUCCEEDED |
  FAILED | UNKNOWN` (los mismos valores que el contrato compartido `src/types/stamping.ts`).
  `WAITING_PROVIDER` no se usa porque el timbrado de SW es síncrono.
- `StampFailureClass` = `PRE_SUBMIT | REJECTED_RETRYABLE | REJECTED_FINAL`. El "REJECTED" del
  brief es `FAILED` + esta clase; así no se cambia el contrato compartido (FASE5C §20.2 dice
  "`FAILED` o estado equivalente").
- `StampingEntitlement` (FASE5C3 §Z.3): una fila por Organization con `environment` y
  `enabled=false` por defecto. La administra el operador; no hay API.
- `StampAuthorization`: `id`, Organization, factura, `invoiceVersion`, `userId`,
  `termsVersion`, `termsSha256`, `acceptedAt`. La consume exactamente un `StampAttempt`
  (`authorizationId @unique`).
- `StampAttempt`: Organization, factura, `invoiceVersion`, proveedor, adaptador, ambiente,
  `customId @unique`, `activeKey @unique`, `succeededKey @unique`, `status`, `failureClass`,
  `resultCode`, `detailCode`, `providerCode`, `providerMessage` curado, hashes
  (`requestSha256`, `preSealSha256`, `originalStringSha256`, `stampedSha256`), `sealedXml`,
  `stampedXml`, `uuid @unique`, `stampedAt` (FechaTimbrado), `rfcProvCertif`,
  `noCertificadoSat`, `submissionCount`, `startedAt`, `submittedAt`, `finishedAt` y timestamps.
- Todas las FKs son compuestas `(organizationId, id)` contra `StampedInvoice` y
  `StampAuthorization`, así que la DB rechaza un intento o una autorización de otra Organization.
- `CHECK StampAttempt_uuid_canonical_check`: el UUID solo puede guardarse en su forma canónica en
  minúsculas. Así el índice único es efectivamente insensible a mayúsculas también en la base, no
  solo en el código. Un `CHECK` no se representa en el schema de Prisma; vive solo en la migración.
- **No se guardan** token, contraseña, llave, CSD ni la respuesta cruda. Los XML se guardan en
  columnas privadas del intento y no como `Document`, porque `/api/documents/[id]` sirve a
  cualquier miembro y un XML de sandbox no debe circular como CFDI.

## 5. Autorización por factura

- Texto versionado `autorizacion-timbrado-2026-10-borrador-1` (`src/lib/stamping/terms.ts`),
  provisional hasta la revisión jurídica, con la redacción de FASE5C §28.
- `POST …/stamp` exige `{ expectedVersion, authorization: { accepted: true, version } }`, el
  contrato publicado `StampRequest`. La casilla debe venir aceptada con la versión vigente.
  `expectedVersion` debe ser la versión actual: una autorización de una versión anterior nunca
  timbra la modificada (`VERSION_CONFLICT`).
- La `StampAuthorization` se crea en la misma transacción que el intento, con el lock de la
  factura, y nunca se reutiliza.

## 6. CustomID

`orbit-<StampAttempt.id>` (UUID v4 generado por el servidor): 42 caracteres, sin datos fiscales
ni espacios. Es el mismo en cada envío del mismo intento lógico. Un intento nuevo, tras un
`FAILED`, usa un CustomID nuevo. Es una defensa adicional, no la idempotencia principal.

## 7. Idempotencia local y concurrencia

- La factura se bloquea (`SELECT … FOR UPDATE`) al crear el intento. `activeKey =
  organizationId:invoiceId` es único mientras el intento está en `PENDING`, `SIGNING`,
  `SUBMITTING` o `UNKNOWN`: la base de datos impide dos intentos activos.
- Repetir la solicitud (doble clic, reintento del navegador, otra pestaña u otra sesión) devuelve
  el mismo intento. Tras `SUCCEEDED`, la misma versión devuelve el intento exitoso
  (`succeededKey` único). Un `UNKNOWN` responde `RECONCILIATION_REQUIRED`.
- Mientras exista un intento activo, `PATCH /api/outgoing-invoices/[id]` responde 409
  `STAMP_IN_PROGRESS`, con el mismo lock de fila, y `revertReadyInvoices` (cambio de perfil fiscal
  o de cliente) deja esa factura en READY con su versión. El siguiente intento revalida los
  snapshots con `validateStoredInvoice`.
- Las transiciones son condicionales (`WHERE status IN …`): una respuesta tardía nunca
  sobrescribe un estado que otro proceso ya cambió.
- Intentos obsoletos (más de 120 s, configurable): `PENDING`/`SIGNING` → `FAILED`
  (`STALE_PRE_SUBMIT`), porque no se envió nada. `SUBMITTING` → `UNKNOWN`
  (`PAC_SUBMISSION_INTERRUPTED`). La recuperación se confirma aunque la solicitud que la detecta
  se rechace.

## 8. Estados

| Estado | Significado |
|---|---|
| `PENDING` | Autorizado y creado; nada sellado |
| `SIGNING` | Sello con CSD y XSD |
| `SUBMITTING` | Bytes exactos y hashes persistidos **antes** de la llamada de red; puede haber llegado a SW |
| `SUCCEEDED` | Timbre verificado (§12-16), UUID único |
| `FAILED` + `PRE_SUBMIT` | Falló antes de enviar (CSD, fecha, XSD, tamaño, conexión nunca establecida) |
| `FAILED` + `REJECTED_RETRYABLE` | SW confirmó que no timbró y el mismo CFDI puede pasar después: credencial (401), saldo (`AU2001`), límite (429) o conexión nunca establecida |
| `FAILED` + `REJECTED_FINAL` | Rechazo fiscal o estructural determinista (`CFDI40xxx`, `30x`) u otra negativa explícita 4xx |
| `UNKNOWN` | ORBIT no puede demostrar si SW timbró: timeout, conexión cortada, 5xx, redirect, JSON inválido, truncado o excesivo, éxito sin CFDI, duplicado sin CFDI, timbre no verificable o UUID ya existente |

`UNKNOWN` nunca se convierte en `FAILED` automáticamente y nunca se reintenta a ciegas.

## 9. Duplicados y reconciliación de `UNKNOWN`

- **Mismo sello** (`307` con `data`): el timbre anterior se verifica completo y, si cumple todo,
  el intento pasa a `SUCCEEDED` con `resultCode=PAC_PREVIOUSLY_STAMPED`.
- **Mismo CustomID** (`CFDI3307`):
  - con `data.cfdi`: verificación completa → `SUCCEEDED` (`PAC_DUPLICATE_CUSTOM_ID`);
  - con solo `tfd` o solo `uuid`: sigue `UNKNOWN`. Si hay TFD, se verifica contra el sello
    enviado y se anota `detailCode=TFD_BOUND_WITHOUT_CFDI`. Nunca se acepta un UUID suelto
    (FASE5C §19.2).
- **Reconciliación** (`POST …/stamp/reconcile`, sin body) pasa por estos pasos:
  1. Reclama el intento `UNKNOWN` (lo devuelve a `SUBMITTING`; solo una reconciliación a la vez).
  2. Restaura los bytes exactos persistidos con `restoreSealedCfdi40`: mismo SHA-256, la cadena
     recalculada con la XSLT oficial debe tener el SHA-256 de la firmada y el Sello debe
     verificar.
  3. Vuelve a validar el XSD y reenvía con el **mismo CustomID**. Si los bytes no coinciden
     queda `UNKNOWN` (`STORED_REQUEST_CORRUPT`) y no se envía nada.
- Durante la reconciliación, cualquier rechazo deja el intento en `UNKNOWN` con
  `detailCode=RECONCILIATION_<código>`: un rechazo ahora no demuestra que el primer envío no se
  haya timbrado.
- Dentro de las 72 h del CustomID, SW puede contestar `CFDI3307` solo con el UUID. En ese caso
  el intento sigue `UNKNOWN`. Al expirar el CustomID, el mismo reenvío llega a la validación
  de sello (`307`), que devuelve el timbre completo. Pendiente de confirmar en vivo
  (gate `PAC_RECONCILIATION_LIVE_VALIDATED`).

## 10. Política de reintentos

- El POST nunca se reintenta tras haber podido llegar a SW.
- El adaptador reintenta solo errores en los que **la conexión no se estableció** (`ENOTFOUND`,
  `EAI_AGAIN`, `ECONNREFUSED`, `EHOSTUNREACH`, `ENETUNREACH`, `UND_ERR_CONNECT_TIMEOUT` y errores
  de certificado TLS): 2 reintentos con backoff de 250 ms y 1000 ms, mismos bytes y mismo
  CustomID. Si aun así no conecta, el intento queda `FAILED`/`REJECTED_RETRYABLE`
  (`PAC_NOT_SUBMITTED`).
- Un nuevo intento después de un `FAILED` exige una nueva autorización y genera un CustomID nuevo.
  Después de un `UNKNOWN`, solo procede la reconciliación.

## 11. Adaptador HTTP (`src/lib/pac/sw/adapter.ts`, server-only)

- Un `POST` con `redirect: "manual"`; cualquier 3xx es `UNKNOWN` y nunca se lee `Location`.
- Timeout total de 30 s con `AbortController`, que incluye la lectura del cuerpo.
- Límites:
  - request de 1 MB (`PAC_REQUEST_TOO_LARGE` antes de enviar);
  - cuerpo de respuesta de 5 MB (`Content-Length` y lectura en streaming);
  - CFDI de 4 MB, TFD de 16 KB y 4 KB por campo.
- Solo acepta `pacSubmission(XsdValidatedCfdi40)` y envía sus bytes exactos (multipart construido
  a mano, con boundary aleatorio que se verifica fuera del XML).
- TLS normal del runtime (undici); nunca se desactiva la validación.

## 12. Parser de respuesta (`src/lib/pac/sw/response.ts`)

- Primero el status HTTP. Los 4xx son negativas explícitas aunque el cuerpo esté dañado.
- El JSON se acepta solo con `application/json`, en UTF-8 estricto y como objeto. Se ignoran los
  campos desconocidos.
- Se validan tipo y tamaño de cada campo. `messageDetail` **nunca** se lee, porque trae importes.
- `providerCode` se extrae del mensaje (`CFDI40119`, `307`, `AU2001`). `providerMessage` solo se
  conserva si el texto de catálogo no tiene dígitos ni `<>`.
- Si falta el campo requerido (`cfdi` en éxito v4), el resultado es `UNKNOWN`.

## 13. TFD (parser)

`src/lib/cfdi40/stamped.ts` lee el TFD del mismo árbol que validó libxml2, sin regex sobre XML:

- el nodo es exactamente `{http://www.sat.gob.mx/TimbreFiscalDigital}TimbreFiscalDigital`;
- `Version="1.1"`;
- `UUID` con forma RFC 4122 y no nulo;
- `FechaTimbrado` es una fecha de calendario real (AAAA-MM-DDThh:mm:ss);
- `RfcProvCertif` tiene forma de persona moral;
- `NoCertificadoSAT` tiene 20 dígitos;
- `SelloSAT` es Base64 canónico de 128 a 1024 bytes y no constante;
- `SelloCFD` es el Sello enviado;
- no hay otros atributos (solo el `xsi:schemaLocation` estándar), ni hijos ni texto.

Antes del parser se rechazan DOCTYPE/DTD, entidades, CDATA, comentarios y PIs, y solo se permiten
los namespaces `cfdi`, `xsi` y `tfd`. Se parsea con `XML_PARSE_NONET`.

## 14. XSD del TFD

- Versionados byte a byte en `resources/sat/cfdi40/`, con manifiesto (`kind` `TFD_XSD`/`TFD_XSLT`)
  y bundle `src/lib/sat/cfdi40/tfd11.json` re-hasheado al cargar:
  - `TimbreFiscalDigitalv11.xsd`: 4 732 B, `fb3d061fe9914500bef8beb3ea2e8722ee8a8224fa3af63643877a64c0ea05f7`, Last-Modified 2020-08-08. Importa solo `tdCFDI.xsd`, que ya estaba versionado.
  - `cadenaoriginal_TFD_1_1.xslt`: 2 340 B, `d7807e936d5a768cec5dca7a35a8b6dd515287083ca9dd7424c1b722c4b0d5a6`, Last-Modified 2020-08-08. Sin includes.
- Descarga de revisión por HTTPS, sin redirects y en un directorio vacío fuera del repo. Se
  versionó con `node scripts/sat/tfd11-bundle.mjs --add <dir> --obtained-at 2026-10-14`.
  `fetch-cfdi40-resources.mjs` y `build-cfdi40-resources.mjs` ya incluyen estos recursos.
- `cfdv40.xsd` declara `Complemento` como `xs:any` estricto. Por eso el CFDI timbrado se valida
  con un raíz contenedor de ORBIT (`urn:orbit:xsd:cfdi40-tfd11`), **sin reglas**, que solo
  importa los dos esquemas oficiales (`src/lib/cfdi40/stamped-schema.ts`).
- El conjunto se compila una vez por motor y por conjunto, y debe pedir **exactamente** cfdv40,
  catCFDI, tdCFDI y el XSD del TFD. El resolver es el mismo resolver cerrado de 5C.7. El bundle
  XSD de 5C.7 no cambió (sigue siendo `19c88546…`).

## 15. Binding TFD ↔ CFDI

- `TFD.SelloCFD` es exactamente el `Sello` enviado.
- `noCertificadoCFDI` de SW es el `NoCertificado` enviado.
- `uuid`, `selloCFDI`, `selloSAT`, `noCertificadoSAT` y `fechaTimbrado` de SW coinciden con el TFD.
- `cadenaOriginalSAT` de SW es igual a la cadena que ORBIT produce con la XSLT oficial del TFD
  sobre un documento TFD escrito por su propio serializador.
- Un TFD separado (`data.tfd`) debe tener los mismos atributos.
- El UUID se guarda (en minúsculas canónicas) solo al final, dentro de la transacción de
  `SUCCEEDED`. Es único en ORBIT: si SW devuelve un UUID que ya existe, el intento queda `UNKNOWN`
  (`PAC_UUID_CONFLICT`) y nunca hay dos intentos con el mismo UUID.

## 16. Validación del XML timbrado final

- El `cfdi` de SW se valida de nuevo (preflight y XSD cfdv40 + TFD). No se reutiliza el resultado
  XSD previo.
- Su árbol debe ser **igual** al de los bytes enviados en todo elemento, atributo y valor
  (importes, RFC, Fecha, conceptos, `Sello`, `NoCertificado`, `Certificado` y `schemaLocation`),
  más exactamente un `cfdi:Complemento` con exactamente un TFD.
- Se aceptan equivalencias de serialización: orden de atributos, dónde se declaran los namespaces,
  espacios entre elementos y BOM.
- El XML se conserva **tal como lo devolvió SW**; nunca se arma con reemplazos de texto.
- Si cambia contenido fiscal, el resultado es `UNKNOWN` (`PAC_RESPONSE_INCONSISTENT` +
  `detailCode`). No es `REJECTED`, porque ese CFDI podría existir en el SAT.

## 17. SelloSAT

- ORBIT calcula la cadena original del TFD con la XSLT oficial y la compara con la de SW.
- **No** verifica criptográficamente el `SelloSAT`. Haría falta el certificado del SAT
  correspondiente a `NoCertificadoSAT`, de una fuente oficial confiable, y confirmar el algoritmo
  en el estándar del TFD. En sandbox ese certificado es de pruebas y no hay fuente versionada.
- Gate `TFD_SAT_SEAL_VERIFIED=false`. `StampedCfdi40.satSealVerified` es siempre `false`.
- Diferencia explícita:
  - **TFD estructuralmente validado y ligado:** hecho.
  - **Sello SAT verificado criptográficamente:** pendiente.

## 18. Disponibilidad, rutas y errores

`GET /api/outgoing-invoices/[id]/stamp`, `POST …/stamp` y `POST …/stamp/reconcile` (contrato
`src/types/stamping.ts`) comparten estas condiciones:

- sesión con plan PRO/MAX; OWNER o ADMIN;
- mismo origen; rate limit propio (`stamp:<userId>`, 10/min);
- `Cache-Control: private, no-store`.

Razones de bloqueo:

- `STAMPING_DISABLED`: `STAMPING_ENABLED` distinto de `true` (§Z.1; apagado por defecto).
- `PRIVACY_NOTICE_MISSING`: deployment de producción sin Aviso publicado.
- `ROLE_NOT_ALLOWED`.
- `PAC_NOT_CONFIGURED`: sin token, PRODUCTION, o custodia y PAC que no son SANDBOX.
- `ORGANIZATION_NOT_ENTITLED`.
- `CSD_NOT_VALID`.
- `INVOICE_NOT_READY` y `DOCUMENT_TYPE_NOT_SUPPORTED`.
- `ATTEMPT_IN_PROGRESS` y `RECONCILIATION_REQUIRED`.

Los errores HTTP usan los códigos publicados en `StampErrorCode` (`STAMPING_DISABLED`,
`STAMPING_NOT_ALLOWED`, `VERSION_CONFLICT`, `INVOICE_NOT_READY`, `NOT_READY`,
`RECONCILIATION_REQUIRED` y `CSD_NOT_VALID`), más `INVOICE_NOT_FOUND`/`INVALID_REQUEST` como el
resto de Invoice Studio. Los códigos finos del PAC viajan en `attempt.error.code` (string),
**sin modificar el contrato compartido**.

En sandbox la factura queda `READY`: sin UUID, sin `ISSUED` y sin documentos (FASE5C §21.6).
El UUID de sandbox vive solo en `StampAttempt`.

## 19. Auditoría

Eventos `cfdi.stamp.authorized`, `.started` (`reconciliation: true|false`), `.succeeded`
(incluye UUID verificado, FASE5C §25.1), `.rejected` y `.unknown`. Solo llevan ids, proveedor,
ambiente, `resultCode`, `providerCode`, `detailCode`, `failureClass`, versión y términos.
Nunca token, XML, Sello, CSD, RFC, importes ni respuesta cruda. Los eventos de 5C.6/5C.7
(`cfdi.sealed`, `cfdi.xsd.*`) se siguen registrando en el flujo.

## 20. Seguridad (resumen)

- Tenant: Organization tomada de la membresía y queries con `organizationId`. FKs compuestas.
  B nunca lee, timbra, reconcilia ni se liga a una factura de A (404 o bloqueo, y nada escrito).
- Red: origen constante en allowlist, `https`, sin redirects, sin URLs de DB o usuario, timeout y
  límites.
- XML: sin DTD, entidades ni red. El parser y el validador son el mismo motor auditado
  (libxml2-wasm 0.7.2).
- Secretos: token solo en el header. Escaneo de DB, auditoría y respuestas en pruebas. La E2E
  revisa respuestas y logs del servidor.

## 21. Prueba real en sandbox — NO ejecutada

No hay credenciales: ni `SW_SANDBOX_TOKEN` ni ninguna variable SW en el entorno ni en
`.env` del worktree principal (verificado por nombre, sin leer valores). No se usaron
credenciales públicas encontradas en internet ni se inventaron.

Para la prueba controlada faltan:

1. `SW_SANDBOX_TOKEN`: token de la cuenta de **pruebas** de SW (formulario de SW).
2. Un **CSD de pruebas oficial** del SAT para sandbox (`.cer`, `.key` y contraseña). SW publica
   dónde encontrarlo; no es un CSD de cliente.
3. Para timbrar desde la app (custodia): agregar a `officialTestAuthorities` el certificado de la
   CA de pruebas del SAT, con SHA-256, URL y fecha (FASE5C3 §M.0/§AB.7). Requiere autorización
   explícita. Hoy la lista está vacía y ninguna CSD puede custodiarse fuera de las pruebas.
4. Habilitar `STAMPING_ENABLED=true` y una fila `StampingEntitlement(SANDBOX, enabled)`.

Con eso, la prueba es una sola factura de prueba:

1. Timbrarla con un CustomID único y verificar el TFD.
2. Repetir el mismo CustomID para observar la respuesta real de duplicado (§9).
3. Documentar solo la evidencia segura: códigos, hashes y UUID de sandbox.

## 22. Pruebas

| Suite | Qué demuestra |
|---|---|
| `tests/pac-sw-adapter.test.ts` (10) | Configuración y allowlist; request exacto (URL, POST, Bearer, `customid`, multipart con los bytes exactos, `redirect: manual`, signal); clasificación de todas las respuestas documentadas; `UNKNOWN` para 5xx, redirect, JSON inválido, tipo erróneo, excesivo, truncado y éxito sin CFDI; timeout y reset después de enviar sin reintento; reintento solo sin conexión; el token nunca aparece |
| `tests/cfdi40-stamped.test.ts` (13) | Recursos TFD byte a byte y fail-closed; conjunto XSD contenedor con loads exactos; los 10 CFDI soportados verificados; re-serialización equivalente aceptada; contenido fiscal alterado rechazado; 18 problemas de TFD; XXE, DTD, entidades, comentario, CDATA, PI, XInclude, no UTF-8, malformado y excesivo; campos paralelos falsos; TFD de otro CFDI; restauración para reconciliación; sin red, archivos ni consola; gate del SelloSAT pendiente |
| `tests/cfdi40-stamp-service.test.ts` (13, PGlite) | Gates sin escrituras ni envíos; autorización y versión; éxito con bytes persistidos y auditoría sin secretos; idempotencia; concurrencia (dos sesiones → un intento, una llamada, un UUID); rechazos final y reintentable; `UNKNOWN` → `RECONCILIATION_REQUIRED` → reconciliación con mismos bytes y CustomID (UUID solo → sigue `UNKNOWN`; timbre completo → `SUCCEEDED`); nunca llegó; `307` por sello; rechazo en reconciliación → sigue `UNKNOWN`; respuesta inconsistente; UUID duplicado; multi-tenant (incluida FK); intentos obsoletos; fallo antes de enviar; bytes guardados alterados; CSD deshabilitado; token ausente de DB y auditoría |
| `scripts/pac-sandbox-e2e.mjs` (6, `next start`) | Sesión y plan; contrato de estado; mismo origen, autorización y gates sin escrituras; MEMBER y otra Organization; bloqueo de edición `STAMP_IN_PROGRESS` y reversión de READY que respeta el intento activo; nada sensible en respuestas ni logs |

El SW de las pruebas es una **simulación** de las formas documentadas; no prueba nada del PAC
real (gate `PAC_SANDBOX_LIVE_VALIDATED=false`).

## 23. Gates

| Gate | Estado |
|---|---|
| `XSD_OFFICIAL_VALIDATION_READY` (5C.7) | true |
| `CSD_TYPE_VERIFIED` | false |
| `OFFICIAL_CSD_FIXTURE_VALIDATED` | false |
| `POSTGRES_CSD_CONCURRENCY_VALIDATED` | false |
| `productionLegalGateSatisfied` | false |
| `PAC_SANDBOX_LIVE_VALIDATED` (nuevo) | false: faltan credenciales |
| `PAC_RECONCILIATION_LIVE_VALIDATED` (nuevo) | false |
| `TFD_SAT_SEAL_VERIFIED` (nuevo) | false |
| `PAC_PRODUCTION_CREDENTIALS` (nuevo) | false |
| KMS/HSM | pendiente |
| PAC producción | **bloqueado** (no se puede construir el adaptador) |
| READY → ISSUED | pendiente (fase posterior) |

## 24. Riesgos

- Sin evidencia real de SW. La forma de las respuestas sale de la documentación y del SDK; la
  documentación misma es inconsistente para el CustomID duplicado.
- Un `UNKNOWN` dentro de las 72 h del CustomID puede no resolverse hasta que expire. Requiere un
  procedimiento operativo de soporte, sin API de consulta por UUID documentada.
- Durante la reconciliación, las negativas mantienen `UNKNOWN`. Un CFDI que de verdad nunca se
  timbró puede quedar bloqueado y requerir resolución manual. Es preferible a un timbrado doble.
- `SelloSAT` no se verifica criptográficamente.
- La concurrencia en PostgreSQL real (lock `FOR UPDATE`) se demostró en PGlite, que serializa
  las transacciones.
- La comparación estructural es estricta: si SW cambiara algo no fiscal (por ejemplo, el
  `schemaLocation` raíz), el resultado sería `UNKNOWN`, no un éxito. Hay que revisarlo con la
  prueba real.
- Los textos de autorización son borradores pendientes de revisión jurídica.

## 25. Siguiente paso

1. Conseguir las credenciales de pruebas de SW y el CSD de pruebas oficial; autorizar la CA de
   pruebas del SAT; ejecutar la prueba real única (§21) y cerrar `PAC_SANDBOX_LIVE_VALIDATED` y
   `PAC_RECONCILIATION_LIVE_VALIDATED`.
2. Revisar y aplicar la migración en un entorno no productivo (no Neon hasta revisión).
3. Fuente oficial del certificado del SAT para `TFD_SAT_SEAL_VERIFIED`.
4. Fase READY → ISSUED: Document privado del XML timbrado, `StampedInvoice.uuid` e `issuedAt`
   con la fecha de timbrado, PDF, inmutabilidad y separación de sandbox.
