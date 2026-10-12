# ORBIT NEXUS · Fase 5C.3 — Contrato técnico de seguridad del CSD

Contrato compartido entre Claude (backend/seguridad) y Codex (UI/UX). Define cómo ORBIT
recibe, valida, custodia, usa y retira el Certificado de Sello Digital (CSD) de una
Organization, y deja preparada la etapa siguiente (CFDI 4.0 sellado por ORBIT y timbrado
por el PAC).

Base: `origin/main` en `21c8053`. Este documento **extiende** `FASE5C-CONTRACT.md` (§5, §12,
§13, §16, §23, §25, §27.8, §28, §35.2, §36, §37) y `FASE5C2-CONTRACT.md`. Donde este contrato
precisa algo que aquellos dejaban abierto, prevalece este documento; cualquier otro conflicto
se resuelve con la regla de `FASE5C-CONTRACT.md` §37.2: **seguridad e integridad fiscal**.

Cambiar este contrato sigue `FASE5C-CONTRACT.md` §37.1: detenerse y reportar; no editarlo en
silencio.

Estado: **Bloque 0 — solo contrato.** No hay código funcional, migración ni dependencia nueva.

---

## Decisiones cerradas (resumen)

1. El usuario entrega una sola vez `.cer`, `.key` y contraseña. La contraseña solo abre la llave
   durante la configuración y se descarta; jamás se persiste ni se registra.
2. La llave privada se normaliza a PKCS#8 (DER, sin cifrado de contraseña) **solo en memoria**
   y se guarda cifrada con envelope encryption AES-256-GCM; nunca en claro.
3. `CsdKeyProvider` desacoplado; master key (KEK) fuera de la base de datos; sin key por
   defecto. Se distingue **ambiente de hosting** (development/preview/production de Vercel)
   de **ambiente fiscal** (SANDBOX/PRODUCTION). El provider de variables de entorno (`env`) se
   permite en desarrollo, pruebas y fiscal SANDBOX —también si ese SANDBOX corre en un
   deployment de Vercel production— y **solo custodia CSD de prueba**. Se bloquea con
   `PAC_ENVIRONMENT=PRODUCTION`, con un CSD productivo real y para timbrado fiscal real.
   Fiscal PRODUCTION exige un provider externo equivalente a KMS/HSM, sin fallback
   automático a `env` (§G, §Z).
4. Solo OWNER y ADMIN configuran, sustituyen, deshabilitan e inician timbrado. Configurar,
   sustituir y deshabilitar exigen **autenticación reciente** (ventana configurable, 15 minutos
   por defecto, §D.1). Configurar el CSD no autoriza facturas: cada timbrado requiere
   autorización explícita, sin volver a pedir la contraseña de la `.key`.
5. El CSD pertenece a una Organization y solo se resuelve con `organizationId` del servidor.
6. Se valida localmente solo lo demostrable; `csdTypeVerifiedLocally: false` mientras no exista
   una propiedad oficial documentada que distinga CSD de e.firma.
7. Estados: se mantiene el `CsdStatus` publicado para el estado efectivo (`VALID` es el único
   que permite firmar). El ciclo de vida persistido es `ACTIVE | REPLACED | DISABLED`;
   `EXPIRED` e `INVALID` se calculan y nunca se persisten.
8. Un CSD vencido no firma, se presenta como `EXPIRED` y **no** se destruye automáticamente;
   sigue cifrado hasta que se sustituya o deshabilite. Al sustituir o deshabilitar se destruye
   el ciphertext de la llave en la misma transacción y solo se conserva metadata que no permite
   reconstruirla.
9. ORBIT construye el XML, genera la cadena original, sella con el CSD y verifica el sello. El
   PAC (SW sapien / SmarterWEB) **solo timbra el XML previamente sellado**; no se usan
   "Emisión Timbrado", "Emisión Timbrado JSON" ni ningún servicio en el que SW custodie o selle
   con el CSD (§AA).
10. SANDBOX usa **solamente** CSD de prueba. Nunca: un CSD productivo de un cliente como
    fixture, una llave real en el repositorio, secretos reales en tests ni certificados
    productivos en CI (§M, §Z.6).
11. `STAMPING_ENABLED=false` por defecto, separación SANDBOX/PRODUCTION y entitlement por
    Organization.
12. Pantalla única de administración del CSD: `/dashboard/stamping`. Perfil Fiscal e Invoice
    Studio solo muestran estado/resumen y enlace a esa página.
13. Auditoría con el estilo del catálogo de Fase 5C.2: `csd.configuration.started`,
    `csd.configured`, `csd.configuration.failed`, `csd.replaced`, `csd.disabled` (§Q). No se
    crea un segundo estilo en mayúsculas.
14. ORBIT ejecuta la **XSLT oficial del SAT** para producir la cadena original; nunca una
    reimplementación manual de sus reglas en producción. Ningún motor XSLT está aprobado: el
    único candidato vigente (`@tradik/xslt-processor`) queda **a auditar** con el gate
    obligatorio de §AA.5. Si ningún motor permisivo lo pasa, la fase se detiene (§AA.5).
15. El Aviso de Privacidad no se modifica en esta fase; el Legal Production Gate (§AB) lista lo
    que deberá reflejar.

---

## A. Threat model del CSD

### A.1 Activo

El CSD permite emitir CFDI **a nombre del contribuyente**. Su compromiso equivale a poder
facturar por él. La llave privada es material `SECRET` (FASE5C2 §2) de máxima criticidad.

### A.2 Actores y amenazas

| # | Actor / vector | Amenaza | Control |
|---|---|---|---|
| T1 | Miembro de otra Organization | Leer o usar el CSD ajeno (IDOR, id adivinado) | Resolución solo por `organizationId` de sesión; FK compuestas; AAD con `organizationId`; tests cross-tenant |
| T2 | MEMBER de la misma Organization | Configurar, sustituir, deshabilitar o timbrar | OWNER/ADMIN server-side; auditoría `DENIED` |
| T3 | Atacante con sesión robada de un ADMIN | Sustituir el CSD por uno propio, deshabilitarlo o timbrar | Autenticación reciente para configurar/sustituir/deshabilitar (§D.1); timbrado exige autorización por factura; auditoría; rate limiting |
| T4 | Fuerza bruta de contraseña vía API | Adivinar la contraseña de una `.key` robada | Rate limiting por usuario y Organization; la `.key` original no se guarda; error estable sin detalle |
| T5 | Volcado o lectura de la base (Neon, backup) | Obtener la llave | Ciphertext AES-256-GCM; KEK fuera de la base; tabla separada; AAD; sin contraseña almacenada |
| T6 | Fuga por logs, errores, auditoría, analytics | Contraseña, llave, PEM/DER, mensajes de OpenSSL | Redacción central; códigos estables; ruta excluida de analytics; metadata de auditoría con allowlist |
| T7 | Fuga por respuestas HTTP / descargas | Exponer ciphertext, IV, tag o llave | DTOs con allowlist; sin endpoint de descarga; no usar `Document` genérico |
| T8 | Sustitución de ciphertext entre filas/tenants | Usar la llave de otra Organization | AAD vincula `organizationId`, id del CSD, huella del certificado y ambiente |
| T9 | Compromiso de la KEK | Descifrar todas las llaves con un dump | KEK por ambiente; rotación; provider `env` solo para CSD de prueba en desarrollo, pruebas y fiscal SANDBOX; fiscal PRODUCTION exige KMS/HSM equivalente (§G, §Z); procedimiento de incidente |
| T10 | Uso accidental en producción | CFDI real emitido por un test o sandbox | Doble llave: flag global + entitlement por Organization + ambiente del CSD; fake PAC solo en tests |
| T11 | e.firma entregada por error | Custodiar material que no corresponde | Texto UI explícito; `csdTypeVerifiedLocally: false`; nunca solicitar e.firma; PAC/SAT como autoridad final |
| T12 | Certificado vencido / RFC distinto | Sellos inválidos o a nombre de otro RFC | Validación de vigencia y RFC al configurar **y** al firmar (fail closed) |
| T13 | Carrera entre sustitución y firma | Firmar con un CSD ya retirado | Bloqueo por Organization; la firma relee el estado del CSD en la misma transacción lógica |
| T14 | Dependencias criptográficas | Implementación casera o librería vulnerable | Solo `node:crypto` (OpenSSL); dependencias revisadas (§AA.5) |
| T15 | Memoria del proceso | Llave/contraseña residentes en memoria | Vida mínima; buffers sobrescritos al terminar; sin caché de llaves descifradas |

### A.3 Riesgos residuales aceptados en esta fase

- `string` de JavaScript no puede borrarse de memoria: la contraseña vive solo durante la
  solicitud de configuración.
- La autenticación reciente se basa en la antigüedad de la sesión (inicio de sesión con
  contraseña); un segundo factor queda como mejora futura (§AB.6).
- KEK en variable de entorno, aceptable solo para CSD de prueba en desarrollo, pruebas y
  fiscal SANDBOX (§G.1).

---

## B. Modelo de dominio

| Concepto | Descripción |
|---|---|
| `CsdCertificate` | Registro de un CSD configurado en una Organization: metadata pública del certificado, estado del ciclo de vida, ambiente y procedencia. Contiene el certificado público (DER), nunca la llave. |
| `CsdPrivateKey` | Envelope cifrado de la llave privada (PKCS#8), 1:1 con un `CsdCertificate` **activo**. Tabla separada para que ninguna consulta de metadata pueda seleccionarla por accidente. Se elimina al dejar de estar activo (crypto-shredding lógico, §L). |
| CSD efectivo de la Organization | El único `CsdCertificate` `ACTIVE` de la Organization, evaluado con vigencia, RFC del Perfil Fiscal y disponibilidad del KeyProvider. |
| `CsdKeyProvider` | Envuelve/desenvuelve claves de datos (DEK) con la KEK. Hoy: variables de entorno. Mañana: KMS/HSM. |
| `CsdVault` (servicio) | Única pieza que cifra y descifra la llave. Expone "sellar con el CSD activo"; **nunca** expone la llave. |
| Consentimiento de custodia | Texto versionado que el OWNER/ADMIN acepta al configurar; su versión se guarda en el `CsdCertificate`. |

El certificado público **no** es secreto, pero contiene el RFC del contribuyente: se trata como
`FISCAL_SENSITIVE`. La llave descifrada es `SECRET` y solo existe en memoria del proceso
durante la configuración o la firma.

Una Organization tiene **como máximo un CSD activo**. Múltiples CSD por sucursal o serie
quedan fuera de alcance (§AE).

---

## C. Estados

### C.1 Ciclo de vida persistido (backend, no compartido)

```
CsdCertificateStatus = ACTIVE | REPLACED | DISABLED
```

| Estado | Significado | Llave cifrada |
|---|---|---|
| `ACTIVE` | CSD vigente de la Organization (máximo uno). | Existe |
| `REPLACED` | Sustituido por otro CSD; se conserva metadata para auditoría e historial. | Eliminada en la misma transacción |
| `DISABLED` | Retirado por un OWNER/ADMIN sin sustituto. | Eliminada en la misma transacción |

Un `REPLACED` o `DISABLED` nunca vuelve a `ACTIVE`: reactivar exige volver a cargar `.cer`,
`.key` y contraseña.

### C.2 Estado efectivo (compartido: `CsdStatus` publicado)

Se conserva el tipo publicado en `src/types/fiscal-identity.ts`:

| `CsdStatus` | Cuándo lo devuelve el backend |
|---|---|
| `NOT_CONFIGURED` | No hay CSD `ACTIVE` (nunca configurado, o deshabilitado). |
| `VALIDATING` | **El backend nunca lo devuelve**: la configuración es síncrona. Es un estado local de la UI mientras envía la solicitud. |
| `VALID` | `ACTIVE`, dentro de vigencia, RFC igual al del Perfil Fiscal, KeyProvider disponible y la versión de KEK de la fila disponible. **Único estado que habilita firma.** |
| `EXPIRED` | `ACTIVE` con `validTo` ≤ ahora (derivado; no se persiste). |
| `INVALID` | `ACTIVE` pero inutilizable por otra causa: certificado aún no vigente, RFC del Perfil Fiscal cambió, KeyProvider no disponible, versión de KEK ausente o fallo de integridad al descifrar. La causa va en `invalidReason` (§P). |

Decisión: no se persisten `CONFIGURING`/`VALIDATING`/`INVALID` porque la configuración es
síncrona y los intentos rechazados no crean filas (solo auditoría). `EXPIRED` e `INVALID` se
calculan sobre el certificado y la validación en cada lectura, se vuelven a evaluar al firmar y
nunca son estados del ciclo de vida.

`StampBlockingReason` (publicado en `src/types/stamping.ts`) usa `CSD_NOT_VALID` para todo
`CsdStatus` distinto de `VALID`.

---

## D. Permisos

| Acción | OWNER | ADMIN | MEMBER |
|---|---|---|---|
| Ver estado efectivo (`GET /api/csd`) | Sí | Sí | No (403; la UI muestra un aviso sin detalles). Coincide con la ruta publicada en `fiscal-identity.ts` |
| Ver historial | Sí | Sí | No |
| Configurar / sustituir | Sí, con autenticación reciente | Sí, con autenticación reciente | No (403, auditoría `DENIED`) |
| Deshabilitar | Sí, con autenticación reciente | Sí, con autenticación reciente | No (403, auditoría `DENIED`) |
| Iniciar timbrado (fase CFDI) | Sí | Sí | No |

Siempre server-side con `requireTenant()`; nunca un `organizationId` del cliente. La UI puede
ocultar acciones, pero el backend es la autoridad.

### D.1 Autenticación reciente

- Configurar, sustituir y deshabilitar exigen que la sesión actual provenga de un inicio de
  sesión con contraseña ocurrido hace como máximo `CSD_REAUTH_WINDOW_SECONDS` (por defecto
  `900`, 15 minutos; rango permitido 60–3600; valores inválidos o ausentes usan el valor por
  defecto, nunca desactivan la verificación).
- Se mide con `Session.createdAt`, el mismo criterio que usa Better Auth para "sesión fresca"
  (`freshAge`); la renovación de la sesión (`updateAge`) no la vuelve reciente. Se aplica con
  una ventana propia de CSD, sin cambiar la configuración global de Better Auth.
- Sin autenticación reciente: 401 `CSD_REAUTH_REQUIRED`, sin procesar archivos ni contraseña, y
  auditoría `csd.configuration.started` con resultado `DENIED`. La UI envía al usuario a iniciar
  sesión de nuevo y lo regresa a `/dashboard/stamping`.
- El timbrado de cada factura exige autorización explícita (`StampRequest`), pero **no** vuelve
  a pedir la contraseña de la `.key`; tampoco exige autenticación reciente salvo decisión
  futura.
- Leer estado e historial no exige autenticación reciente.

---

## E. Esquema Prisma propuesto

Propuesta para el Bloque 2 (no aplicada; sujeta a revisión). Nombres finales pueden ajustarse
sin cambiar la semántica.

```prisma
/// Ambiente fiscal compartido con el futuro StampAttempt (TS: PacEnvironment).
enum PacEnvironment {
  SANDBOX
  PRODUCTION
}

enum CsdCertificateStatus {
  ACTIVE
  REPLACED
  DISABLED
}

/// Metadata y certificado público. Nunca contiene la llave ni la contraseña.
model CsdCertificate {
  id                     String               @id            // generado por el servicio antes de cifrar (AAD)
  organizationId         String
  organization           Organization         @relation(fields: [organizationId], references: [id], onDelete: Restrict)
  status                 CsdCertificateStatus @default(ACTIVE)
  /// = organizationId mientras ACTIVE, null después: un solo ACTIVE por Organization (patrón de BillingAttempt.activeKey).
  activeOrganizationId   String?              @unique
  environment            PacEnvironment
  certificateDer         Bytes                // necesario para el atributo Certificado del CFDI
  certificateSha256      String               // huella hex del DER
  serialNumberHex        String
  certificateNumber      String               // NoCertificado (§M.8)
  rfc                    String               // extraído con regla documentada (§M.7)
  publicKeyAlgorithm     String               // "RSA"
  publicKeyBits          Int
  signatureAlgorithm     String
  validFrom              DateTime
  validTo                DateTime
  csdTypeVerifiedLocally Boolean              @default(false)
  custodyConsentVersion  String
  configuredById         String?
  configuredBy           User?                @relation("CsdConfiguredBy", fields: [configuredById], references: [id], onDelete: SetNull)
  configuredAt           DateTime             @default(now())
  endedAt                DateTime?
  endedById              String?
  endedBy                User?                @relation("CsdEndedBy", fields: [endedById], references: [id], onDelete: SetNull)
  replacedById           String?              // CSD que lo sustituyó (misma Organization)
  privateKey             CsdPrivateKey?
  createdAt              DateTime             @default(now())
  updatedAt              DateTime             @updatedAt

  @@unique([organizationId, id])
  @@index([organizationId, status, configuredAt])
}

/// Envelope de la llave privada PKCS#8. Existe solo mientras el certificado está ACTIVE.
model CsdPrivateKey {
  csdCertificateId String         @id
  organizationId   String
  certificate      CsdCertificate @relation(fields: [organizationId, csdCertificateId], references: [organizationId, id], onDelete: Cascade)
  envelopeVersion  Int            // formato §H (1)
  algorithm        String         // "AES-256-GCM"
  ciphertext       Bytes
  iv               Bytes          // 12 bytes
  authTag          Bytes          // 16 bytes
  wrappedDek       Bytes          // DEK envuelta por la KEK (blob opaco del provider)
  kekProvider      String         // "env" | "kms:<proveedor>"
  kekId            String
  kekVersion       Int
  aadVersion       Int
  createdAt        DateTime       @default(now())
  rewrappedAt      DateTime?

  @@index([kekProvider, kekId, kekVersion])
}
```

Relaciones inversas a añadir: `Organization.csdCertificates`, `User.csdConfigured`,
`User.csdEnded`.

Notas:

- `CsdPrivateKey` usa FK compuesta `(organizationId, csdCertificateId)`: no puede apuntar al
  certificado de otra Organization.
- `onDelete: Restrict` en Organization: borrar una Organization con CSD exige un procedimiento
  explícito (coherente con `AuditEvent`).
- El entitlement por Organization (§Z.3) se modela en el bloque de timbrado, no en éste.
- No se crea `Document` para `.cer` ni `.key`: `GET /api/documents/[id]` permite descargar
  documentos a cualquier miembro y no es suficientemente privado para este material.

---

## F. Estrategia de migración aditiva

- Una migración nueva (`2026101x_phase5c3_csd_custody`) con: `CREATE TYPE` ×2,
  `CREATE TABLE` ×2, índices y FKs **de las tablas nuevas**. Sin `DROP`, `DELETE`,
  `ALTER COLUMN` ni cambios a tablas existentes (las relaciones inversas no alteran SQL).
- Generada con `prisma migrate diff` contra PGlite, verificada con `verify-schema`,
  `prisma migrate deploy` sobre base efímera y un test de aditividad.
- Opcional (decidir en Bloque 2): trigger que impida `UPDATE` de `ciphertext/iv/authTag` salvo
  durante rewrap controlado; no bloquea si complica la rotación.
- No se aplica en Neon. El checksum de Prisma depende de los finales de línea del archivo
  (hallazgo previo): aplicar siempre desde el mismo checkout y decidir política de EOL antes
  de producción.

---

## G. Interfaz `CsdKeyProvider`

```ts
type KeyRef = { provider: string; keyId: string; keyVersion: number };

interface CsdKeyProvider {
  /** "env" hoy; "kms:<id>" en el futuro. */
  readonly provider: string;
  /** Disponible solo si la configuración es completa y válida; nunca inventa una key. */
  availability(): { available: true; current: KeyRef } | { available: false; reason: "NOT_CONFIGURED" | "INVALID_CONFIGURATION" };
  /** ¿Puede desenvolver claves envueltas con esa versión? */
  canUnwrap(ref: KeyRef): boolean;
  wrapDataKey(dek: Buffer, aad: Buffer): Promise<{ ref: KeyRef; wrapped: Buffer }>;
  unwrapDataKey(ref: KeyRef, wrapped: Buffer, aad: Buffer): Promise<Buffer>;
}
```

### G.1 Alcance de cada provider: ambiente fiscal, no de hosting

Dos ejes distintos:

- **Ambiente de hosting:** `development`, `preview`, `production` (Vercel, `VERCEL_ENV`). No
  decide por sí solo qué provider se permite.
- **Ambiente fiscal/PAC:** `SANDBOX` o `PRODUCTION`. Es el que decide.

Ambiente fiscal **PRODUCTION** = cualquiera de: `PAC_ENVIRONMENT=PRODUCTION`, entitlement de
la Organization en `PRODUCTION`, o un CSD con `environment=PRODUCTION`. En cualquier otro caso
el ambiente fiscal es SANDBOX (incluido un SANDBOX que corre en un deployment de Vercel
production).

No reutilizar `fiscalProductionRequested()` (`src/lib/privacy-notice.ts`) para esta regla: esa
función combina hosting y ambiente fiscal para el gate del Aviso en la lectura de CSF (Fase 5C,
D12) y sigue sin cambios.

| Provider | Desarrollo y pruebas | Fiscal SANDBOX (cualquier hosting) | Fiscal PRODUCTION |
|---|---|---|---|
| `env` | Permitido, solo CSD de prueba | Permitido, **solo CSD de prueba** (§M.0) | **Bloqueado** |
| Externo (KMS/HSM o equivalente) | Opcional | Opcional | **Obligatorio** |

El provider `env` se bloquea siempre para:

- `PAC_ENVIRONMENT=PRODUCTION`;
- un CSD productivo real (todo certificado que no se demuestre de prueba, §M.0);
- timbrado fiscal real.

En esos casos, configurar el CSD y firmar responden `CSD_SERVICE_UNAVAILABLE` (o
`CSD_ENVIRONMENT_MISMATCH` si el certificado no corresponde al ambiente). El bloqueo se evalúa
en el servidor en cada operación; no depende de la UI.

**Sin fallback:** el provider se elige por configuración explícita para cada ambiente fiscal.
Si el provider externo de PRODUCTION no está disponible (no configurado, sin red, error o
permisos), la respuesta es `CSD_SERVICE_UNAVAILABLE` y **no se firma**. Nunca se cae
automáticamente a `env`, ni se intenta otra versión o provider "por si acaso". Una fila cifrada
por un provider solo la descifra ese mismo provider (`kekProvider`).

Un provider externo "equivalente a KMS/HSM" debe: mantener la KEK fuera del proceso de la
aplicación y de la base de datos, no permitir exportarla, cifrar/descifrar con contexto
(AAD) vinculado, auditar su uso y permitir rotación y revocación. Su elección es decisión del
operador antes de producción (§AB.5); el dominio y la interfaz no cambian.

### G.2 Provider `env` (desarrollo, pruebas y fiscal SANDBOX, solo CSD de prueba)

| Variable | Contenido |
|---|---|
| `CSD_KEY_PROVIDER_SANDBOX` | `env` o `kms:<id>` (vacío ⇒ custodia SANDBOX no disponible) |
| `CSD_KEY_PROVIDER_PRODUCTION` | `kms:<id>` (vacío ⇒ custodia PRODUCTION no disponible; `env` es una configuración inválida y deja PRODUCTION no disponible) |
| `CSD_KEK_ID` | Identificador lógico, distinto por ambiente (p. ej. `orbit-csd-sandbox`) |
| `CSD_KEK_CURRENT_VERSION` | Entero de la versión activa |
| `CSD_KEK_V<n>` | 32 bytes en base64 por versión |

Reglas:

- Sin variable o con longitud distinta de 32 bytes ⇒ `available: false` y la configuración de
  CSD responde `CSD_SERVICE_UNAVAILABLE` (fail closed). **Nunca una key por defecto ni
  hardcodeada.**
- Cada ambiente de hosting usa KEK distintas (variables de Vercel con alcance por ambiente),
  también cuando todos operan en fiscal SANDBOX. `.env.example` solo lleva nombres vacíos.
- El provider nunca registra la KEK ni la DEK; no expone métodos para leer la KEK.
- Un provider KMS implementa la misma interfaz (envolver = `Encrypt`, desenvolver = `Decrypt`
  del KMS con contexto equivalente a la AAD); el dominio no cambia.
- `kekProvider` se guarda por fila: un CSD cifrado con `env` nunca se habilita en fiscal
  PRODUCTION, aunque luego se configure un KMS; pasar a producción exige configurar un CSD
  productivo nuevo con el provider externo (§Z.2).

---

## H. Formato del envelope

Versión de envelope `1`:

1. Generar DEK aleatoria de 32 bytes (`crypto.randomBytes`).
2. Cifrar el PKCS#8 DER con AES-256-GCM: IV aleatorio de 12 bytes, tag de 16 bytes, AAD de
   datos (§I).
3. Envolver la DEK con el provider (AES-256-GCM con la KEK en `env`: blob
   `iv(12) ‖ ciphertext(32) ‖ tag(16)`; AAD de envoltura, §I).
4. Persistir columnas de `CsdPrivateKey`: `ciphertext`, `iv`, `authTag`, `wrappedDek`,
   `kekProvider`, `kekId`, `kekVersion`, `envelopeVersion=1`, `aadVersion=1`,
   `algorithm="AES-256-GCM"`.
5. **Verificación de ida y vuelta antes de confirmar:** descifrar en memoria y comparar el
   SHA-256 del PKCS#8 recuperado con el original; si difiere, abortar la transacción.
6. Sobrescribir con ceros los buffers de DEK y PKCS#8 al terminar (best effort).

Nunca: reutilizar IV con la misma DEK, cifrar sin AAD, guardar la DEK sin envolver, guardar la
`.key` original del usuario, devolver o registrar cualquiera de estas columnas.

---

## I. AAD

Bytes UTF-8 de una cadena canónica, sin JSON (orden fijo, sin ambigüedad):

- Datos: `orbit:csd-private-key:v1|org=<organizationId>|csd=<csdCertificateId>|cert=<certificateSha256>|env=<environment>`
- Envoltura de DEK: `orbit:csd-dek:v1|org=<organizationId>|csd=<csdCertificateId>|kek=<keyId>:<keyVersion>`

Efecto: un ciphertext copiado a otra fila, Organization, certificado o ambiente no se descifra
(falla el tag) y el CSD queda `INVALID` con `invalidReason: "INTEGRITY"`; nunca se usa.

El id del `CsdCertificate` se genera en el servicio (UUID v4) **antes** de cifrar, para poder
incluirlo en la AAD.

---

## J. Rotación de master keys

- **Rutinaria:** se agrega `CSD_KEK_V<n+1>` y se sube `CSD_KEK_CURRENT_VERSION`. Las filas nuevas
  usan la nueva versión. Un script del operador (Bloque 3), idempotente y fila por fila en
  transacción, desenvuelve la DEK con la versión vieja y la vuelve a envolver con la nueva
  (`rewrappedAt`); el ciphertext de la llave no cambia. La versión vieja se retira cuando
  ninguna fila la use **y** haya expirado la ventana de respaldos de Neon.
- **Por compromiso de KEK:** rewrap inmediato de todas las filas y, además, re-cifrado con DEK
  nueva (los respaldos con la DEK envuelta por la KEK comprometida siguen expuestos hasta que
  expiren). Ver `INCIDENT-RESPONSE.md` escenario 5.
- Una fila cuya versión de KEK ya no está disponible queda `INVALID` (`KEY_UNAVAILABLE`):
  nunca se intenta otra versión "por si acaso".
- La rotación no requiere la contraseña del usuario.

---

## K. Sustitución de CSD

1. OWNER/ADMIN con autenticación reciente (§D.1) envía `.cer`, `.key`, contraseña,
   `replace=true` y `expectedActiveCsdId`.
2. Validación completa del nuevo material (§M) **antes** de tocar el activo.
3. Transacción con bloqueo de la Organization (`SELECT ... FOR UPDATE` sobre `Organization`):
   - si el activo actual no es `expectedActiveCsdId` ⇒ 409 `CSD_CONFLICT`;
   - si hay un intento de timbrado en `SIGNING` (fase CFDI) ⇒ 409 `CSD_IN_USE`;
   - el anterior pasa a `REPLACED` (`endedAt`, `endedById`, `replacedById`) y su
     `CsdPrivateKey` (ciphertext, IV, tag y DEK envuelta) **se elimina en la misma
     transacción**; si la eliminación falla, toda la sustitución se revierte;
   - se crea el nuevo `ACTIVE` con su envelope.
4. Auditoría `csd.replaced` y `csd.configured` (§Q).

Lo que se conserva del CSD anterior (certificado público y metadata de §E) no permite
reconstruir la llave privada: no se guardan DEK, ciphertext, IV, tag, hashes ni fragmentos de
la llave.

Mismo certificado (`certificateSha256`) que el activo ⇒ idempotente (§U), sin sustitución.

---

## L. Deshabilitado y borrado

- `POST /api/csd/disable` con `expectedActiveCsdId`, confirmación explícita y autenticación
  reciente (§D.1).
- En transacción con el mismo bloqueo: `ACTIVE` ⇒ `DISABLED`, `activeOrganizationId = null`,
  `endedAt/endedById` y **eliminación de `CsdPrivateKey`** (ciphertext, IV, tag y DEK
  envuelta) en la misma transacción; si algo falla, nada cambia.
- Se conserva solo metadata que no permite reconstruir la llave (igual que en §K).
- Auditoría `csd.disabled` (§Q).
- Idempotente: si ya no hay activo, responde el estado actual (`NOT_CONFIGURED`).
- La metadata del certificado (incluido el certificado público) se conserva para auditoría y
  para verificar sellos de CFDI ya emitidos; su retención final es decisión legal
  (`DATA-RETENTION.md`).
- Limitación: la fila eliminada sigue en respaldos de Neon hasta su expiración; queda
  protegida por la KEK. La destrucción efectiva requiere retirar la versión de KEK después de
  la ventana de respaldos (§J).
- No existe "deshabilitar temporalmente conservando la llave": retirar destruye la llave.

---

## M. Validación de `.cer` y `.key`

### M.0 CSD de prueba frente a CSD productivo

"CSD de prueba" debe ser demostrable, no declarado por el usuario:

- Se mantiene una allowlist de certificados de autoridades certificadoras **de prueba**
  oficiales (SAT o la indicada por el PAC para su sandbox), versionada como recurso SAT con
  SHA-256, URL de origen y fecha de obtención (§AA.1).
- Un CSD es de prueba solo si su certificado está firmado por una CA de esa allowlist
  (verificación criptográfica de la firma del emisor, no solo coincidencia de nombre).
- En fiscal SANDBOX, un certificado que no se demuestre de prueba se rechaza con
  `CSD_ENVIRONMENT_MISMATCH`. En fiscal PRODUCTION, un certificado de prueba se rechaza igual.
- Mientras la allowlist oficial no se haya obtenido y verificado, ningún CSD puede custodiarse
  fuera de los tests automatizados, que inyectan su propia CA sintética solo en el entorno de
  pruebas (fail closed).

Orden obligatorio; el primer fallo detiene el flujo y no persiste nada:

| # | Verificación | Herramienta | Fallo |
|---|---|---|---|
| 1 | Rol OWNER/ADMIN, autenticación reciente (§D.1), KeyProvider disponible y permitido para el entorno (§G.1, §Z) | servicio | `CSD_FORBIDDEN` / `CSD_REAUTH_REQUIRED` / `CSD_SERVICE_UNAVAILABLE` |
| 2 | Perfil Fiscal con RFC confirmado | Prisma | `CSD_ISSUER_PROFILE_REQUIRED` |
| 3 | Presencia de `.cer`, `.key`, contraseña (1–256 caracteres) y aceptación del texto de custodia vigente | parser multipart | `CSD_FILES_REQUIRED` / `CSD_CUSTODY_TERMS_REQUIRED` |
| 4 | Tamaño y extensión (§S) | servicio | `CSD_FILE_TOO_LARGE` / `CSD_CERTIFICATE_INVALID` / `CSD_KEY_INVALID` |
| 5 | Certificado X.509 DER interpretable, no CA, llave pública RSA ≥ 2048 bits | `node:crypto.X509Certificate` | `CSD_CERTIFICATE_INVALID` / `CSD_UNSUPPORTED` |
| 6 | Vigencia: `validFrom ≤ ahora < validTo` | servicio | `CSD_NOT_YET_VALID` / `CSD_EXPIRED` |
| 7 | RFC del certificado extraído con regla documentada e igual al RFC del Perfil Fiscal | lector ASN.1 del subject | `CSD_RFC_UNVERIFIABLE` / `CSD_RFC_MISMATCH` |
| 8 | Número de certificado (NoCertificado) derivado del número de serie con regla documentada | servicio | `CSD_UNSUPPORTED` |
| 8b | Certificado de prueba o productivo según el ambiente fiscal (§M.0) y provider permitido para él (§G.1) | `node:crypto` (`X509Certificate.verify` con la CA allowlisted) | `CSD_ENVIRONMENT_MISMATCH` / `CSD_SERVICE_UNAVAILABLE` |
| 9 | `.key` es `EncryptedPrivateKeyInfo` (PKCS#8 cifrado) DER bien formado | lector ASN.1 mínimo | `CSD_KEY_INVALID` |
| 10 | La contraseña abre la llave | `crypto.createPrivateKey({ format: "der", type: "pkcs8", passphrase })` | `CSD_PASSWORD_INVALID` (solo si §9 pasó; cualquier otro error ⇒ `CSD_KEY_INVALID`) |
| 11 | Algoritmo de cifrado de la llave soportado por el OpenSSL de Node (sin proveedor legacy) | `node:crypto` | `CSD_UNSUPPORTED` |
| 12 | Llave ↔ certificado: `x509.checkPrivateKey(key)` **y** firma/verificación RSA-SHA256 de un reto aleatorio | `node:crypto` | `CSD_KEY_MISMATCH` |
| 13 | Normalización a PKCS#8 DER sin contraseña en memoria, cifrado (§H) y verificación de ida y vuelta | `node:crypto` | `CSD_ENCRYPTION_FAILED` |

Reglas pendientes de **verificación con fuentes oficiales** (Bloque 1; si no se pueden
sustentar, detenerse y reportar):

- **M.7 RFC:** ubicación del RFC en el subject del CSD (hipótesis: atributo
  `x500UniqueIdentifier`, OID 2.5.4.45) y formato para persona física y moral.
- **M.8 NoCertificado:** hipótesis de que el número de serie del certificado son dígitos ASCII
  y que su decodificación produce el número de certificado de 20 dígitos.
- **M.11 Algoritmos de la `.key`:** esquema PBE usado por el SAT y compatibilidad con OpenSSL 3
  sin proveedor legacy.
- **CSD vs e.firma:** solo se marcará `csdTypeVerifiedLocally: true` si existe una propiedad
  oficial documentada y verificable; mientras tanto `false` y la autoridad final es SAT/PAC.

CSD de prueba:

- **SANDBOX usa solamente CSD de prueba** (§M.0).
- Se necesitan CSD de prueba válidos para SANDBOX (los que publica el SAT o los que indique el
  PAC para su sandbox), junto con los certificados de su CA de prueba. **Todavía no se
  descargan**: la obtención requiere autorización explícita y se documentará su origen, fecha
  y hash.
- Se guardan fuera del repositorio (`npm run security:check` rechaza llaves y contenedores de
  certificados) o se usan solo en máquinas de prueba.
- Los tests automatizados usan certificados sintéticos generados en tiempo de ejecución.
- **Nunca:** un CSD productivo de un cliente como fixture; una llave real en el repositorio;
  secretos reales en tests; certificados productivos en CI; copias en logs, tickets de soporte
  o capturas.

La contraseña nunca se reintenta con variantes (espacios, mayúsculas), nunca se compara contra
nada almacenado y nunca forma parte de un error.

---

## N. Códigos de error

Se conservan los 10 `CsdErrorCode` publicados y se proponen adiciones (ver §P). Todos los
errores responden `{ error: <mensaje curado en español>, code }`, sin texto de OpenSSL, SQL,
rutas, stack ni contenido criptográfico.

| Código | HTTP | Cuándo |
|---|---|---|
| `CSD_CERTIFICATE_INVALID` | 400 | `.cer` ilegible, no X.509, CA o extensión inválida |
| `CSD_KEY_INVALID` | 400 | `.key` ilegible, no PKCS#8 cifrado o extensión inválida |
| `CSD_PASSWORD_INVALID` | 400 | La contraseña no abre una llave bien formada |
| `CSD_KEY_MISMATCH` | 422 | Llave y certificado no corresponden |
| `CSD_EXPIRED` | 422 | Certificado vencido |
| `CSD_NOT_YET_VALID` | 422 | Certificado aún no vigente |
| `CSD_RFC_MISMATCH` | 422 | RFC del certificado distinto al del Perfil Fiscal |
| `CSD_ISSUER_PROFILE_REQUIRED` | 409 | Falta Perfil Fiscal confirmado con RFC |
| `CSD_FILE_TOO_LARGE` | 413 | Excede §S |
| `CSD_UNSUPPORTED` | 422 | Algoritmo, tamaño de llave o formato no soportado |
| `CSD_FILES_REQUIRED` *(nuevo)* | 400 | Falta `.cer`, `.key` o contraseña |
| `CSD_CUSTODY_TERMS_REQUIRED` *(nuevo)* | 400 | No se aceptó el texto de custodia vigente |
| `CSD_RFC_UNVERIFIABLE` *(nuevo)* | 422 | No se pudo extraer el RFC con la regla documentada |
| `CSD_ALREADY_ACTIVE` *(nuevo)* | 409 | Hay otro CSD activo y no se pidió sustitución |
| `CSD_CONFLICT` *(nuevo)* | 409 | `expectedActiveCsdId` no coincide (cambio concurrente) |
| `CSD_IN_USE` *(nuevo)* | 409 | Hay una firma en curso (fase CFDI) |
| `CSD_FORBIDDEN` *(nuevo)* | 403 | Rol distinto de OWNER/ADMIN |
| `CSD_REAUTH_REQUIRED` *(nuevo)* | 401 | Falta autenticación reciente (§D.1) |
| `CSD_ENVIRONMENT_MISMATCH` *(nuevo)* | 422 | Certificado no demostrado de prueba en fiscal SANDBOX, o de prueba en fiscal PRODUCTION (§M.0) |
| `CSD_RATE_LIMITED` *(nuevo)* | 429 | Límite de intentos (§T) |
| `CSD_SERVICE_UNAVAILABLE` *(nuevo)* | 503 | KeyProvider no disponible o no permitido para el ambiente fiscal (`env` en fiscal PRODUCTION), KMS de PRODUCTION no disponible (sin fallback), Legal gate pendiente en fiscal PRODUCTION o flag apagada |
| `CSD_ENCRYPTION_FAILED` *(nuevo)* | 503 | Fallo al cifrar o en la verificación de ida y vuelta |
| `CSD_NOT_FOUND` *(nuevo)* | 404 | No hay CSD activo que deshabilitar con ese id |

Mensajes de referencia: `FASE5C-CONTRACT.md` §12.3. La UI mapea códigos a mensajes; nunca
muestra `error.message` crudo de librerías.

---

## O. APIs propuestas

Todas: sesión, `requireTenant()`, `Cache-Control: no-store` (ya global en `/api`), mismo
origen en mutaciones, sin `organizationId` en el cuerpo, rutas fuera de cualquier allowlist de
analytics. Las mutaciones (`POST /api/csd`, `POST /api/csd/disable`) exigen además
autenticación reciente (§D.1).

La única pantalla que llama a las mutaciones es `/dashboard/stamping`. Perfil Fiscal e Invoice
Studio solo leen `GET /api/csd` (o el estado de timbrado) para mostrar un resumen y un enlace a
esa página.

| Método y ruta | Rol | Cuerpo | Respuesta |
|---|---|---|---|
| `GET /api/csd` | OWNER/ADMIN | — | `CsdState` (§P) |
| `GET /api/csd/custody-terms` | OWNER/ADMIN | — | `CsdCustodyTerms` |
| `POST /api/csd` | OWNER/ADMIN | `multipart/form-data`: `certificate` (`.cer`), `privateKey` (`.key`), `password`, `custodyTermsVersion`, `accepted=true`, opcional `replace=true` + `expectedActiveCsdId` | 200 `ConfigureCsdResponse` (`created: true` nuevo; `false` idempotente); errores §N |
| `POST /api/csd/disable` | OWNER/ADMIN | JSON `{ expectedActiveCsdId, confirm: true }` | 200 `CsdState` |
| `GET /api/csd/history` | OWNER/ADMIN | — | `CsdHistoryItem[]` (máx. 50) |

- `POST /api/csd` responde 200 como indica la ruta publicada (no 201) y su cuerpo es un
  superconjunto de `CsdSummary`, así que un consumidor del contrato publicado sigue siendo
  compatible.
- Límite total del cuerpo multipart: 64 KiB.
- No existe ruta para descargar `.cer`, `.key`, ciphertext ni llave. El certificado público se
  incrustará en el CFDI desde el servidor.

---

## P. DTOs compartidos

Se conservan **sin cambios** `CsdStatus`, `CsdSummary` y `CsdErrorCode` de
`src/types/fiscal-identity.ts`. Las adiciones van en un archivo nuevo
`src/types/csd.ts` (escribe Claude, consume Codex), que no altera los tipos publicados:

```ts
import type { CsdErrorCode, CsdSummary } from "./fiscal-identity";
import type { PacEnvironment } from "./stamping";

export type CsdInvalidReason =
  | "NOT_YET_VALID"
  | "RFC_CHANGED"            // el RFC del Perfil Fiscal ya no coincide
  | "KEY_UNAVAILABLE"        // KeyProvider o versión de KEK no disponible
  | "INTEGRITY";             // el envelope no se pudo verificar

/** GET /api/csd */
export type CsdState = CsdSummary & {
  id: string | null;
  environment: PacEnvironment | null;
  invalidReason: CsdInvalidReason | null;
  /** true cuando faltan ≤ 30 días para validTo. */
  expiresSoon: boolean;
  /** Acciones permitidas al usuario actual (la UI no decide permisos). */
  canManage: boolean;
  /** false: el servidor no puede custodiar CSD (KeyProvider/flag/legal gate). */
  serviceAvailable: boolean;
};

export type CsdCustodyTerms = { version: string; text: string };

/** POST /api/csd → 200. created=false: mismo certificado ya activo (idempotente). */
export type ConfigureCsdResponse = CsdState & { created: boolean };

export type DisableCsdRequest = { expectedActiveCsdId: string; confirm: true };

export type CsdHistoryItem = {
  id: string;
  status: "ACTIVE" | "REPLACED" | "DISABLED";
  certificateNumber: string;
  rfc: string;
  environment: PacEnvironment;
  validFrom: string;
  validTo: string;
  configuredAt: string;
  configuredBy: string | null;   // nombre visible, nunca correo
  endedAt: string | null;
};

export type CsdApiErrorCode =
  | CsdErrorCode
  | "CSD_FILES_REQUIRED"
  | "CSD_CUSTODY_TERMS_REQUIRED"
  | "CSD_RFC_UNVERIFIABLE"
  | "CSD_ALREADY_ACTIVE"
  | "CSD_CONFLICT"
  | "CSD_IN_USE"
  | "CSD_FORBIDDEN"
  | "CSD_REAUTH_REQUIRED"
  | "CSD_ENVIRONMENT_MISMATCH"
  | "CSD_RATE_LIMITED"
  | "CSD_SERVICE_UNAVAILABLE"
  | "CSD_ENCRYPTION_FAILED"
  | "CSD_NOT_FOUND";
```

Nunca aparecen en DTOs: contraseña, llave, ciphertext, IV, tag, DEK, KEK, `kekId/kekVersion`,
DER del certificado, correo de quien configuró.

`CsdSummary.verification.rfcMatchesIssuer` y `withinValidity` se calculan en cada lectura.

---

## Q. Auditoría

Solo `AuditEvent` (append-only, FASE5C2 §7), con el estilo existente del catálogo
(`src/lib/audit.ts`). No se crea un segundo estilo en mayúsculas.

| Acción del catálogo | Alcance | Resultado | Metadata permitida |
|---|---|---|---|
| `csd.configuration.started` | TENANT | `SUCCESS`, o `DENIED` por rol o falta de autenticación reciente | `replace`, `reason` (`ROLE`, `REAUTH_REQUIRED`) |
| `csd.configured` | TENANT | `SUCCESS` | `certificateNumber`, `environment`, `validTo`, `created` |
| `csd.configuration.failed` | TENANT | `FAILURE` | `code` (§N), `stage` (número de §M) |
| `csd.replaced` | TENANT | `SUCCESS` | `previousCsdId`, `certificateNumber` |
| `csd.disabled` | TENANT | `SUCCESS` o `DENIED` | `certificateNumber`, `reason` |

- Cambios al catálogo: `csd.configured` deja de estar reservada; `csd.disabled` sustituye a la
  reservada `csd.revoked`; se agregan `csd.configuration.started`, `csd.configuration.failed`
  y `csd.replaced`. Los eventos reservados de timbrado (`invoice.stamp_authorized`,
  `invoice.stamped`, `invoice.cancelled`) siguen reservados.
- Objetivo: `CsdCertificate` con su id (o ninguno si la configuración falló antes de crearlo).
- Prohibido en metadata y logs: contraseña, llave, contenido de `.cer`/`.key`, ciphertext,
  IV, tag, DEK, KEK, RFC (ya está en el registro del CSD), mensajes de OpenSSL o stack.
- No se escriben eventos de CSD en `ActivityLog` (cuyo feed usa nombres en mayúsculas). Si en
  el futuro el dashboard debe mostrarlos, se leerán de `AuditEvent` con su propio mapeo.
- Los intentos rechazados no crean filas de CSD; la evidencia es el evento `FAILURE`.

---

## R. Sanitización de logs

- `apiError`/`codedApiError` ya registran solo clase y código (FASE5C2 §8). Las rutas de CSD
  envuelven todo error inesperado en `CSD_ENCRYPTION_FAILED` o el genérico 503; nunca
  `console.*` con objetos de error de `node:crypto`.
- No se registra el cuerpo multipart, nombres de archivo, tamaños exactos ni cabeceras.
- `redact()` añade patrones para PEM de certificados (`-----BEGIN CERTIFICATE-----`) y claves
  con nombres `privateKey`, `password`, `certificate`, `wrappedDek`, `ciphertext`, `authTag`.
- Ninguna ruta de CSD se añade a `src/lib/analytics-policy.ts` (allowlist de Vercel
  Analytics); `/dashboard/stamping` tampoco. Ningún archivo, nombre de archivo, tamaño,
  contraseña ni resultado de validación del CSD se envía a analytics.
- Test obligatorio: una configuración completa con contraseña y llave sintéticas marcadas no
  deja esas marcas en logs del servidor, respuestas, `AuditEvent`, `ActivityLog` ni HTML.

---

## S. Límites de archivos

| Archivo | Extensión | Tamaño máximo | Contenido |
|---|---|---|---|
| Certificado | `.cer` | 16 KiB | X.509 DER (PEM se rechaza en esta fase) |
| Llave | `.key` | 16 KiB | PKCS#8 `EncryptedPrivateKeyInfo` DER |
| Contraseña | — | 256 caracteres | Texto; no se recorta ni normaliza |

- El MIME del navegador no es evidencia (los `.key` llegan como tipos arbitrarios); se valida
  por contenido.
- Lectura solo server-side, en memoria; nada se escribe a disco, `Document`, `/public`,
  caché ni almacenamiento del navegador.
- Sin miniaturas, vistas previas ni URLs.

---

## T. Rate limiting

Con `enforceRateLimit` (PostgreSQL, apto para serverless):

| Operación | Clave | Límite |
|---|---|---|
| Configurar/sustituir | `csd-configure:<userId>` | 5 / 15 min |
| Configurar/sustituir | `csd-configure-org:<organizationId>` | 10 / hora |
| Deshabilitar | `csd-disable:<userId>` | 10 / hora |
| Estado e historial | `csd-read:<userId>` | 120 / min |

El rechazo devuelve 429 `CSD_RATE_LIMITED` y cuenta para auditoría (`csd.configuration.failed`).

---

## U. Idempotencia de configuración

- Mismo `certificateSha256` que el CSD activo y la contraseña abre la llave y corresponde ⇒
  200 `{ created: false }`, sin re-cifrar ni crear filas.
- Otro certificado sin `replace` ⇒ 409 `CSD_ALREADY_ACTIVE`.
- `replace` con `expectedActiveCsdId` desactualizado ⇒ 409 `CSD_CONFLICT`.
- Solicitudes concurrentes: bloqueo de la fila `Organization` + `activeOrganizationId @unique`
  como autoridad en base de datos; la perdedora recibe `CSD_CONFLICT` o el resultado
  idempotente.
- Deshabilitar es idempotente.
- No hay clave de idempotencia del navegador.

---

## V. Comportamiento multi-tenant

- Toda consulta lleva `organizationId` de la sesión: `findFirst({ where: { organizationId, ... } })`.
- La firma (fase CFDI) se invoca como `signWithActiveCsd({ organizationId, ... })`; nunca por
  id de CSD.
- FK compuestas; AAD con `organizationId`.
- Las respuestas nunca incluyen ids de otras Organizations; un id ajeno se comporta como
  inexistente (404/409 sin revelar existencia).
- Tests: Organization B no puede leer estado, historial, deshabilitar ni sustituir el CSD de A;
  un ciphertext de A copiado a B no se descifra.

---

## W. Contraseña incorrecta

- `.key` bien formada y contraseña que no la abre ⇒ 400 `CSD_PASSWORD_INVALID`.
- Distinguir contraseña incorrecta de llave corrupta no revela nada nuevo (el usuario ya tiene
  su llave); la fuerza bruta en línea queda acotada por §T.
- Nada se persiste; la contraseña se descarta; el intento cuenta para §T.
- Auditoría `csd.configuration.failed` con `code` y `stage: 10`.
- El CSD activo previo (si existe) no cambia.
- La UI limpia el campo de contraseña y conserva los archivos seleccionados solo en memoria
  del formulario.

---

## X. Certificado expirado

- Al configurar: 422 `CSD_EXPIRED` (o `CSD_NOT_YET_VALID`), sin persistir.
- CSD activo que expira después: estado efectivo `EXPIRED`, `StampBlockingReason
  CSD_NOT_VALID`, no puede firmar. Sigue `ACTIVE` en el ciclo de vida y su llave **no** se
  destruye automáticamente: permanece cifrada hasta que el usuario lo sustituya (§K) o lo
  deshabilite (§L), momento en que se destruye en la misma transacción.
- `expiresSoon: true` a 30 días.
- Al firmar (fase CFDI) se vuelve a validar vigencia contra la hora del servidor y la fecha
  del comprobante.

---

## Y. `.cer` y `.key` que no corresponden

- 422 `CSD_KEY_MISMATCH` cuando la llave abre con la contraseña pero no corresponde al
  certificado (§M.12).
- Nada se persiste; auditoría `FAILURE` con `stage: 12`.

---

## Z. Separación SANDBOX / PRODUCTION

El ambiente **fiscal** (SANDBOX/PRODUCTION) es independiente del ambiente de **hosting** de
Vercel (§G.1). Un deployment de Vercel production puede operar fiscal SANDBOX con CSD de prueba.
Ninguna regla de esta sección usa `VERCEL_ENV` por sí sola.

1. **Flags globales:** `STAMPING_ENABLED` (por defecto `false`, timbrado apagado) y
   `PAC_ENVIRONMENT` (`SANDBOX` por defecto; `PRODUCTION` explícito). Ausencia = apagado.
2. **Ambiente del CSD:** se fija al configurarlo con el ambiente fiscal vigente de la
   Organization y no cambia; debe coincidir con la naturaleza del certificado (de prueba en
   SANDBOX, productivo en PRODUCTION, §M.0). Pasar a producción exige configurar un CSD
   productivo nuevo con el provider externo; un CSD SANDBOX nunca firma para PRODUCTION ni al
   revés.
3. **Entitlement por Organization** (bloque de timbrado): registro administrado por el operador
   (no autoservicio) con `environment` y `enabled=false` por defecto. Producción exige
   entitlement `PRODUCTION` explícito.
4. **Custodia y timbrado en fiscal PRODUCTION** (definición de §G.1): exigen un provider
   externo KMS/HSM equivalente (el provider `env` queda bloqueado), Legal Production Gate
   cumplido (§AB) y entitlement `PRODUCTION`. Si falta cualquiera, o el provider externo no está
   disponible: `CSD_SERVICE_UNAVAILABLE`, nada se procesa y no se firma. Nunca hay fallback de
   KMS a `env`.
5. Ningún fake o mock puede producir `ISSUED` ni ejecutarse fuera de tests (D7). E2E locales
   nunca usan `PRODUCTION`.
6. **SANDBOX usa solamente CSD de prueba**, demostrados como tales (§M.0). Nunca: CSD
   productivo de un cliente como fixture, llave real en el repositorio, secretos reales en
   tests ni certificados productivos en CI.

---

## AA. Requisitos para el bloque CFDI siguiente

Flujo: Draft `READY` → construir XML CFDI 4.0 → validar → cadena original → sello con el CSD →
verificar sello localmente → enviar XML **ya sellado** al PAC → recibir timbre → validar
respuesta → `ISSUED`.

### AA.0 Reparto ORBIT / PAC (decisión cerrada)

| Paso | Responsable |
|---|---|
| Construir el XML CFDI 4.0 | ORBIT |
| Generar la cadena original | ORBIT |
| Sellar con el CSD | ORBIT |
| Verificar el sello localmente | ORBIT |
| Timbrar el XML previamente sellado | SW sapien / SmarterWEB |

Solo se usa el servicio de SW de **timbrado de XML previamente sellado**. Quedan prohibidos
"Emisión Timbrado", "Emisión Timbrado JSON" y cualquier servicio en el que SW construya, selle o
custodie con el CSD de la Organization. El adaptador del PAC se implementa con la documentación
oficial vigente de SW, sin inventar endpoints ni copiar ejemplos antiguos (D6).

1. **Recursos oficiales del SAT** para CFDI (`cfdv40.xsd`, `cadenaoriginal_4_0.xslt` y sus
   `xsl:include`, `TimbreFiscalDigitalv11.xsd` y su XSLT, y los que se agreguen):
   - versionados localmente en `resources/sat/cfdi40/`;
   - con SHA-256 en un manifiesto (como `catCFDI`);
   - con URL de origen y fecha de obtención registradas;
   - **nunca** descargados en runtime;
   - validados contra fixtures conocidos (§AA.5.3) antes de usarse.
   Un recurso SAT incluido dentro de un paquete npm no cuenta como oficial salvo que su hash
   coincida con el descargado de la fuente oficial.
2. **XML determinístico** desde snapshots del draft (Decimal, orden estable, UTF-8), sin datos
   del navegador.
3. **Validación** estructural y contra XSD antes de firmar.
4. **Cadena original con la XSLT oficial (requisito obligatorio):** ORBIT ejecuta la XSLT
   oficial del SAT (`cadenaoriginal_4_0.xslt` y sus `xsl:include`, versionados localmente,
   §AA.1) para producir la cadena original. En producción **no** se reimplementan
   manualmente las reglas de la XSLT (FASE5C §16 se mantiene sin enmienda).
5. **Motor XSLT, XSD y utilidades CFDI: ninguna dependencia aprobada.**

   **AA.5.1 Descartados**

   | Opción | Motivo |
   |---|---|
   | `xslt-processor` | LGPL-3.0 |
   | Saxon-JS | Licencia propietaria |
   | `@cfdi/transform` como implementación principal | Reimplementa el comportamiento de la XSLT en lugar de ejecutar la oficial |
   | `@cfdi/csd` | No necesario (`node:crypto`); arrastra `node-forge` 1.4.0 con advisory HIGH GHSA-86w9-cpqp-85rv (verificación RSA PKCS#1 v1.5) y `@clir/openssl` ejecuta procesos |
   | Bindings nativos de libxslt | Binarios nativos y compatibilidad incierta con Vercel; solo si no existe alternativa segura (y entonces vía §AA.5.5) |

   Validación XSD (separada del motor XSLT), sin aprobar: `@cfdi/xsd` (genera código con
   `ajv`/`new Function`; probable conversión a JSON Schema, no validación XSD completa) y
   `xmllint-wasm`, ambos a auditar.

   **AA.5.2 Candidato a auditar (no aprobado, no instalado): `@tradik/xslt-processor`**

   Datos de `npm view`, el README publicado en el registro y `npm audit --package-lock-only`
   en un directorio temporal (solo metadatos; ningún código descargado ni ejecutado),
   2026-10-11. Lo que dice el README son afirmaciones del autor, no verificadas.

   | Criterio | Resultado |
   |---|---|
   | Versión actual | 1.3.3 |
   | Licencia | BSD-3-Clause |
   | Dependencias runtime | Ninguna directa. Peer opcionales: `jsdom` (>=25), `@xmldom/xmldom` (>=0.9), `@tradik/xslt3` (^1.0.0, solo para XSLT 2.0/3.0 opt-in) |
   | Dependencias transitivas | Con `@xmldom/xmldom` 0.9.12 (MIT): 2 paquetes en total. Con `jsdom` 30.1.2: 37 paquetes (MIT, MIT-0, BSD-2/3, ISC, Apache-2.0, BlueOak-1.0.0, CC0-1.0) |
   | Mantenimiento | Creado 2026-01-27; 12 versiones; las seis últimas publicadas el mismo día (2026-10-02); un solo publicador (`tradik`); README declara CI y cobertura del 100 %. Proyecto joven: riesgo de estabilidad |
   | CVEs (`npm audit`) | Ninguno reportado en ambas variantes |
   | `eval` / `new Function` | Por auditar (motor XPath propio) |
   | Node / Vercel | `engines.node >=20.19.0`; sin binarios nativos ni scripts de instalación en el lockfile; `jsdom` exige Node `^22.22.2 \|\| ^24.15.0 \|\| >=26`. Tamaño 5.5 MB sin empaquetar (131 archivos): revisar impacto en la función serverless |
   | `xsl:include` / `xsl:import` | El README declara soporte mediante "loaders" configurables; hay que verificar que se puedan restringir a archivos locales allowlisted y que no haga `fetch` |
   | Desviaciones XSLT 1.0 conocidas | Según el README: `xsl:number` ignora `lang` y `letter-value`; `unparsed-entity-uri()` devuelve `''`; números a texto en forma XPath 1.0 (`10000000000`), distinta de libxslt (`1e+10`). Verificar que ninguna afecte la XSLT del SAT |
   | DOM en Node | Requerido: el README indica traer un DOM (`jsdom` o `@xmldom/xmldom`) |
   | Hojas `version="2.0"` | Por defecto se ejecutan con el motor 1.0 en modo forwards-compatible; `@tradik/xslt3` es opt-in (versión 1.0.0 creada el 2026-10-02). Hay que verificar qué versión declaran las XSLT oficiales del SAT y cómo se comportan |
   | Comportamiento con las XSLT oficiales del SAT | Por auditar con el gate §AA.5.3 |

   **AA.5.3 Gate obligatorio para aprobar cualquier motor XSLT**

   Antes de aprobar un motor, debe demostrar, con evidencia en pruebas automatizadas:

   1. Ejecuta las XSLT oficiales versionadas localmente (`resources/sat/cfdi40/`, con hash).
   2. Resuelve `xsl:include`/`xsl:import` **solo** desde recursos locales allowlisted; cualquier
      otra referencia falla.
   3. No hace `fetch` ni ningún acceso de red en runtime (verificado con la red bloqueada en las
      pruebas).
   4. Reproduce exactamente, byte a byte, cadenas originales conocidas.
   5. Se verifica contra CFDI oficiales o de prueba (publicados por el SAT o el PAC).
   6. Produce una cadena cuyo sello puede verificarse con el certificado correspondiente: para
      CFDI de ejemplo que incluyen `Sello` y `Certificado`, recalcular la cadena y verificar el
      `Sello` existente con `node:crypto`.
   7. Pasa fixtures de espacios en blanco, Unicode, decimales y cada complemento soportado.

   Además: licencia permisiva confirmada, auditoría de código (sin `eval`/`new Function`
   injustificados, sin red, sin procesos) y compatibilidad con Vercel. La auditoría de código se
   hace en un directorio aislado sin ejecutar scripts de instalación.

   **AA.5.4 Si ningún motor permisivo pasa el gate**

   **Se detiene la fase.** No se sustituye por una reimplementación aproximada de la XSLT ni por
   un paquete que reproduzca su comportamiento.

   **AA.5.5 Fallback arquitectónico (documentado, no aprobado)**

   Ejecutar la generación de la cadena original (y, si conviene, la firma) en un runtime o
   servicio interno separado con un motor XSLT auditado (por ejemplo, un motor de referencia en
   otro lenguaje), manteniendo las mismas interfaces de dominio (`CsdVault.sign` y el
   constructor de cadena original). Requiere su propio análisis de seguridad, red interna,
   autenticación entre servicios y licencias antes de aprobarse.
6. **Sello:** RSA con SHA-256 (PKCS#1 v1.5) sobre la cadena original UTF-8, Base64; atributos
   `NoCertificado`, `Certificado` (DER Base64) y `Sello` desde el CSD activo validado.
7. **Verificación local** del sello con la llave pública del certificado y comparación de que el
   XML no cambió después de firmar (FASE5C §16.4).
8. **Servicio de firma** (`CsdVault.sign`) que recibe `organizationId` y la cadena; devuelve
   solo el sello; descifra la llave en memoria, firma y sobrescribe buffers. Sin caché de llave.
9. **Autorización por factura** (`StampAuthorizationTerms`, `StampRequest` publicados): ligada a
   usuario, Organization, factura y `draftVersion`; de un solo uso.
10. **`StampAttempt`** e idempotencia server-side (FASE5C §18), entitlement (§Z.3),
    `PacProvider` SW sandbox, validación del TFD (UUID, `SelloSAT`, `NoCertificadoSAT`,
    `FechaTimbrado`, `RfcProvCertif`) y reconciliación de `UNKNOWN`.
11. El PAC recibe el XML sellado; **nunca** `.cer`, `.key`, contraseña ni llave.
12. El timbrado de cada factura exige autorización explícita del usuario y **no** vuelve a pedir
    la contraseña de la `.key` (§D.1).

---

## AB. Requisitos legales pendientes (Legal Production Gate)

Antes de custodiar un CSD real en producción:

1. **Aviso de Privacidad (nueva versión publicada):** hoy dice que ORBIT no custodia CSD. Debe
   describir: recepción única de `.cer`, `.key` y contraseña; que la contraseña no se conserva;
   cifrado de la llave y separación de la master key; finalidad exclusiva de sellar los CFDI que
   el usuario autorice uno por uno; quién accede (solo el proceso de firma; nadie la ve);
   retención (hasta sustitución o deshabilitado, más respaldos) y eliminación; que el PAC
   recibe XML sellado y no el CSD; que ORBIT nunca solicita la e.firma.
2. **Consentimiento de custodia:** texto versionado (`CsdCustodyTerms`) aceptado por el
   OWNER/ADMIN al configurar; su versión se guarda en `CsdCertificate.custodyConsentVersion`.
   Redacción sujeta a revisión jurídica.
3. **Términos:** responsabilidad del contribuyente sobre la vigencia y uso de su CSD;
   autorización por factura; retiro en cualquier momento; límites de responsabilidad
   revisados por abogado.
4. **Inventario y retención:** `SUBPROCESSORS.md` (PAC SW: XML sellado), `DATA-RETENTION.md`
   (fila "Futuro CSD"), `INCIDENT-RESPONSE.md` (escenario 5 detallado con este diseño).
5. **Provider KMS/HSM equivalente** (obligatorio en PRODUCTION, §G.1): elección del servicio,
   región, quién administra la KEK, política de acceso y rotación, y su incorporación como
   subprocesador en `SUBPROCESSORS.md` y en el Aviso.
6. **Autenticación reciente** para configurar, sustituir y deshabilitar: decidida (§D.1). Queda
   pendiente evaluar un segundo factor como mejora posterior.
7. **Allowlist de CA de prueba** (§M.0): obtener, con autorización, los certificados oficiales
   de la CA de prueba del SAT o del PAC y versionarlos con hash, origen y fecha; sin ella no se
   custodia ningún CSD fuera de los tests automatizados.

---

## AC. Pruebas obligatorias

Unitarias (sin red, certificados sintéticos generados en el test):

- Parseo de `.cer` válido; rechazo de PEM, CA, no X.509, RSA < 2048, extensión inválida.
- `.key` cifrada válida; `.key` sin cifrar, corrupta o no PKCS#8 ⇒ `CSD_KEY_INVALID`.
- Contraseña correcta / incorrecta ⇒ `CSD_PASSWORD_INVALID`.
- Llave que no corresponde ⇒ `CSD_KEY_MISMATCH`.
- Vencido / aún no vigente.
- RFC extraído con la regla documentada; RFC distinto ⇒ `CSD_RFC_MISMATCH`.
- NoCertificado según la regla documentada.
- Envelope: cifra/descifra; IV único; AAD alterada (org, csd, cert, ambiente) ⇒ falla; tag
  alterado ⇒ falla; versión de KEK ausente ⇒ `KEY_UNAVAILABLE`; KEK con longitud inválida ⇒
  provider no disponible; ausencia de KEK ⇒ nunca key por defecto.
- Rotación: rewrap conserva el ciphertext y descifra con la versión nueva.
- Mapeo de errores sin texto de OpenSSL.
- Redacción de PEM/llaves/contraseñas.

Integración (PGlite + Prisma):

- Migración aditiva y `verify-schema`.
- Un solo `ACTIVE` por Organization bajo concurrencia.
- Sustitución y deshabilitado eliminan `CsdPrivateKey`; conflicto con `expectedActiveCsdId`.
- Idempotencia con el mismo certificado.
- Cross-tenant: lectura, historial, deshabilitado, sustitución y ciphertext copiado.
- Las consultas de metadata no seleccionan `CsdPrivateKey`.
- Auditoría con metadata permitida y sin marcas secretas.

E2E (servidor local + PGlite, nunca Neon):

- Multipart real; OWNER/ADMIN vs MEMBER; mismo origen; rate limiting.
- Marcas sintéticas de contraseña/llave ausentes de logs, respuestas, `AuditEvent`,
  `ActivityLog` y HTML.
- `CSD_SERVICE_UNAVAILABLE` sin KeyProvider; bloqueo en producción sin Legal gate.
- Provider `env` permitido en fiscal SANDBOX con un CSD de prueba también con
  `VERCEL_ENV=production`; bloqueado con `PAC_ENVIRONMENT=PRODUCTION`, entitlement
  `PRODUCTION`, CSD `PRODUCTION` o cualquier certificado no demostrado de prueba (§G.1, §M.0).
- `CSD_KEY_PROVIDER_PRODUCTION=env` se trata como configuración inválida.
- KMS de PRODUCTION no disponible ⇒ `CSD_SERVICE_UNAVAILABLE` y sin firma; nunca se usa `env`
  en su lugar.
- §M.0: certificado firmado por la CA sintética de prueba ⇒ aceptado en SANDBOX; certificado de
  otra CA ⇒ `CSD_ENVIRONMENT_MISMATCH`; allowlist vacía ⇒ ninguna custodia fuera de tests.
- Autenticación reciente: sesión creada hace más de la ventana ⇒ `CSD_REAUTH_REQUIRED` para
  configurar, sustituir y deshabilitar, sin leer archivos ni contraseña; sesión renovada pero
  antigua sigue sin contar como reciente; ventana inválida usa 900 s.
- CSD vencido: `EXPIRED`, no firma, la llave sigue cifrada; sustituir o deshabilitar la elimina
  en la misma transacción.
- Auditoría con los nombres de §Q y sin eventos de CSD en `ActivityLog`.
- `/dashboard/stamping` es la única página que invoca mutaciones de CSD.

Validación de reglas reales: con CSD de prueba oficiales (fuera del repositorio), cuando se
autorice obtenerlos.

---

## AD. Criterios de aceptación

1. Configurar, sustituir, deshabilitar y consultar funcionan según §C–§L con las pruebas de
   §AC en verde.
2. Ninguna prueba ni revisión encuentra contraseña, llave, ciphertext, IV, tag, DEK o KEK en
   respuestas, logs, auditoría, analytics, HTML o Git.
3. Sin KeyProvider configurado, con el provider `env` en fiscal PRODUCTION, con un
   certificado no demostrado de prueba en SANDBOX o con el KMS de PRODUCTION no disponible, el
   sistema falla cerrado y nunca cae a `env`.
4. Las reglas §M.7, §M.8 y §M.11 están sustentadas con fuentes oficiales y probadas con los CSD
   de prueba del SAT, o el bloque se detiene con un reporte.
5. `npm run security:check`, lint, typecheck, tests, build, `git diff --check` y E2E relevantes
   en verde.
6. Migración aditiva no aplicada en Neon.
7. Tipos publicados intactos; adiciones solo en `src/types/csd.ts`.
8. Mutaciones de CSD solo con autenticación reciente y solo desde `/dashboard/stamping`.
9. Ninguna dependencia nueva sin auditoría y aprobación explícita; ningún motor XSLT sin pasar
   el gate de §AA.5.3.

---

## AE. Fuera de alcance

- Construcción de XML, cadena original, sello de CFDI, PAC, timbrado, cancelación (fases
  siguientes; §AA solo los prepara).
- e.firma en cualquier forma.
- Múltiples CSD activos por Organization, sucursales o series.
- Timbrado desatendido o automático.
- Guardar la contraseña para uso posterior.
- Consulta de vigencia/LCO del CSD ante el SAT.
- Integración con un KMS/HSM real (en esta fase solo la interfaz; es **requisito** antes de
  PRODUCTION, §G.1).
- Segundo factor de autenticación (la autenticación reciente sí está en alcance, §D.1).
- Instalar o aprobar dependencias de XSLT, XSD o CFDI (§AA.5).
- Descargar CSD de prueba (requiere autorización posterior).
- Una segunda pantalla de configuración del CSD fuera de `/dashboard/stamping`.
- Modificar el Aviso de Privacidad o los Términos.
- Descarga del certificado o de la llave.

---

## División de trabajo

| Área | Claude | Codex |
|---|---|---|
| Prisma, migración | `prisma/schema.prisma`, `prisma/migrations/2026101x_phase5c3_csd_custody/` | — |
| Criptografía y certificados | `src/lib/csd/**` | — |
| Servicios y APIs | `src/services/csd*.ts`, `src/app/api/csd/**` | — |
| Auditoría y redacción | `src/lib/audit.ts`, `src/lib/security/redact.ts` | — |
| Tipos compartidos | `src/types/csd.ts` (escribe) | lee; cambios por acuerdo |
| Pruebas backend | `tests/csd*.test.ts`, `scripts/csd-e2e.mjs` | — |
| Documentación | este contrato, `CLAUDE-FASE5C3.md`, docs de seguridad | `CODEX-FASE5C3.md` (lectura) |
| UI de configuración (única) | — | `src/app/dashboard/stamping/**` (hoy redirige a `/dashboard/invoices/new`; pasa a ser la página del CSD), `src/components/csd/**`, transporte cliente, mapeo de códigos a mensajes |
| Resumen en otras pantallas | — | Perfil Fiscal e Invoice Studio: solo estado/resumen y enlace a `/dashboard/stamping`; sin formularios de CSD |
| E2E existente afectada | — | `scripts/e2e.mjs:855` hoy espera que `/dashboard/stamping` redirija a `/dashboard/invoices/new`. **No se modifica en este commit documental**; esa expectativa se actualiza junto con la implementación real de la pantalla `/dashboard/stamping` |
| Pruebas UI | — | `tests/csd-ui*` |
| Analytics | No añade rutas | No añade rutas de CSD a `analytics-policy.ts` |

Ningún agente edita archivos del otro. `src/types/fiscal-identity.ts` y
`src/types/stamping.ts` no se modifican en esta fase.
