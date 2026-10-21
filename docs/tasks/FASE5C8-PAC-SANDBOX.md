# FASE 5C.8 — PAC sandbox con SW sapien / SmarterWEB

Estado: **implementado, probado contra un SW simulado y validado en el sandbox real de SW**
(2026-10-21): un primer timbre histórico (§21.1) y un ciclo crash-safe con timbre nuevo y
reenvío real desde otro proceso con el mismo CustomID y los mismos bytes (§21.3.1), y la
recuperación por la ruta productiva `UNKNOWN` → proceso nuevo → `reconcileStampAttempt` real →
SW `307` → mismo UUID → `SUCCEEDED` (§21.3.2; un primer intento recibió 401 sin timbre). Seis
POST en total. Producción del
PAC sigue bloqueada. La factura **no** pasa a `ISSUED` en esta
fase.

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
- Según la documentación, dentro de las 72 h del CustomID SW puede contestar `CFDI3307` solo
  con el UUID; en ese caso el intento sigue `UNKNOWN`. **Observado en vivo (§21.3.1 y
  §21.3.2, este último por `reconcileStampAttempt` desde `UNKNOWN`):** el reenvío de los mismos
  bytes con el mismo CustomID, minutos después del timbre, recibió HTTP 400 `307` con el CFDI
  completo (SW detectó primero el Sello duplicado), y ORBIT lo verificó contra los bytes
  enviados. `CFDI3307` **no** fue el comportamiento observado; su manejo sigue basado en la
  documentación.

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

## 21. Prueba real en sandbox — EJECUTADA (2026-10-21): SUCCEEDED

### 21.1 Resultado

Un único POST a `https://services.test.sw.com.mx/v4/cfdi33/stamp/v4` desde el servicio real
(`stampInvoice`) contra PGlite efímero (sin `DATABASE_URL`, sin Neon). `STAMPING_ENABLED`,
token, KEK y CSD solo en el proceso; nada en `.env`, repo ni DB salvo lo que el servicio
guarda (sin token ni contraseña: verificado sobre DB, auditoría y respuesta).

- **CSD:** EKU9003173C9 (ESCUELA KEMPER URGATE SA DE CV, Sucursal 1), NoCertificado
  `30001000000500003416`, vigente 2023-05-18 → 2027-05-18, RSA 2048, no CA, SHA-256 del `.cer`
  `92be3ef4…bb53`, emitido y firmado por "AC UAT" 2022 (la CA ya fijada). Pasa
  `validateCsdUpload` completo en SANDBOX; rechazado en PRODUCTION (`CSD_ENVIRONMENT_MISMATCH`),
  con otro RFC (`CSD_RFC_MISMATCH`) y con contraseña errónea (`CSD_PASSWORD_INVALID`). La
  custodia (`configureCsd`) lo deja `VALID`.
- **Datos autorizados:** emisor `EKU9003173C9` / `ESCUELA KEMPER URGATE` / 601 / CP 42501;
  receptor `URE180429TM6` / `UNIVERSIDAD ROBOTICA ESPAÑOLA` / 601 / CP 86991 / G01 (contrastados
  por el usuario con el Excel de SW, la tabla vigente de CSD de pruebas y ejemplos de SW).
- **CFDI:** I, MXN, PUE, FormaPago 03, Exportacion 01, Folio ORB-000001; un concepto
  `84111500` / E48 / 1 × 100.00, ObjetoImp 02, IVA 002 Tasa 0.160000 = 16.00; SubTotal 100.00,
  Total 116.00. La clave `84111506` (propuesta inicial) está en el c_ClaveProdServ oficial pero
  no en el subconjunto que ORBIT verifica para READY (`CONCEPT_PRODUCT_CODE_UNVERIFIED`); no se
  relajó el gate y se usó `84111500`, presente en ambos.
- **Pipeline:** borrador con los mismos snapshots y cálculos que `createInvoiceDraft` →
  `validateStoredInvoice` (`canMarkReady=true`, sin issues) → READY → autorización explícita →
  `StampAttempt` → PreSeal → cadena original (XSLT oficial) → sello CSD → `SealedCfdi40` → XSD
  oficial → `XsdValidatedCfdi40` (3 651 B) → bytes y hashes persistidos → POST. El perfil fiscal
  efímero llevó una CSF y un domicilio marcados como *placeholder* de sandbox, que ORBIT exige
  para READY y que no forman parte del CFDI 4.0.
- **Envío:** `connectRetries: 0`, transporte con candado de una sola llamada y marcador que
  impide una segunda ejecución live. CustomID `orbit-ad09e587-…-69306fdc2ccb`. El cuerpo
  multipart contenía exactamente los bytes validados por XSD.
- **Respuesta:** HTTP 200 `application/json` → `PAC_STAMPED` → `SUCCEEDED`, `submissionCount=1`.
  UUID `222cfe39-…-…4315` (sandbox), FechaTimbrado `2026-10-21T14:27:24`, RfcProvCertif
  `SPR190613I52`, NoCertificadoSAT `30001000000500003456`.
- **Verificación (servicio + re-verificación independiente):** TFD 1.1 válido; `SelloCFD` =
  `Sello` enviado; `selloCFDI` y `noCertificadoCFDI` de SW = lo enviado; `cadenaOriginalSAT` de
  SW = la cadena de la XSLT oficial del TFD; contenido fiscal sin cambios; XSD final
  cfdv40 + TFD 1.1 válido; CFDI guardado tal como lo devolvió SW (mismo SHA-256); UUID único en
  ORBIT; la factura sigue READY, sin UUID ni `ISSUED`. `satSealVerified=false` (§17).
- **Observado en vivo:** SW no altera el `schemaLocation` raíz ni nada fiscal (riesgo §24
  descartado para este caso); la respuesta v4 trae `cfdi` completo.
- **No ejecutado en este ciclo:** el segundo envío con el mismo CustomID (§9); la instrucción
  fue un único POST. La reconciliación real se hizo después en un ciclo nuevo (§21.3); este
  primer intento no se reconstruyó ni se reutilizó.
- **Reconciliación de este intento imposible:** el intento vivió en PGlite efímero, que se cerró al
  terminar el proceso. De la primera ejecución solo se conservaron el CustomID, el SHA-256 de
  los bytes enviados (`ceaa25a8…24e9`) y el UUID redactado; ni los bytes exactos ni el
  `StampAttempt` original. Un reenvío idéntico exige reconstruirlos (mismo Fecha, re-firma
  determinista RSA PKCS#1 v1.5 y comprobación del SHA-256 antes de enviar), lo que no se hizo sin
  autorización. Lección: la prueba de reconciliación debe correr en el mismo proceso, o con una
  base local persistente, que el primer envío.
- Estabilidad: `npm test` 3/3 corridas secuenciales en verde (280/280) el 2026-10-21. El fallo
  único observado antes no se reprodujo.

### 21.2 Antecedentes (CA de pruebas y primer CSD)

Estado previo al 2026-10-21:

1. `SW_SANDBOX_TOKEN` y el CSD oficial de pruebas se entregan solo como variables de proceso
   de la sesión (`SW_SANDBOX_TOKEN`, `SW_TEST_CSD_CER`, `SW_TEST_CSD_KEY`,
   `SW_TEST_CSD_PASSWORD`; las tres últimas son rutas y contraseña fuera del repo). Nunca en
   `.env`, archivos versionados, DB ni logs.
2. CSD oficial: KIJ0906199R1 (Sucursal 1), NoCertificado `30001000000500003437`, vigente
   2023-05-18 → 2027-05-18, SHA-256 del `.cer` `90561071…0545`. Pasa todo el flujo §M de ORBIT
   (DER, RSA 2048, vigencia, RFC, NoCertificado, CA oficial, PKCS#8 cifrado, contraseña, par).
3. **CA de pruebas autorizada y agregada** a `officialTestAuthorities`: "AC UAT" del SAT
   (2022-03-04 → 2030-03-04, RSA 4096, `CA:TRUE pathlen:0`, SHA-256 `ff9c2203…acf9`),
   archivo `Certificados_UAT_2022/AC_UAT_2022.crt` de
   `http://omawww.sat.gob.mx/tramitesyservicios/Paginas/documentos/Certificados_P.zip`
   ("Certificados padre…", página SAT de Certificados de Sello Digital; el host no responde en
   443, se descargó por HTTP sin redirects; SHA-256 del zip `38832970…203a`). Verificado:
   `checkIssued` y firma del CSD con su llave; la CA verifica contra la raíz de pruebas
   "Agencia Certficadora Raiz Beta ANG" del mismo archivo. El "AC UAT" de 2018 del mismo
   archivo tiene casi el mismo subject y **no** verifica el CSD (por eso nunca basta el nombre).
   Pruebas: `tests/csd-crypto.test.ts` (CA fijada; impostor con el subject exacto rechazado;
   CSD oficial aceptado en SANDBOX y rechazado en PRODUCTION, fuera de vigencia y con otro RFC
   —esta última solo con las variables presentes—). Efecto: en fiscal SANDBOX con KeyProvider
   la custodia queda disponible para CSD de prueba del SAT, también en un build de producción
   (FASE5C3 §G.1: `env` permitido en SANDBOX solo con CSD de prueba).
4. **Bloqueo (resuelto con el CSD EKU, §21.1):** la tabla vigente de SW
   (developers.sw.com.mx/knowledge-base/donde-encuentro-csd-de-pruebas-vigentes/) publica
   para KIJ0906199R1 solo RFC, SCNF=No, VALIDEZ OBLIGACIONES=1 ("habilitado para facturar, IVA
   exento, tasa 0% y 16%"), NOMBRE `KERNEL INDUSTIA JUGUETERA`, CP `28971` y RETENCION=0.
   **No publica RegimenFiscal** ni receptor de pruebas. No se inventa: falta una fuente
   oficial para `Emisor/@RegimenFiscal` y la confirmación del receptor antes del único POST.
5. Falta además habilitar `STAMPING_ENABLED=true` (solo en el proceso local) y una fila
   `StampingEntitlement(SANDBOX, enabled)` en la DB efímera.

Plan original de la prueba: (1) timbrar con un CustomID único y verificar el TFD — **hecho**
(§21.1); (2) repetir el mismo CustomID para observar el duplicado real (§9) — **pendiente**, con
autorización aparte; (3) documentar solo evidencia segura — hecho.

### 21.3 Recuperación crash-safe del intento

La reconciliación de §9 solo es segura si el intento sobrevive a la muerte del proceso que lo
envió. El flujo es:

persistir la solicitud exacta → commit → envío → resultado incierto o éxito → muere el proceso →
proceso nuevo → recupera la solicitud exacta → mismo CustomID → reconciliación → mismo UUID.

- **Antes del envío** (`src/services/cfdi40-stamp.ts`, transición `SIGNING → SUBMITTING`): se
  confirman en la DB, fuera de cualquier transacción abierta durante el HTTP, el intento (id,
  CustomID `orbit-<id>`, factura y versión, autorización), los bytes exactos del
  `XsdValidatedCfdi40` (`sealedXml`), `requestSha256`, `preSealSha256`, `originalStringSha256` y
  `submissionCount+1`. Solo después se llama a `pac.stamp`.
- **Reconciliación desde otro proceso**: `reconcileStampAttempt` (§9) restaura esos bytes con
  `restoreSealedCfdi40` (mismo SHA-256, cadena recalculada con la XSLT oficial = la firmada, Sello
  verificado) y los reenvía con el mismo CustomID. Nada se reconstruye, re-fecha ni re-firma.
- **Evidencia a prueba de manipulación en la DB** (migración
  `202610210001_phase5c8_crash_safe_stamping`, aditiva, no aplicada a Neon): CHECKs que exigen
  que bytes y hashes existan juntos y que `requestSha256 = sha256(sealedXml)` (y lo mismo para
  el CFDI timbrado); trigger que vuelve inmutables la identidad del intento (incluidos
  Organization, factura, versión, autorización y CustomID), la solicitud una vez persistida y el
  timbre una vez registrado; `submissionCount` solo crece; un intento que pudo llegar al PAC no
  se borra; `StampAuthorization` no se edita. CHECKs y triggers no se representan en el schema
  de Prisma.
- **Prueba** (`tests/cfdi40-stamp-crash-recovery.test.ts`, dos procesos del SO y un directorio
  PGlite persistente, PAC **simulado**): el proceso A (`tests/fixtures/stamp-crash-child.ts`)
  autoriza, sella, valida XSD, persiste y muere (`exit 99`) en cuanto el PAC recibe la solicitud;
  el proceso B reabre la DB, encuentra el mismo intento en `SUBMITTING` con el CustomID, el
  `requestSha256` y los bytes que recibió el PAC, comprueba que la DB rechaza alterar cualquiera
  de ellos y reconcilia: `CFDI3307` solo con UUID → sigue `UNKNOWN`; con el CFDI → `SUCCEEDED`,
  el mismo intento, `submissionCount=3`, cada reenvío con los mismos bytes y CustomID.

#### 21.3.1 Ciclo real en SW sandbox (2026-10-21): timbre nuevo + reconciliación

Scripts únicos fuera del repo (necesitan token y CSD del proceso), PGlite **persistente** en
un directorio temporal fuera del repo, sin `DATABASE_URL` ni Neon, con el mismo pipeline de
§21.1 (`configureCsd` con el CSD EKU, `validateStoredInvoice`, `stampInvoice`) y los mismos
datos autorizados: emisor `EKU9003173C9` / `ESCUELA KEMPER URGATE` / 601 / CP 42501; receptor
`URE180429TM6` / `UNIVERSIDAD ROBOTICA ESPAÑOLA` / 86991 / 601 / G01. CFDI nuevo (otra Fecha,
otro Sello), CustomID nuevo; el intento de §21.1 no se reutilizó.

1. **Dry run (sin red).** El stub del PAC registró los bytes recibidos y mató el proceso
   (`exit 97`) en el límite del PAC. Antes, desde la misma sesión de DB: intento `SUBMITTING`,
   CustomID, `requestSha256` = SHA-256 de los bytes recibidos = `sha256(sealedXml)`,
   `preSealSha256` y `originalStringSha256`, `submissionCount=1`, autorización de la misma
   versión y ningún xid de transacción asignado (sin transacción con escrituras abierta). Un
   proceso nuevo, sin token, reabrió la DB: 12/12 comprobaciones, incluidos los bytes idénticos
   y la restauración como lo hace `reconcileStampAttempt`.
2. **POST 1 (nuevo).** Las mismas comprobaciones, contra el cuerpo multipart real, pasaron antes
   del `fetch` (`connectRetries: 0`, candado de una llamada, marcador). HTTP 200 → `PAC_STAMPED`
   → `SUCCEEDED`, `submissionCount=1`, 3 651 B, `requestSha256` `5a404136…8dfd`. UUID
   `5fd79d33-…-…e662` (completo solo en la DB local), FechaTimbrado `2026-10-21T15:46:50`,
   RfcProvCertif `SPR190613I52`, NoCertificadoSAT `30001000000500003456`. TFD 1.1, `SelloCFD` =
   Sello enviado, `cadenaOriginalSAT` = XSLT oficial del TFD, XSD final CFDI + TFD, contenido
   fiscal sin cambios, UUID único; la factura sigue READY sin UUID. El proceso terminó y cerró
   la DB.
3. **Proceso nuevo (sin token).** Recuperó el mismo intento: CustomID, `requestSha256`, bytes
   idénticos a los capturados del multipart, hashes, autorización, `SUCCEEDED`, UUID completo
   canónico, `stampedXml` fijado por su hash y con el mismo UUID: 16/16.
4. **POST 2 (reconciliación), desde otro proceso nuevo.** `reconcileStampAttempt` solo reclama
   intentos `UNKNOWN` (o `SUBMITTING` obsoletos); este estaba `SUCCEEDED`, así que el script
   restauró los bytes persistidos con las mismas funciones (`restoreSealedCfdi40` + XSD),
   confirmó `submissionCount=2` **antes** del envío, comprobó en el multipart los mismos bytes,
   SHA-256 y CustomID, y envió una sola vez con el adaptador real. Respuesta: HTTP 400, código
   SW `307` (CFDI previamente timbrado) con el CFDI completo → `EVIDENCE` /
   `PAC_PREVIOUSLY_STAMPED`. Verificación completa (TFD 1.1, `SelloCFD`, `cadenaOriginalSAT`,
   XSD final, mismo `sentSha256`, misma FechaTimbrado). UUID recibido = UUID persistido
   (igualdad exacta de 36 caracteres, comparada internamente). Después: 1 intento, 1 UUID, 1
   factura, 1 autorización; el intento sigue `SUCCEEDED` con UUID y `stampedSha256` sin
   cambios; `submissionCount=2`. Ni token ni contraseña en DB ni auditoría.

**Comportamiento real de SW observado:**

- Ante el mismo Sello y el mismo CustomID dentro de las 72 h, SW respondió `307` (por Sello),
  no `CFDI3307` (por CustomID), y devolvió el CFDI completo con el mismo UUID y la misma
  FechaTimbrado.
- El CFDI del `307` **no** es idéntico byte a byte al devuelto en el timbre original (otro
  SHA-256), aunque verifica igual y lleva el mismo timbre. No se guardó la segunda respuesta,
  así que no se sabe qué cambió (probablemente serialización). ORBIT conserva el CFDI del primer
  timbre y no lo sustituye (el trigger lo impide).

**Límites de este ciclo (resueltos en §21.3.2):**

- El segundo POST lo hizo el script, no `reconcileStampAttempt`, porque el servicio no reabre un
  intento `SUCCEEDED`. La ruta productiva `UNKNOWN → reconcileStampAttempt` se validó después en
  vivo (§21.3.2).
- `SelloSAT` sigue sin verificación criptográfica (`TFD_SAT_SEAL_VERIFIED=false`).

Conclusión: comportamiento de duplicado de SW en vivo **VALIDADO**.

#### 21.3.2 Recuperación por la ruta productiva en vivo — VALIDADA

Objetivo: POST real → resultado ambiguo para ORBIT → `UNKNOWN` → reinicio del proceso →
`reconcileStampAttempt` real → SW → mismo UUID → `SUCCEEDED`, sin cambiar el servicio ni el
adaptador. `SUCCEEDED` sigue siendo terminal.

- **Inyección del fallo (solo en el harness, fuera del repo):** `stampInvoice` y el adaptador SW
  reales; el `transport` que recibe el adaptador deja pasar el `fetch` real, lee la respuesta
  completa, guarda en privado solo hashes (nunca UUID ni XML) y **no** la entrega: lanza
  `ECONNRESET`, que el adaptador de producción clasifica como `UNKNOWN / PAC_CONNECTION_LOST`.
  El proceso B usa `reconcileStampAttempt` con el adaptador real y un `transport` que solo
  observa (candado, marcador, bytes en el cable) y devuelve la respuesta intacta.
- **Dry run (sin red), en verde:** A terminó en `UNKNOWN / PAC_CONNECTION_LOST` (no `FAILED`),
  con intento, CustomID, bytes, hashes, autorización y `submissionCount=1` persistidos antes del
  envío. B, en un proceso nuevo sin token: 16/16 comprobaciones; `reconcileStampAttempt` reclamó
  el intento (`SUBMITTING`, `submissionCount=2` confirmado antes del envío), envió los mismos
  bytes con el mismo CustomID y, ante una negativa simulada, lo dejó `UNKNOWN`, sin sello nuevo.
- **POST 1 real (2026-10-21, CFDI nuevo, folio ORB-000003):** las comprobaciones previas al
  envío pasaron, pero SW respondió **HTTP 401** (`status: error`, sin CFDI ni UUID): rechazo de
  autenticación, **no hubo timbre**. El token había funcionado en los dos POST anteriores del
  mismo día; no se determinó la causa sin hacer más llamadas. Conforme a la instrucción ante un
  rechazo, **no** se hizo la reconciliación ni ningún otro envío. El intento local quedó
  `UNKNOWN` solo porque el harness ocultó el 401 (sin la inyección, el adaptador lo habría
  clasificado `FAILED / REJECTED_RETRYABLE`, `PAC_AUTH_FAILED`).
- **Repetición con token válido (2026-10-21, otro CFDI nuevo, CustomID nuevo): VALIDADA.**
  1. **Proceso A:** POST real con `stampInvoice` y el adaptador SW reales; SW timbró, el
     `transport` del harness retuvo la respuesta y lanzó `ECONNRESET` → el intento quedó
     `UNKNOWN / PAC_CONNECTION_LOST`, `submissionCount=1`, con CustomID, `requestSha256` y
     `sealedXml` persistidos antes del envío. El proceso terminó.
  2. **Proceso B (nuevo, recuperación cross-process):** recuperó el mismo intento `UNKNOWN` con
     `submissionCount=1`, el mismo CustomID, el mismo `requestSha256` y los mismos bytes
     `sealedXml`. No se reconstruyó, re-serializó ni re-firmó nada.
  3. **`reconcileStampAttempt` real**, observado antes del POST (dentro del `transport`):
     intento reclamado (`SUBMITTING`), `submissionCount=2` ya confirmado en la DB, ninguna
     transacción abierta, en el cable los mismos bytes persistidos, el mismo SHA-256 y el mismo
     CustomID.
  4. **Respuesta de SW:** HTTP 400, código SW **`307`** ("CFDI previamente timbrado") con el
     CFDI completo (UUID de 36 caracteres).
  5. **Resultado en ORBIT:** `UNKNOWN → reconcileStampAttempt → SUCCEEDED`, `resultCode`
     `PAC_PREVIOUSLY_STAMPED`, `providerCode` `307`, `submissionCount=2`, UUID y `stampedXml`
     persistidos. El UUID persistido es igual al de la respuesta de reconciliación y al del
     timbre que SW emitió en el POST 1 (misma identidad lógica: comparación interna del UUID
     completo; el UUID no se documenta). La factura sigue **READY**, no `ISSUED`;
     `satSealVerified=false`; el token no aparece en la DB ni en la auditoría.
- **Comportamiento observado:** SW respondió **`307`** (duplicado por Sello). **`CFDI3307`
  (duplicado por CustomID) NO fue el comportamiento observado** en ninguno de los dos ciclos
  reales; ORBIT lo sigue soportando según la documentación (§9) y las pruebas simuladas.
- **Conclusión:** POST real → resultado ambiguo → `UNKNOWN` → reinicio del proceso →
  `reconcileStampAttempt` real → SW `307` → mismo UUID → `SUCCEEDED` demostrado en vivo.
  `PAC_RECONCILIATION_LIVE_VALIDATED = true`.
- **Pruebas automáticas añadidas** (`tests/cfdi40-stamp-service.test.ts`, PAC simulado):
  `SUCCEEDED` y `FAILED` no se reconcilian ni se reenvían; `UNKNOWN` se reconcilia con el mismo
  CustomID y los mismos bytes, con una custodia que no puede abrir el CSD y sin evento
  `cfdi.sealed` nuevo (no se vuelve a firmar); un `requestSha256` que no corresponde a los bytes
  lo rechaza el CHECK y, sin el CHECK, el servicio (`STORED_REQUEST_CORRUPT`, nada se envía).

## 22. Pruebas

| Suite | Qué demuestra |
|---|---|
| `tests/pac-sw-adapter.test.ts` (10) | Configuración y allowlist; request exacto (URL, POST, Bearer, `customid`, multipart con los bytes exactos, `redirect: manual`, signal); clasificación de todas las respuestas documentadas; `UNKNOWN` para 5xx, redirect, JSON inválido, tipo erróneo, excesivo, truncado y éxito sin CFDI; timeout y reset después de enviar sin reintento; reintento solo sin conexión; el token nunca aparece |
| `tests/cfdi40-stamped.test.ts` (13) | Recursos TFD byte a byte y fail-closed; conjunto XSD contenedor con loads exactos; los 10 CFDI soportados verificados; re-serialización equivalente aceptada; contenido fiscal alterado rechazado; 18 problemas de TFD; XXE, DTD, entidades, comentario, CDATA, PI, XInclude, no UTF-8, malformado y excesivo; campos paralelos falsos; TFD de otro CFDI; restauración para reconciliación; sin red, archivos ni consola; gate del SelloSAT pendiente |
| `tests/cfdi40-stamp-service.test.ts` (14, PGlite) | Gates sin escrituras ni envíos; límites de la reconciliación (`SUCCEEDED`/`FAILED` terminales, sin volver a firmar, `requestSha256` desajustado falla cerrado); autorización y versión; éxito con bytes persistidos y auditoría sin secretos; idempotencia; concurrencia (dos sesiones → un intento, una llamada, un UUID); rechazos final y reintentable; `UNKNOWN` → `RECONCILIATION_REQUIRED` → reconciliación con mismos bytes y CustomID (UUID solo → sigue `UNKNOWN`; timbre completo → `SUCCEEDED`); nunca llegó; `307` por sello; rechazo en reconciliación → sigue `UNKNOWN`; respuesta inconsistente; UUID duplicado; multi-tenant (incluida FK); intentos obsoletos; fallo antes de enviar; bytes guardados alterados; CSD deshabilitado; token ausente de DB y auditoría |
| `tests/cfdi40-stamp-crash-recovery.test.ts` (1, dos procesos, PGlite persistente) | El proceso A persiste y muere al llegar la solicitud al PAC; el proceso B recupera el mismo intento, CustomID, `requestSha256` y bytes; la DB rechaza alterarlos; reconciliación sin reconstruir nada (§21.3) |
| `scripts/pac-sandbox-e2e.mjs` (6, `next start`) | Sesión y plan; contrato de estado; mismo origen, autorización y gates sin escrituras; MEMBER y otra Organization; bloqueo de edición `STAMP_IN_PROGRESS` y reversión de READY que respeta el intento activo; nada sensible en respuestas ni logs |

El SW de las pruebas es una **simulación** de las formas documentadas. El PAC real se probó
fuera de la suite (§21.1, §21.3.1 y §21.3.2) con scripts únicos que no se versionan porque necesitan el
token y el CSD del proceso. `tests/csd-crypto.test.ts` acepta el CSD oficial KIJ o EKU (fijados por
SHA-256) cuando las variables `SW_TEST_CSD_*` están presentes.

## 23. Gates

| Gate | Estado |
|---|---|
| `XSD_OFFICIAL_VALIDATION_READY` (5C.7) | true |
| `CSD_TYPE_VERIFIED` | false |
| `OFFICIAL_CSD_FIXTURE_VALIDATED` | **true**: §M.7/§M.8 sobre CSD oficiales KIJ y EKU + timbre real (§21.1); solo persona moral |
| `POSTGRES_CSD_CONCURRENCY_VALIDATED` | false |
| `productionLegalGateSatisfied` | false |
| `PAC_SANDBOX_LIVE_VALIDATED` (nuevo) | **true**: un timbre real de SW sandbox verificado de punta a punta (§21.1) |
| `PAC_RECONCILIATION_LIVE_VALIDATED` (nuevo) | **true**: `UNKNOWN` → proceso nuevo → `reconcileStampAttempt` real → SW `307` → mismo UUID → `SUCCEEDED` en vivo (§21.3.2) |
| `TFD_SAT_SEAL_VERIFIED` (nuevo) | false |
| `PAC_PRODUCTION_CREDENTIALS` (nuevo) | false |
| KMS/HSM | pendiente |
| PAC producción | **bloqueado** (no se puede construir el adaptador) |
| READY → ISSUED | pendiente (fase posterior) |

## 24. Riesgos

- Evidencia real de SW: tres timbres, dos `307` de reconciliación (uno por la ruta productiva
  `reconcileStampAttempt`) y un 401 sin timbre (§21.1, §21.3.1, §21.3.2). Los rechazos y el
  duplicado `CFDI3307` siguen basados en la documentación y el SDK (nunca observado en vivo);
  la documentación es inconsistente para el CustomID duplicado.
- Un `UNKNOWN` dentro de las 72 h del CustomID puede no resolverse hasta que expire. Requiere un
  procedimiento operativo de soporte, sin API de consulta por UUID documentada.
- Durante la reconciliación, las negativas mantienen `UNKNOWN`. Un CFDI que de verdad nunca se
  timbró puede quedar bloqueado y requerir resolución manual. Es preferible a un timbrado doble.
- `SelloSAT` no se verifica criptográficamente.
- La concurrencia en PostgreSQL real (lock `FOR UPDATE`) se demostró en PGlite, que serializa
  las transacciones.
- La comparación estructural es estricta: si SW cambiara algo no fiscal (por ejemplo, el
  `schemaLocation` raíz), el resultado sería `UNKNOWN`, no un éxito. En la prueba real SW no
  cambió nada (§21.1).
- Los textos de autorización son borradores pendientes de revisión jurídica.

## 25. Siguiente paso

1. Revisar y aplicar la migración en un entorno no productivo (no Neon hasta revisión).
3. Fuente oficial del certificado del SAT para `TFD_SAT_SEAL_VERIFIED`.
4. Fase READY → ISSUED: Document privado del XML timbrado, `StampedInvoice.uuid` e `issuedAt`
   con la fecha de timbrado, PDF, inmutabilidad y separación de sandbox.
