# ORBIT NEXUS · CSF del cliente antes de crearlo (pre-creación)

Estado: backend y contrato implementados (rama `claude/fix-client-csf-blockers`). La UI
corresponde a Codex (§11). Sin migración. Sin cambios en CSD, PAC, timbrado ni en el gate
legal del Aviso de Privacidad.

## 1. Problema

Antes: crear cliente → guardar → obtener `clientId` → adjuntar CSF → leer. La CSF existe
precisamente para facilitar la captura del cliente (FASE5C §10, §10.5), así que debe poder
cargarse y leerse **antes** de que exista el cliente.

## 2. Arquitectura elegida: el `Document` privado es el recurso temporal

No hay tabla nueva. Los modelos existentes ya tienen todo lo necesario:

| Necesidad | Dónde vive |
|---|---|
| Archivo privado, MIME/firma/tamaño, análisis de malware | `Document` (`kind = CLIENT_CSF`), mismo `uploadPrivateAsset` |
| Organización y usuario dueños | `Document.organizationId`, `Document.uploadedById` |
| Expiración | `Document.createdAt` + 24 h (`precreationCsfTtlMs`) |
| Autorización de lectura sin cliente | `FiscalDocumentConsent` con `clientId = null` (la columna ya era opcional) |
| Lectura sin cliente | `FiscalDocumentExtraction` con `clientId = null` (sin FK; ya era opcional) |
| Vínculo final | `Client.csfDocumentId` y `Client.sourceExtractionId` (FK existentes) |
| Consumo único | `Client.csfDocumentId` + bloqueo `FOR UPDATE` del `Document`; `Extraction.clientId` pasa de `null` al nuevo cliente (compare-and-set) |
| Auditoría de borrado | acción existente `sensitive_asset.deleted` (`kind`, `reason`) |

Por qué: el documento ya se guardaba de forma privada al subirlo, con todos los controles;
añadir una tabla de "temporales" duplicaría el almacenamiento, el escaneo y el aislamiento.
Ningún `CHECK`, trigger ni FK impide filas de consentimiento o extracción de cliente con
`clientId = null` (migración 5C revisada).

### Referencia opaca

`precreationCsfReference = "v1.<documentId>.<HMAC-SHA256>"`, con clave derivada por HKDF de
`BETTER_AUTH_SECRET` solo para este propósito (`client-csf-precreation-reference/v1`) y
firmada sobre Organización + usuario + documento (`src/lib/csf/precreation.ts`).

- No predecible ni falsificable sin el secreto; no contiene Organización ni usuario.
- Solo funciona para el usuario y la Organización que subieron el archivo.
- No se guarda; no es una URL ni da acceso al archivo (`/api/documents/<referencia>` → 404).
- Cada uso vuelve a comprobar en base de datos: dueño, no vinculado, no vencido.
- Rotar `BETTER_AUTH_SECRET` invalida las referencias pendientes (se vuelve a cargar).

## 3. Migración

No requiere migración. Solo cambia código de servicios, rutas y tipos.

## 4. Endpoints y contrato

Se reutilizan las rutas existentes; ninguna nueva.

| Paso | Ruta | Cambio |
|---|---|---|
| A. Seleccionar/subir | `POST /api/private-assets` multipart `{ kind: "CLIENT_CSF", file }` | La respuesta añade `precreationCsfReference` y `expiresAt` (solo `CLIENT_CSF`) |
| B. Autorizar | `POST /api/fiscal-consents` | `CLIENT_FISCAL_PREFILL` acepta `newClient: true` en lugar de `clientId` (exactamente uno) |
| C. Leer | `POST /api/fiscal-extractions { consentId }` y `GET /api/fiscal-extractions/[id]` | Con consentimiento de cliente nuevo: `clientId: null`, `comparison: []`, `precreationCsfReference` |
| D. Crear cliente | `POST /api/clients` | Acepta `precreationCsfReference` (+ `extractionId` opcional, + `confirmed: true` obligatorio) |

Tipos publicados (`src/types/fiscal-identity.ts`): `PrivateAssetUploadResponse`
(`precreationCsfReference?`, `expiresAt?`), `CreateFiscalConsentRequest` (`newClient?: true`),
`FiscalExtractionResult` (`precreationCsfReference?`), `FiscalConfirmation`
(`precreationCsfReference?`). Todo es aditivo: los clientes existentes no cambian.

`PATCH /api/clients/[id]` con `precreationCsfReference` → 400 `PRECREATION_CSF_NOT_ALLOWED`
(el flujo de cliente existente sigue igual, con `clientId`). Las rutas de clientes ahora
devuelven `code` en errores codificados (`codedApiError`); los demás errores no cambian.

## 5. Ciclo de vida de la CSF temporal

| Estado | Condición | Quién puede usarla |
|---|---|---|
| PENDIENTE | `CLIENT_CSF`, no vinculada a ningún cliente, < 24 h | Solo quien la subió: descargarla, autorizar, leer y vincular |
| VINCULADA | `Client.csfDocumentId` apunta a ella (o se usó para un cliente existente) | Documento normal del cliente, para la Organización |
| VENCIDA | PENDIENTE con 24 h o más | Nadie: lectura, vínculo y descarga → 410/404 |
| BORRADA | VENCIDA y nunca vinculada | Se elimina con sus consentimientos y lecturas |

Limpieza: `purgeAbandonedClientCsf` (`src/services/client-csf-precreation.ts`) borra hasta 20
CSF abandonadas por llamada, la más antigua primero, bajo bloqueo y con re-verificación (un
vínculo concurrente gana), y audita cada borrado (`sensitive_asset.deleted`, motivo
`PRECREATION_EXPIRED`, sin contenido). Se ejecuta en cada carga de CSF de cliente de
cualquier Organización. Recomendado (no incluido, requiere decisión de despliegue): un job
programado que también la invoque, para no depender de nueva actividad.

Abandono del formulario: nada se crea; la CSF queda PENDIENTE hasta vencer y después se
borra. Un error al crear el cliente revierte toda la transacción y la CSF sigue PENDIENTE
(se puede corregir y reintentar sin volver a subirla).

## 6. Privacidad (gate legal intacto)

El gate `PRIVACY_NOTICE_MISSING` (Aviso de Privacidad no publicado y `VERCEL_ENV=production`
o `PAC_ENVIRONMENT=PRODUCTION`) sigue aplicando exactamente igual a autorizar y leer.

| Operación | Producción hoy (Aviso en borrador) |
|---|---|
| A. Seleccionar y subir la CSF (validación, firma, tamaño, escaneo) | Permitida |
| B. Almacenamiento temporal privado + referencia | Permitido |
| D. Crear el cliente con captura manual y vincular la CSF | Permitido |
| C1. Registrar la autorización de lectura (`/api/fiscal-consents`) | Bloqueado: 503 `PRIVACY_NOTICE_MISSING` |
| C2. Leer/extraer (`/api/fiscal-extractions`), aun con autorización previa | Bloqueado: 503 `PRIVACY_NOTICE_MISSING` |

No se publicó el Aviso. Sin datos fiscales en analytics; ningún PDF ni valor extraído en logs
(solo clase y código del error).

## 7. Extracción

Mismo parser y versión que hoy. Se devuelven solo valores realmente leídos (`value: null` y
`status: "NOT_FOUND"` en lo demás): RFC, nombre o razón social, código postal, domicilio y
regímenes (todos los detectados, sin elegir uno). Uso CFDI, correo, teléfono y forma de pago
nunca se infieren. Un PDF sin texto legible devuelve `UNREADABLE` con todo en `null` y un
mensaje. Para un cliente nuevo no hay comparación (antes caía por error a compararse con el
Perfil Fiscal del emisor; corregido). Los datos detectados se guardan tal como se leyeron;
lo que el usuario corrige vive solo en el cliente.

## 8. Vínculo al crear el cliente

En una sola transacción de `saveClient`:

1. verifica la referencia (HMAC, Organización y usuario de la sesión);
2. bloquea el `Document` (`SELECT … FOR UPDATE`) y comprueba que sigue PENDIENTE;
3. si llega `extractionId`, comprueba que es la lectura de ese documento, de ese usuario y
   aún sin cliente;
4. crea el cliente con los datos enviados por el usuario (`confirmedAt`, `csfDocumentId`,
   `sourceExtractionId`);
5. marca la lectura con el nuevo `clientId` (si ya tenía uno, falla y todo se revierte);
6. registra auditoría (`client.fiscal.updated`, `csf.confirmed` si hubo lectura).

El archivo no se vuelve a subir: el cliente apunta al mismo `Document`. Dos creaciones
simultáneas con la misma referencia producen un cliente y un 409.

## 9. Errores (código estable · HTTP)

| Caso | Respuesta |
|---|---|
| PDF inválido, no PDF, PDF dañado | 400 en la carga; no se guarda nada ni hay referencia |
| PDF cifrado | 400 "Sube una constancia PDF válida, no cifrada, de hasta 10 MB." |
| PDF demasiado grande | 400/413; no se guarda nada |
| PDF sin texto / parser sin datos | 201 `status: "UNREADABLE"`, valores `null`, `message` |
| Aviso de Privacidad no publicado (producción) | 503 `PRIVACY_NOTICE_MISSING` al autorizar o leer |
| `CLIENT_FISCAL_PREFILL` sin `clientId` ni `newClient` | 400 `CLIENT_REQUIRED` |
| `clientId` y `newClient` a la vez | 400 `CLIENT_NOT_ALLOWED` |
| Referencia vencida | 410 `PRECREATION_CSF_EXPIRED` (autorizar, leer, crear) |
| Referencia de otra Organización, de otro usuario, falsificada o documento inexistente | 404 `PRECREATION_CSF_NOT_AVAILABLE` (otra Organización al autorizar: 404 `DOCUMENT_NOT_AVAILABLE`) |
| Referencia ya usada | 409 `PRECREATION_CSF_CONSUMED` |
| `extractionId` que no es de esa CSF/usuario o ya usado | 404 `EXTRACTION_NOT_AVAILABLE` |
| Referencia en `PATCH` | 400 `PRECREATION_CSF_NOT_ALLOWED` |
| Falta `confirmed: true` o datos inválidos al crear | 400 con `fields`; no se crea cliente y la CSF sigue PENDIENTE |

## 10. Pruebas

- `tests/client-csf-precreation.test.ts`: referencia ligada a Organización/usuario/documento,
  no falsificable, sin identificadores en claro, clave de propósito único; TTL de 24 h.
- `tests/client-csf-precreation-e2e.mjs` (servidor local real, PGlite efímero, datos
  sintéticos): carga antes del cliente, privacidad de la carga pendiente, PDF inválido,
  cifrado y grande; autorización y lectura sin cliente, datos devueltos, aislamiento por
  usuario y Organización; creación con correcciones del usuario, vínculo correcto, lectura sin
  alterar, carrera de dos creaciones, reutilización, referencia ajena o falsificada, PATCH;
  PDF ilegible; vencimiento y limpieza auditada; sin CSD; y el mismo flujo servido como
  producción (carga y vínculo permitidos, autorizar y leer → `PRIVACY_NOTICE_MISSING`).

## 11. Contrato de UI para Codex

La UI actual todavía deshabilita la CSF de un cliente nuevo ("Guarda primero el cliente").
Codex reemplaza ese comportamiento con:

```
[ icono upload ] Subir constancia            ← input file .pdf, ≤ 10 MB
PDF seleccionado: nombre-del-archivo.pdf      ← fileName de la carga
[ ] Declaro que cuento con facultades…        ← texto de GET /api/fiscal-consents/terms
[ Leer y prellenar constancia ]
Datos fiscales y de contacto                  ← campos autorrellenados, editables
[ ] Revisé y confirmo que los datos fiscales del cliente son correctos.
[ Guardar cliente ]
```

Secuencia en "Crear cliente" (sin `clientId`):

1. `POST /api/private-assets` `{ kind: "CLIENT_CSF", file }` → guardar en estado
   `{ id, fileName, precreationCsfReference, expiresAt }` (nunca en `localStorage`).
2. Al pulsar "Leer y prellenar": `POST /api/fiscal-consents`
   `{ documentId: id, purpose: "CLIENT_FISCAL_PREFILL", newClient: true, accepted: true, consentVersion, privacyNoticeVersion }`
   → `POST /api/fiscal-extractions { consentId }` → `GET /api/fiscal-extractions/[id]`.
   Validar `result.clientId === null` y `result.documentId === id`.
3. Prellenar solo campos con `value !== null`: `rfc`, `legalName`, `postalCode`, domicilio;
   `personType` cuando venga detectado. Regímenes: mostrar todos y exigir elección explícita.
   No tocar Uso CFDI, correo, teléfono ni forma de pago.
4. `POST /api/clients` con los valores visibles (corregidos por el usuario) +
   `confirmed: true` + `precreationCsfReference` + `extractionId` (si hubo lectura). Sin
   lectura (p. ej. producción con el Aviso pendiente) se envía solo la referencia: la CSF
   queda vinculada y los datos son captura manual.
5. Éxito → cerrar, "✓ Información guardada correctamente", refrescar lista (ya existente).

Errores a mostrar (por `code`):

- `PRIVACY_NOTICE_MISSING`: "La lectura automática no está disponible todavía; captura los
  datos manualmente. La constancia se guardará con el cliente."
- `PRECREATION_CSF_EXPIRED`: pedir volver a cargar la constancia o guardar sin ella (quitar la
  referencia del estado).
- `PRECREATION_CSF_CONSUMED` / `PRECREATION_CSF_NOT_AVAILABLE`: quitar la referencia del estado
  y pedir cargarla de nuevo.
- `400` con `fields`: marcar campos; conservar la captura y la referencia.

Reglas: no autoprocesar al subir; la casilla de autorización inicia desmarcada; cambiar de
archivo limpia la lectura previa; cancelar el formulario solo descarta el estado local (el
backend vence y borra la CSF). Editar un cliente existente sigue usando `clientId` como hoy.
