# ORBIT NEXUS — CLAUDE · Fase 5C.3 (CSD Security)

## Rol

Backend, seguridad, Prisma, criptografía, certificados y, en la fase siguiente, XML/firma.
Worktree `ORBIT NEXUS - CLAUDE`, rama `claude/fase5c3-csd-security` creada desde
`origin/main` (`21c8053`).

---

# 1. Lectura obligatoria

1. `AGENTS.md`, `CLAUDE.md`, `docs/WORKTREE-RULES.md`.
2. `docs/tasks/FASE5C3-CONTRACT.md` (autoridad de esta fase).
3. `docs/tasks/FASE5C-CONTRACT.md` §5, §12, §13, §16, §23, §25, §27.8, §28, §35.2, §36, §37.
4. `docs/tasks/FASE5C2-CONTRACT.md` (clasificación, auditoría, redacción, rate limiting).
5. `src/types/fiscal-identity.ts` (tipos CSD publicados) y `src/types/stamping.ts`.
6. Antes de escribir código Next.js: la guía correspondiente en `node_modules/next/dist/docs/`.

---

# 2. Reglas

- No commit, push, merge, rebase, cherry-pick ni reset sin instrucción explícita.
- No Neon, no producción, no deploy, no migraciones aplicadas fuera de PGlite.
- No PAC real, no requests externos, no credenciales.
- No secretos reales; ningún certificado o llave real en el repositorio, ni siquiera de prueba
  oficial del SAT (se usan fuera del árbol o se generan sintéticos en los tests).
- No modificar archivos de Codex (UI, `src/components/**`, `src/app/dashboard/**`,
  `src/lib/analytics-policy.ts`, `src/lib/display.ts`).
- No modificar `src/types/fiscal-identity.ts` ni `src/types/stamping.ts`; las adiciones van
  en `src/types/csd.ts`. Si una adición rompe compatibilidad: detenerse y reportar.
- La única UI de administración del CSD es `/dashboard/stamping` (Codex). Las APIs no se
  diseñan para una segunda pantalla de configuración.
- No modificar el Aviso de Privacidad ni los Términos.
- Dependencias: preferir `node:crypto`. Antes de añadir cualquiera, reportar licencia,
  mantenimiento, CVEs, uso de `eval`/`new Function`, tamaño y compatibilidad con Vercel.
  GPL/AGPL/LGPL/propietaria ⇒ detenerse.
- Ante incertidumbre criptográfica, de RFC, vigencia o autorización: **no firmar, no guardar**
  (FASE5C §13.7).

---

# 3. Plan por bloques

Cada bloque termina con validación y reporte; el siguiente requiere autorización.

## Bloque 1 — Núcleo criptográfico (sin Prisma, sin APIs)

Archivos: `src/lib/csd/` (certificado, llave, ASN.1 mínimo, errores, envelope, KeyProvider
`env`), `tests/csd-crypto.test.ts`.

1. Verificar con fuentes oficiales del SAT las reglas pendientes del contrato. Los CSD de prueba
   para SANDBOX se necesitan pero **no se descargan todavía**: la obtención requiere
   autorización explícita; nunca se usan CSD productivos de clientes como fixtures. Reglas:
   - §M.7 ubicación y formato del RFC en el subject;
   - §M.8 derivación de NoCertificado desde el número de serie;
   - §M.11 esquema PBE de la `.key` y compatibilidad con OpenSSL 3 de Node sin proveedor
     legacy;
   - cualquier propiedad oficial que distinga CSD de e.firma (si no existe:
     `csdTypeVerifiedLocally: false`);
   - §M.0 certificados oficiales de la CA de prueba (SAT o PAC) para demostrar que un CSD es
     de prueba; los tests usan una CA sintética inyectada solo en el entorno de pruebas.
   Si alguna regla no se puede sustentar: detenerse y reportar antes de implementarla.
   SANDBOX usa solamente CSD de prueba; nunca CSD productivo de un cliente como fixture, llave
   real en el repositorio, secretos reales en tests ni certificados productivos en CI.
2. Validación §M (pasos 4–13) como funciones puras sobre buffers, con mapeo a `CsdApiErrorCode`
   y sin texto de OpenSSL.
3. Envelope §H/§I y `CsdKeyProvider` §G (`env`), sin key por defecto.
4. Rewrap §J como función pura (el script de operador va en el Bloque 3).
5. Generación de certificados sintéticos en tests: `node:crypto` genera llaves y exporta PKCS#8
   cifrado, pero **no** crea certificados X.509. Opciones a evaluar y reportar antes de
   instalar: `@peculiar/x509` (MIT) como devDependency, o fixtures sintéticos generados con
   OpenSSL fuera del repositorio. Los archivos `.cer`/`.key` versionados chocan con
   `npm run security:check`: preferir generación en tiempo de test.
6. Pruebas unitarias §AC (bloque unitario).

## Bloque 2 — Persistencia, servicios y APIs

Archivos: `prisma/schema.prisma`, migración `2026101x_phase5c3_csd_custody`,
`src/services/csd.ts` (sesión) + módulo sin sesión para pruebas, `src/app/api/csd/**`,
`src/types/csd.ts`, `src/lib/audit.ts`, `src/lib/security/redact.ts`, `.env.example`
(solo nombres vacíos), `tests/csd-*.test.ts`, `scripts/csd-e2e.mjs`.

1. Modelos y migración aditiva §E/§F; `prisma migrate deploy` en PGlite efímera,
   `verify-schema`, test de aditividad.
2. Servicio con bloqueo por Organization, idempotencia §U, sustitución §K, deshabilitado §L.
3. Rutas §O con multipart de 64 KiB, mismo origen, roles, rate limiting §T.
4. Texto de custodia versionado (`GET /api/csd/custody-terms`) con redacción provisional
   marcada para revisión jurídica (§AB.2); nunca presentado como aprobado.
5. Auditoría §Q solo en `AuditEvent`, con el estilo del catálogo: `csd.configuration.started`,
   `csd.configured`, `csd.configuration.failed`, `csd.replaced`, `csd.disabled` (retirar la
   reservada `csd.revoked`). Sin eventos de CSD en `ActivityLog` ni nombres en mayúsculas.
6. Autenticación reciente §D.1 (`CSD_REAUTH_WINDOW_SECONDS`, 900 por defecto, basada en
   `Session.createdAt`) antes de leer archivos o contraseña en configurar, sustituir y
   deshabilitar; `CSD_REAUTH_REQUIRED`.
7. Gates §G.1, §M.0 y §Z.4, por **ambiente fiscal** (no por `VERCEL_ENV`):
   - provider `env` permitido en desarrollo, pruebas y fiscal SANDBOX (aunque corra en Vercel
     production), solo con CSD demostrados de prueba (CA allowlisted);
   - bloqueado con `PAC_ENVIRONMENT=PRODUCTION`, entitlement o CSD `PRODUCTION`, CSD
     productivo real o timbrado real: `CSD_SERVICE_UNAVAILABLE` / `CSD_ENVIRONMENT_MISMATCH`;
   - fiscal PRODUCTION exige provider externo (`CSD_KEY_PROVIDER_PRODUCTION=kms:<id>`); si no
     está disponible, `CSD_SERVICE_UNAVAILABLE` y no se firma; nunca fallback a `env`;
   - Legal gate obligatorio en fiscal PRODUCTION.
8. Sustituir y deshabilitar eliminan `CsdPrivateKey` en la misma transacción; un CSD vencido
   conserva su llave cifrada hasta entonces (§X).
9. Pruebas de integración y E2E §AC, incluida la búsqueda de marcas sintéticas en logs,
   respuestas, auditoría y HTML.

## Bloque 3 — Operación

1. Script de rewrap de KEK idempotente (solo PGlite en pruebas; nunca Neon sin autorización).
2. Actualizar `INCIDENT-RESPONSE.md` (escenario 5), `DATA-RETENTION.md` y
   `SUBPROCESSORS.md` con el diseño implementado.
3. Lista final del Legal Production Gate para el operador.

## Fase siguiente — CFDI (no autorizada todavía)

Preparación según §AA. ORBIT construye el XML, genera la cadena original, sella y verifica el
sello; SW solo timbra el XML previamente sellado (nunca "Emisión Timbrado" ni "Emisión
Timbrado JSON"). Recursos SAT versionados con SHA-256, origen y fecha, nunca descargados en
runtime. Decisión previa obligatoria: mecanismo de cadena original y validador XSD (§4 y
contrato §AA.5).

---

# 4. Dependencias a evaluar (no instalar sin autorización)

| Necesidad | Primera opción | Nota |
|---|---|---|
| X.509, PKCS#8, RSA-SHA256 | `node:crypto` | Sin dependencia |
| ASN.1 del subject (OID 2.5.4.45) | Lector DER mínimo propio para lectura, o `@peculiar/asn1-schema`/`@peculiar/x509` (MIT) | Lectura, no criptografía casera |
| Certificados sintéticos en tests | `@peculiar/x509` (MIT) como devDependency | Alternativa: OpenSSL fuera del repo |
| XML CFDI | `fast-xml-parser` (MIT, ya instalado) | `XMLBuilder` con orden controlado |
| Cadena original (XSLT oficial) | **Ninguna aprobada** | Obligatorio ejecutar la XSLT oficial del SAT; nunca reimplementar sus reglas en producción. Descartados: `xslt-processor` (LGPL-3.0), Saxon-JS (propietaria), `@cfdi/transform` como implementación principal (reimplementa el comportamiento), bindings nativos de libxslt salvo que no haya alternativa segura. Único candidato a auditar: `@tradik/xslt-processor` (BSD-3-Clause; contrato §AA.5.2) |
| Validación XSD | **Ninguna aprobada** | Candidatos a auditar: `@cfdi/xsd` (usa `ajv` con `new Function`) y `xmllint-wasm` |
| Utilidades de CSD | `node:crypto` | `@cfdi/csd` descartado: arrastra `node-forge` con un advisory HIGH en verificación RSA PKCS#1 v1.5 y `@clir/openssl` ejecuta procesos (§AA.5.1) |

Ningún motor XSLT se aprueba sin pasar el gate obligatorio de §AA.5.3 (XSLT oficiales locales,
includes allowlisted, sin red, cadenas exactas, CFDI de prueba, sello verificable, fixtures de
espacios/Unicode/decimales/complementos). Si ninguno lo pasa, la fase se detiene (§AA.5.4); el
fallback es un runtime o servicio interno separado con motor auditado y las mismas interfaces
(§AA.5.5). Ningún candidato se instala sin aprobación explícita.

---

# 5. Validación de cada bloque

`npm run db:generate` (si cambia Prisma), `npm run typecheck`, `npm run lint`, `npm test`,
`npm run build`, `npm run security:check`, `git diff --check`, E2E relevantes
(`node scripts/csd-e2e.mjs`, `node scripts/phase5c-e2e.mjs`, `npm run test:phase3:e2e`),
`git status --short`.

Reporte: archivos, migraciones (no aplicadas), dependencias, resultados exactos, riesgos,
dependencias con Codex, `git status --short`.
