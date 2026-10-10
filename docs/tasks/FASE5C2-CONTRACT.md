# ORBIT NEXUS · Fase 5C.2A — Contrato de seguridad, privacidad y cumplimiento

Base técnica previa a custodiar CSD. Esta fase **no** implementa CSD, CFDI, PAC ni timbrado.

Documentos relacionados:

- `docs/legal/OPEN-LEGAL-ITEMS.md` — decisiones legales/empresariales pendientes.
- `docs/security/DATA-RETENTION.md` — retención y eliminación.
- `docs/security/INCIDENT-RESPONSE.md` — respuesta a incidentes.
- `docs/security/SUBPROCESSORS.md` — proveedores.
- `docs/security/BACKUP-RESTORE.md` — respaldos.

Este contrato describe controles técnicos. **No acredita cumplimiento legal**: la conformidad
con la legislación de protección de datos, fiscal o de consumo requiere revisión jurídica.

---

## 1. Threat model resumido

### 1.1 Activos

| Activo | Por qué importa |
|---|---|
| Datos fiscales de la Organization (RFC, régimen, domicilio, CSF) | Identidad fiscal; permite suplantación ante portales de facturación. |
| Documentos privados (tickets, CSF, CFDI XML/PDF) | Información patrimonial y de terceros. |
| Datos de clientes de la Organization | Datos personales de terceros tratados por cuenta del usuario. |
| Sesiones y cuentas | Acceso a todo lo anterior. |
| Secretos de despliegue (`BETTER_AUTH_SECRET`, `DATABASE_URL`, tokens OCR/correo/worker) | Compromiso total del servicio. |
| Futuro CSD (`.cer`, `.key`, contraseña) | Permite emitir CFDI a nombre del contribuyente. Máxima criticidad. |
| Bitácora de auditoría | Evidencia para investigación y defensa. |

### 1.2 Actores de amenaza

1. Atacante anónimo en Internet (fuerza bruta, enumeración, XSS, CSRF, SSRF, uploads maliciosos).
2. Usuario autenticado de otra Organization (fuga entre tenants, IDOR).
3. Miembro malicioso o con rol insuficiente de la misma Organization (escalamiento de privilegios).
4. Sesión robada (XSS, dispositivo comprometido, cookie expuesta).
5. Proveedor comprometido u hostil (OCR, correo, worker de automatización, portales de comercios, futuro PAC).
6. Operador o persona con acceso a infraestructura (Vercel, Neon, GitHub).
7. Cadena de suministro (dependencias npm).

### 1.3 Amenazas principales y controles

| Amenaza | Control vigente | Riesgo residual |
|---|---|---|
| Fuga entre tenants | `requireTenant` resuelve la Organization desde sesión + Membership; FKs compuestas `(organizationId, id)`; consultas siempre filtradas; E2E de aislamiento. | Errores futuros en código nuevo: toda ruta nueva debe usar `requireTenant`. |
| Robo de sesión | Cookies HttpOnly, SameSite=Lax, Secure en producción, `__Secure-` en producción, sesión en base de datos revocable, sin cookie cache. | `unsafe-inline` en CSP reduce la defensa en profundidad frente a XSS (§9). |
| CSRF | Better Auth valida Origin contra `trustedOrigins`; mutaciones propias usan `assertSameOrigin`. | — |
| Fuerza bruta / abuso | Rate limiting en base de datos (Better Auth + `RequestLimit`). | Sin límites por IP en endpoints autenticados; ver §11. |
| Uploads maliciosos | Allowlist por categoría, magic bytes, XML sin DTD, almacenamiento en base de datos con id aleatorio, descarga `attachment` con CSP `sandbox`. | Sin antivirus (§10). PDFs pueden contener JavaScript: no se ejecutan en ORBIT, pero un visor local del usuario podría hacerlo. |
| SSRF desde billing | Protecciones existentes (Fase 4): protocolos, rangos privados, redirects. | Sin cambios en esta fase. |
| Exposición en logs | Redacción central; `apiError` solo registra clase y código (§7). | Logs de plataforma (Vercel) fuera del control de ORBIT. |
| Manipulación de auditoría | `AuditEvent` append-only con trigger en base de datos. | Un administrador de base de datos puede deshabilitar el trigger. |
| Proveedor comprometido | Integraciones opcionales detrás de adapters; solo reciben datos necesarios; estados "no configurado". | Proveedores aún no identificados (SUBPROCESSORS). |
| Compromiso de CSD | No aplica: CSD no se custodia en esta fase. | Diseño de custodia pendiente (Fase 5C bloque CSD). |

---

## 2. Clasificación de datos

| Nivel | Definición | Manejo mínimo |
|---|---|---|
| `PUBLIC` | Publicable sin daño. | Puede servirse sin sesión. |
| `INTERNAL` | Operativo, sin datos personales ni fiscales; su exposición tiene impacto bajo. | Solo usuarios autenticados u operador. Puede aparecer en logs. |
| `CONFIDENTIAL` | Datos personales o de negocio de una Organization o usuario. | Solo miembros autorizados de la Organization; nunca en logs, analytics, URLs ni telemetría. |
| `FISCAL_SENSITIVE` | Identidad fiscal, documentos fiscales e importes asociados a un contribuyente. | Como CONFIDENTIAL, además: almacenamiento privado, lectura de documentos solo con consentimiento cuando aplica, auditoría de cambios, nunca en metadata de auditoría. |
| `SECRET` | Credenciales y material criptográfico. | Solo en variables de entorno o almacén de secretos; nunca en código, base de datos en claro, logs, respuestas ni Git. |

---

## 3. Inventario por categoría

| Categoría | Ejemplos | Clase | Ubicación |
|---|---|---|---|
| Contenido legal | Aviso, términos, versiones, hashes | PUBLIC | `src/lib/legal`, `GET /api/legal` |
| Catálogos SAT | `c_RegimenFiscal`, `c_UsoCFDI`, `c_CodigoPostal` | PUBLIC | `src/lib/sat/catcfdi` |
| Datos de cuenta | Nombre, correo | CONFIDENTIAL | `User` |
| Credencial de cuenta | Hash de contraseña (Better Auth) | SECRET | `Account.password` (solo hash) |
| Sesiones | Token, IP, user agent, expiración | SECRET (token) / CONFIDENTIAL (IP, UA) | `Session` |
| Tokens de verificación/restablecimiento | Enlaces de reset | SECRET | `Verification`, correo |
| Organization y membresías | Nombre, roles | CONFIDENTIAL | `Organization`, `Membership` |
| Perfil fiscal | RFC, razón social, régimen, CP, domicilio, correo fiscal | FISCAL_SENSITIVE | `FiscalProfile` |
| CSF | PDF de la Constancia | FISCAL_SENSITIVE | `Document` (`CSF`, `CLIENT_CSF`, `FISCAL`) |
| Extracción de CSF | Campos detectados | FISCAL_SENSITIVE | `FiscalDocumentExtraction` |
| Consentimientos | Versión aceptada, documento, usuario | CONFIDENTIAL | `FiscalDocumentConsent`, `LegalAcceptance` |
| CFDI XML/PDF | Comprobantes recibidos | FISCAL_SENSITIVE | `Document`, `Invoice` |
| Tickets/imágenes | Imagen o PDF de compra | FISCAL_SENSITIVE | `Document` (`TICKET`) |
| OCR bruto | Respuesta del proveedor | FISCAL_SENSITIVE | `TicketOcrAttempt` |
| Gastos | Importes, comercio, fechas | FISCAL_SENSITIVE | `Expense` |
| Clientes | RFC, nombre, contacto, domicilio | FISCAL_SENSITIVE | `Client` |
| Borradores de facturación | Conceptos, importes, snapshot del receptor | FISCAL_SENSITIVE | `StampedInvoice` (DRAFT/READY) |
| Reportes | Snapshot mensual | FISCAL_SENSITIVE | `MonthlyExpenseReport` |
| Notificaciones | Título y mensaje | CONFIDENTIAL | `Notification` |
| ActivityLog | Acción, entidad | INTERNAL/CONFIDENTIAL | `ActivityLog` |
| AuditEvent | Acción, objetivo, resultado, metadata saneada | CONFIDENTIAL | `AuditEvent` |
| Contadores de rate limit | Hash SHA-256 de la clave | INTERNAL | `RequestLimit`, `RateLimit` |
| Secretos de despliegue | `BETTER_AUTH_SECRET`, `DATABASE_URL`, tokens | SECRET | Variables de entorno de Vercel |
| Futuro CSD | `.cer`, `.key`, contraseña | SECRET | No existe en esta fase |
| Logs de aplicación | Clase y código de error | INTERNAL | Logs de Vercel |
| Analytics | No existe | — | — |
| Cookies | Sesión, organización activa, consentimiento | SECRET (sesión) / INTERNAL | Navegador |

---

## 4. Lo que JAMÁS puede aparecer

### 4.1 En logs

Contraseñas (actuales, nuevas o hash), tokens de sesión, cookies y `Set-Cookie`, encabezados
`Authorization`, tokens de restablecimiento o verificación, códigos de un solo uso, API keys y
tokens de proveedores, `DATABASE_URL` u otras cadenas con credenciales, llaves privadas y
contraseñas de CSD/e.firma, contenido de CSF, XML/PDF completos, imágenes de tickets, OCR bruto,
perfiles fiscales completos, RFC/CURP salvo imprescindible, correos y teléfonos de clientes,
mensajes de error de Prisma o del driver (incluyen SQL y valores), stack traces en producción.

### 4.2 En analytics y telemetría del cliente

Ningún dato CONFIDENTIAL, FISCAL_SENSITIVE ni SECRET; IDs de documentos, tickets, clientes u
Organizations; contenidos de formularios; textos detectados por OCR; URLs completas con IDs.
Hoy no existe analytics: cualquier integración futura requiere consentimiento de la categoría
correspondiente en `orbit.consent` y revisión de este contrato.

### 4.3 En URLs y query params

Credenciales, tokens propios, RFC, CURP, correos, nombres, importes, contenidos de documentos o
cualquier dato FISCAL_SENSITIVE. Las URLs solo llevan identificadores opacos (cuid) y filtros sin
datos personales. Excepción gestionada por Better Auth: el enlace de restablecimiento de
contraseña contiene un token de un solo uso con expiración; no debe registrarse.

### 4.4 En respuestas de error al cliente

Stack traces, SQL, mensajes de Prisma/driver, rutas internas, variables de entorno, IDs de
infraestructura. `apiError` responde mensajes curados o el genérico 503.

---

## 5. Contenido legal versionado (Bloque 2)

- Fuente única: `src/lib/legal/registry.ts` con contenido en `src/lib/legal/content/*`.
- Hechos que solo el operador puede definir: `src/lib/legal/facts.ts` (hoy todos `null`).
- Tipos compartidos: `src/types/legal.ts`.
- API pública (sin sesión):
  - `GET /api/legal` → resumen de las versiones vigentes.
  - `GET /api/legal/aviso-de-privacidad`, `GET /api/legal/terminos` → documento completo.
- Cada documento tiene `version`, `status` (`DRAFT` | `PUBLISHED`), `effectiveDate`,
  `contentHash` (SHA-256 del contenido exacto) y `pendingTopics`.
- Reglas:
  1. Un documento solo puede publicarse con todos sus hechos definidos, fecha de vigencia y
     `legalReviewApproved: true`; de lo contrario `buildLegalDocument` lanza error.
  2. Cambiar cualquier texto o hecho exige nueva versión; los tests fijan el hash por versión.
  3. Los hechos faltantes se expresan con redacción neutral; nunca `TODO`, `XXX` ni similares
     (test).
  4. El frontend debe mostrar los borradores como "versión preliminar" usando `status` y
     `pendingTopics`.
- Estado actual: ambos documentos en `DRAFT` (ver `OPEN-LEGAL-ITEMS.md`).

---

## 6. Versionado y consentimiento (Bloque 3)

| Mecanismo | Alcance | Evidencia | Versión |
|---|---|---|---|
| A. Consentimiento de tratamiento fiscal (leer una CSF) | Usuario + Organization + documento + finalidad | `FiscalDocumentConsent` | `consentVersion` del texto (Fase 5C) + `privacyNoticeVersion` |
| B. Aceptación de términos | Persona (cuenta) | `LegalAcceptance` (`TERMS`) + `AuditEvent legal.accepted` | `version` + `contentHash` |
| C. Aviso de privacidad | Persona (cuenta) | `LegalAcceptance` (`PRIVACY_NOTICE`) + `AuditEvent privacy.accepted` | `version` + `contentHash` |
| D. Preferencias de cookies | Navegador | Cookie `orbit.consent` (`version: 1`) | Versión del esquema de la cookie |

Invariantes:

1. `privacyNoticeVersion` es `null` mientras el aviso sea borrador; proviene del registro legal,
   ya no de la variable `PRIVACY_NOTICE_VERSION` (eliminada).
2. Con `VERCEL_ENV=production` o `PAC_ENVIRONMENT=PRODUCTION`, la lectura de documentos
   fiscales se bloquea mientras el aviso no esté publicado (D12, sin cambios de semántica).
3. `FiscalDocumentConsent.privacyNoticeVersion` debe coincidir con la versión vigente al crear
   el consentimiento (validación existente).
4. Solo se acepta la versión **publicada** vigente, con su hash exacto; los borradores nunca
   pueden aceptarse. Una aceptación por persona, documento y versión (`UNIQUE`), idempotente
   incluso con solicitudes concurrentes.
5. La aceptación legal es personal: no se lista en la auditoría de ninguna Organization.
6. Las preferencias de cookies no se mezclan con la cuenta. Si la política de cookies cambia
   materialmente, se incrementa la versión del esquema de `orbit.consent`; `parseConsent`
   rechaza versiones desconocidas y el banner vuelve a solicitarlas.
7. Los consentimientos existentes no cambian: no hay migración de datos.

API:

- `GET /api/legal/acceptances` → `LegalAcceptanceState[]` del usuario (requiere sesión).
- `POST /api/legal/acceptances` `{ document, version, contentHash }` → 201 nueva / 200 ya
  existente; 409 `LEGAL_DOCUMENT_NOT_PUBLISHED` o `LEGAL_VERSION_OUTDATED`. Mismo origen,
  10 solicitudes/min por usuario.

Gate de producción (pendiente de decisión, no implementado como bloqueo de uso): exigir la
aceptación de las versiones vigentes antes de usar la aplicación.

---

## 7. Auditoría (Bloque 4)

- Modelo `AuditEvent` (separado de `ActivityLog`, que sigue alimentando el feed del dashboard
  con sus nombres de acción actuales, usados por E2E y UI).
- Campos: `organizationId` (null solo en eventos de cuenta), `actorUserId`, `action`,
  `targetType`, `targetId`, `result` (`SUCCESS` | `FAILURE` | `DENIED`), `metadata` saneada,
  `createdAt`.
- Append-only: trigger `AuditEvent_append_only` rechaza `UPDATE` y `DELETE`, salvo poner
  `actorUserId` en null al borrar un usuario. La Organization usa `ON DELETE RESTRICT`.
- Catálogo `src/lib/audit.ts` (alcance, tipo de objetivo y claves de metadata permitidas):

| Acción | Alcance | Dónde se registra |
|---|---|---|
| `fiscal_profile.updated` | TENANT | `saveFiscalProfile` (nombres de campos cambiados, fuente) |
| `client.fiscal.updated` | TENANT | `saveClient` (si cambian datos fiscales), `archiveClient` |
| `csf.uploaded` | TENANT | `uploadPrivateAsset` (`CSF`, `CLIENT_CSF`) |
| `csf.extraction_requested` | TENANT | `createFiscalExtraction` (incluye `DENIED` si el consentimiento es de otro usuario) |
| `csf.confirmed` | TENANT | Guardado de perfil/cliente con `extractionId` |
| `legal.accepted` / `privacy.accepted` | ACCOUNT | `POST /api/legal/acceptances` |
| `sensitive_asset.uploaded` | TENANT | `uploadFiscalDocument` |
| `sensitive_asset.deleted` | TENANT | Definido; no existe flujo de borrado todavía |
| `csd.configured`, `csd.revoked`, `invoice.stamp_authorized`, `invoice.stamped`, `invoice.cancelled` | TENANT | **Reservados**: `recordAuditEvent` los rechaza hasta implementarlos |

- Metadata: solo claves del catálogo, valores escalares acotados (120 caracteres) o listas de
  hasta 20 textos, redactados (RFC, CURP, correo, tokens). Nunca valores de campos fiscales,
  documentos, XML, contraseñas, cookies ni tokens.
- Lectura: `GET /api/audit-events?limit=&before=` solo OWNER/ADMIN de la Organization activa;
  paginación por fecha; 60 solicitudes/min.

---

## 8. Logging y redacción (Bloque 5)

- `src/lib/security/redact.ts`: `redact`, `redactText`, `redactHeaders`, `describeError`,
  `logSafeError`.
- `apiError` registra errores inesperados como una línea JSON con `scope`, clase y código
  (Prisma, driver o SQLSTATE). Nunca mensaje, stack, SQL ni parámetros.
- Errores de upload: solo mensajes curados (`uploadApiError`); cualquier otro error es
  "Archivo inválido.".
- Auditoría de `console.*` en `src`: solo `[orbit/auth] configuration:` con códigos fijos de
  configuración. Better Auth tiene su logger deshabilitado.

---

## 9. Uploads (Bloque 6)

| Categoría | Tipos | Máximo | Controles adicionales |
|---|---|---|---|
| `TICKET` | JPEG, PNG, WEBP, PDF | 10 MB | QR con `sharp` y límite de píxeles |
| `FISCAL_DOCUMENT` | JPEG, PNG, WEBP, PDF, XML | 10 MB (XML 1 MB) | XML debe ser CFDI 4.0 |
| `CSF`, `CLIENT_CSF` | PDF | 10 MB | `pdf-lib` exige PDF legible no cifrado |
| `INVOICE_LOGO` | PNG, WEBP | 2 MB | Transparencia, ≤ 2000×2000 px |
| `RECEIVED_CFDI_XML` | XML | 10 MB | Parser sin entidades; validación CFDI |
| `RECEIVED_CFDI_PDF` | PDF | 10 MB | — |

Comunes: tipo declarado, extensión y magic bytes deben coincidir; sin SVG, HTML ni formatos
activos; XML en UTF-8 estricto, sin `DOCTYPE`, `ENTITY`, `ELEMENT`, `ATTLIST` ni NUL; nombre
original solo como nombre visible saneado (sin `/`, sin punto inicial); almacenamiento en base de
datos con clave `db:<cuid>`; descarga solo con sesión y Organization, `attachment` (inline solo
para imágenes con `preview=1`), `nosniff`, CSP `default-src 'none'; sandbox`, `no-store`.

Antivirus: frontera `src/lib/security/malware-scan.ts`. Sin proveedor, el estado es
`NOT_CONFIGURED` (nunca `CLEAN`) y se registra en la auditoría del upload. `INFECTED` rechaza con
422 y `ERROR` con 503. Integrar un proveedor requiere decisión (SUBPROCESSORS).

`FISCAL_DOCUMENT` conserva imágenes por compatibilidad con la UI actual; restringirlo a PDF/XML
requiere coordinar con Codex.

---

## 10. Headers de seguridad (Bloque 7)

Definidos en `src/lib/security/headers.ts` y aplicados por `next.config.ts` (se resuelven en
build):

| Header | Valor | Dónde |
|---|---|---|
| `Content-Security-Policy` | `default-src 'self'`; `script-src 'self' 'unsafe-inline'`; `style-src 'self' 'unsafe-inline'`; `img-src 'self' blob: data:`; `font-src 'self'`; `connect-src 'self'`; `media-src 'self' blob: mediastream:`; `worker-src 'self'`; `frame-src 'none'`; `object-src 'none'`; `base-uri 'self'`; `form-action 'self'`; `frame-ancestors 'none'`; `upgrade-insecure-requests` solo en HTTPS | Páginas |
| `Content-Security-Policy` | `default-src 'none'; frame-ancestors 'none'; sandbox` | `/api/*` |
| `Strict-Transport-Security` | `max-age=63072000` | Solo `VERCEL_ENV=production` |
| `X-Content-Type-Options` | `nosniff` | Todo |
| `X-Frame-Options` | `DENY` | Todo |
| `Referrer-Policy` | `strict-origin-when-cross-origin`; `no-referrer` en privado | Público / `/api`, `/dashboard` |
| `Permissions-Policy` | `camera=(self), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()` | Todo |
| `Cross-Origin-Opener-Policy` | `same-origin` | Todo |
| `Cross-Origin-Resource-Policy` | `same-origin` | `/api`, `/dashboard` |
| `Cache-Control` | `private, no-store` | `/api`, `/dashboard` |

Sin `unsafe-eval` en producción (solo en desarrollo, para depuración de React).

**Deuda técnica:** `'unsafe-inline'` en `script-src` y `style-src`. Next inserta scripts inline
de arranque; eliminarlo requiere un nonce por solicitud en `proxy.ts`, lo que obliga a renderizar
dinámicamente todas las páginas (incluida la landing estática), o SRI experimental. Los estilos
inline de React/animaciones necesitan `style-src 'unsafe-inline'`. Revisar antes de CSD.

`includeSubDomains` y `preload` en HSTS requieren decidir el dominio definitivo.

---

## 11. Sesiones y cookies (Bloque 8)

Auditoría de Better Auth (`src/lib/auth.ts`) y cookies propias:

| Control | Estado |
|---|---|
| HttpOnly | Sí (`defaultCookieAttributes.httpOnly`) |
| Secure | En producción (`NODE_ENV=production`), prefijo `__Secure-` |
| SameSite | `Lax` |
| Expiración | 7 días, renovación diaria (`updateAge` 1 día) |
| Revocación | Sesiones en base de datos; `cookieCache` deshabilitado: cerrar sesión revoca de inmediato |
| Reset de contraseña | Revoca todas las sesiones (`revokeSessionsOnPasswordReset`) |
| Cambio de contraseña | Requiere contraseña actual; la UI envía `revokeOtherSessions: true` (`user-settings.tsx`), así que las demás sesiones se revocan. Es una decisión del cliente: el servidor no lo impone |
| CSRF | Origin validado por Better Auth y `assertSameOrigin` |
| Rotación | Nuevo token en cada inicio de sesión |
| `orbit.organization` | HttpOnly, SameSite=Lax, Secure en producción; preferencia, nunca autorización |
| `orbit.consent` | Legible por JavaScript (necesario), sin datos personales |

Sin cambios de configuración en esta fase.

---

## 12. Rate limiting (Bloque 9)

Ambos mecanismos usan PostgreSQL (Neon en producción) y son seguros en serverless: no hay
contadores en memoria.

| Mecanismo | Endpoints | Límite |
|---|---|---|
| Better Auth (`RateLimit`, por IP) | `sign-in/email`, `sign-up/email` | 5/min |
|  | `request-password-reset` | 3/5 min |
|  | resto de `/api/auth/*` (reset, cambio de contraseña) | 30/min |
| `enforceRateLimit` (`RequestLimit`, por usuario) | Uploads de tickets / OCR | 20/h cada uno |
|  | Documento fiscal / archivos privados / import de CFDI | 10/h, 15/h, 15/h |
|  | Extracción de CSF / consentimiento | 10/min / 30/min |
|  | Billing prepare/submit/collect | 15/h, 15/h, 20/h |
|  | Borradores, conceptos, clientes, catálogos | 30–120/min |
|  | Exportación de reportes (nuevo) | 60/h |
|  | Aceptación legal (nuevo) / lectura de auditoría (nuevo) | 10/min / 60/min |

Abstracción: `src/lib/security/rate-limit.ts` (`RateLimitStore`, implementación Postgres con
upsert atómico, probada con concurrencia).

Pendiente/recomendación:

1. Better Auth identifica la IP por `x-forwarded-for`; en Vercel es confiable. Verificar en
   producción que el límite por IP funciona (en local la IP puede faltar).
2. Considerar Vercel Firewall (rate limiting en el borde) para login y endpoints públicos
   **antes** de lanzar; es configuración de plataforma, no se activó.
3. Futuro timbrado: límite por usuario **y** por Organization, más idempotencia por borrador.
4. Limpieza periódica de filas expiradas en `RequestLimit` (no crece sin límite: la clave se
   reutiliza, pero conviene un job).

No se agregó ningún proveedor (Redis/KV).

---

## 13. Producción vs sandbox

| Condición | Desarrollo/preview | Producción |
|---|---|---|
| Aviso de privacidad | Puede ser borrador | Debe estar publicado; si no, la lectura fiscal responde `PRIVACY_NOTICE_MISSING` |
| Términos | Borrador | Deben publicarse antes del lanzamiento (gate pendiente de implementar) |
| PAC | Fake solo en tests (D7) | Fuera de alcance |
| CSD | No existe | No existe |
| Antivirus | `NOT_CONFIGURED` | Decisión pendiente (OPEN-LEGAL-ITEMS / SUBPROCESSORS) |
| HSTS / `upgrade-insecure-requests` | No | Sí (build con `VERCEL_ENV=production`) |
| Datos | Sintéticos, PGlite local | Neon; nunca usar datos reales en pruebas |

---

## 14. Migración

`prisma/migrations/202610090001_phase5c2_legal_security/migration.sql`: aditiva. Crea los enums
`AuditResult` y `LegalDocumentKind`, las tablas `AuditEvent` y `LegalAcceptance` con sus índices
y FKs, y el trigger append-only. No modifica tablas ni columnas existentes. Probada en PGlite;
**no aplicada en Neon**.

---

## 15. Dependencias con Codex (frontend)

1. Renderizar `/privacy` y `/terms` desde `GET /api/legal/*` (o importando el registro en server
   components) en lugar del texto actual, mostrando el estado de borrador con `pendingTopics`.
   El texto actual de `/privacy` dirige al usuario a que "el operador debe completar su aviso";
   debe reemplazarse.
2. UI de aceptación de términos y aviso usando `GET/POST /api/legal/acceptances` cuando haya
   versiones publicadas.
3. Visor de auditoría para OWNER/ADMIN (`GET /api/audit-events`), opcional.
4. Mantener `revokeOtherSessions: true` en el cambio de contraseña (hoy lo envía la UI).
5. Coordinar la restricción de `FISCAL_DOCUMENT` a PDF/XML.
