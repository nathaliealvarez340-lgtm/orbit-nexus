# ORBIT NEXUS · Fase 5C.6 — Sello digital CFDI 4.0 con el CSD custodiado

Rama `claude/fase5c6-csd-signing` (base `584a001`). Sin PAC, sin timbrado, sin UUID/TFD, sin
`READY → ISSUED`, sin migraciones, sin Neon, sin despliegue. Ninguna ruta llama al sello todavía:
lo usará el bloque de timbrado después de la autorización por factura (§13).

## 1. Resultado

| Pieza | Estado |
|---|---|
| Algoritmo | RSA + SHA-256, **PKCS#1 v1.5** (`RSA_PKCS1_PADDING` explícito), sobre los bytes UTF-8 de la cadena original; Base64 estándar |
| Firma (`CsdVault.sign`) | `signCfdi40OriginalString` (`src/services/csd-signing.ts`) sobre `signWithCustodiedKey` (`src/lib/csd/signing.ts`) |
| Sello completo | `sealCfdi40WithActiveCsd`: cadena oficial → firma → `Sello` en el mismo árbol pre-sello → verificación del XML final → `SealedCfdi40Xml` |
| Único constructor de `SealedCfdi40Xml` | `createSealedCfdi40` (`src/lib/cfdi40/sealed.ts`); no registra nada si el sello no verifica |
| Verificación de un XML sellado | `sealedCfdi40XmlProblems`: recalcula la cadena con la XSLT oficial desde el XML y verifica `Sello` con su `Certificado` |
| PRODUCTION | **Bloqueado** (fail closed): faltan KMS/HSM, Legal Production Gate y los gates de evidencia `CSD_TYPE_VERIFIED`, `OFFICIAL_CSD_FIXTURE_VALIDATED`, `POSTGRES_CSD_CONCURRENCY_VALIDATED` (§10, `src/lib/csd/production-gates.ts`) |
| Evidencia | OpenSSL CLI, .NET CNG y `node:crypto` producen el **mismo** sello byte a byte; 10 CFDI del PAC sellados con el CSD de prueba del SAT verifican con el verificador de ORBIT (§11) |
| Matriz de gates | §16 |

## 2. Algoritmo

Anexo 20 / FASE5C §16.2 / FASE5C3 §AA.6:

1. Bytes UTF-8 de la cadena original exactamente como la produjo la XSLT oficial (Fase 5C.5).
2. `crypto.sign("sha256", bytes, { key, padding: RSA_PKCS1_PADDING })`: RSASSA-PKCS1-v1_5
   (RFC 8017 §8.2) con SHA-256. Solo `node:crypto` (OpenSSL); sin criptografía propia.
3. `Sello` = Base64 estándar de la firma: sin saltos de línea, espacios, prefijos ni PEM; su
   longitud es la del módulo (256 bytes → 344 caracteres en RSA 2048).

El padding se pasa **siempre** de forma explícita (`cfdiSealAlgorithm`), y una llave `rsa-pss`
se rechaza: ningún valor por defecto de una librería puede convertir el sello en RSA-PSS. Las
pruebas lo fijan: firma determinista, verificación PKCS#1 sí y PSS no, y la operación pública
RSA recupera `DigestInfo(SHA-256) ‖ SHA-256(cadena)` (estructura EMSA-PKCS1-v1_5).

## 3. Flujo

```
Draft READY ─ buildPreSealCfdi40 (binding del certificado público del CSD VALID, 5C.5)
   ▼
PreSealCfdi40Xml (registrado; árbol guardado)
   ▼  generateCfdi40OriginalString (XSLT oficial, motor aprobado)
Cfdi40OriginalString (registrada; ligada al SHA-256 del pre-sello)
   ▼  signCfdi40OriginalString — transacción con FOR SHARE sobre el CsdCertificate ACTIVE:
   │    revalidar TODO (§5) → abrir llave (KeyProvider → DEK → PKCS#8 → KeyObject)
   │    → firmar → verificar con el certificado → devolver solo { sello, metadata }
   ▼  createSealedCfdi40
   │    verificar Sello sobre la cadena firmada → insertar Sello en el MISMO árbol
   │    → XML final = pre-sello + ` Sello="…"` (nada recalculado)
   │    → cadena recalculada desde el XML final = cadena firmada
   │    → Sello verifica con el Certificado escrito en el XML → registrar
   ▼
SealedCfdi40Xml ──► (siguiente gate) XSD ──► PAC
```

| Módulo | Responsabilidad |
|---|---|
| `src/lib/csd/signing.ts` | `cfdiSealAlgorithm`, `signCfdiSeal`, `verifyCfdiSeal`, `signWithCustodiedKey` |
| `src/lib/csd/decipher.ts` | Descifrado GCM que sobrescribe las partes intermedias de texto plano |
| `src/services/csd-signing.ts` | `signCfdi40OriginalString` (CsdVault.sign) y `sealCfdi40WithActiveCsd` (sello completo + auditoría); `server-only` |
| `src/lib/cfdi40/sealed.ts` | `createSealedCfdi40`, `sealedCfdi40XmlProblems`, `isSealedCfdi40`, `pacSubmission` |
| `src/lib/cfdi40/serialize.ts` | `serializeSealedCfdi40` (mismo árbol + `Sello`), `preSealIssuerRfc` |
| `src/lib/cfdi40/original-string.ts` | Registro de cadenas generadas (`isCfdi40OriginalString`) |

Tipos: `UnsignedCfdi40Xml` → `PreSealCfdi40Xml` → `Cfdi40OriginalString` → `SealedCfdi40Xml`,
cada uno con marca de tipo y registro en tiempo de ejecución. TypeScript rechaza un XML sin
sellar, un pre-sello o una cadena donde se exige `SealedCfdi40Xml`, y ningún literal puede
serlo; en ejecución, solo lo registrado por `createSealedCfdi40` (y sin cambios) pasa.

## 4. Ciclo de vida de la llave privada

1. La contraseña de la `.key` **no** se vuelve a pedir: se usó una sola vez al configurar (5C.3)
   y no existe en ningún lado. La firma no la recibe (ni como parámetro).
2. Dentro de la transacción, tras todas las comprobaciones: `CsdPrivateKey` (ciphertext, IV,
   tag, DEK envuelta) → `KeyProvider.unwrapDataKey` (DEK) → AES-256-GCM con AAD → PKCS#8 DER
   en un `Buffer` → `createPrivateKey` → `KeyObject`.
3. La DEK se sobrescribe con ceros al terminar `openPrivateKey`; el PKCS#8, en cuanto OpenSSL lo
   parsea (antes de firmar); las partes intermedias de `update()`/`final()` también
   (`decipherAll`, incluida la parte no autenticada si el tag GCM falla).
4. El `KeyObject` nunca sale de `signWithCustodiedKey`: firma, verificación y se descarta. No hay
   caché: cada firma vuelve a abrir el sobre (prueba: N firmas = N aperturas).
5. Nunca: cliente/navegador, respuesta API, logs, analytics, metadata de auditoría, archivos
   temporales.

**Zeroization realista (límites):** sobrescribimos los `Buffer` que ORBIT controla. No podemos
borrar: la copia de la llave dentro de OpenSSL (`KeyObject`/`EVP_PKEY`) ni la clave de
`createDecipheriv`, que se liberan cuando el recolector de basura las libera; cadenas de
JavaScript (inmutables); copias que V8 u OpenSSL hagan internamente. No afirmamos que la memoria
gestionada por V8/OpenSSL quede borrada: es un esfuerzo razonable, no una garantía. La defensa
real es la vida corta (milisegundos), sin caché y la custodia con KEK fuera de la base.

## 5. Comprobaciones antes de abrir la llave

En `signCfdi40OriginalString`, en este orden; el primer fallo detiene y la llave **no** se abre:

| # | Comprobación | Código |
|---|---|---|
| 1 | Rol OWNER/ADMIN (FASE5C3 §D) | `CSD_FORBIDDEN` |
| 2 | XML pre-sello producido por ORBIT y sin cambios | `PRE_SEAL_CFDI_REQUIRED` |
| 3 | Cadena producida por ORBIT, de ese mismo pre-sello y con su `NoCertificado` | `ORIGINAL_STRING_INVALID` |
| 4 | Custodia disponible para el ambiente fiscal; en PRODUCTION nunca `env` ni sin Legal gate | `CSD_SERVICE_UNAVAILABLE` |
| 5 | `FOR SHARE` sobre el CSD `ACTIVE` de **esta** Organization | `CSD_NOT_CONFIGURED` |
| 6 | Ambiente del CSD = ambiente fiscal | `CSD_ENVIRONMENT_MISMATCH` |
| 7 | Estado efectivo `VALID` (§C.2), calculado bajo el bloqueo | `CSD_EXPIRED` / `CSD_NOT_VALID` / `CSD_KEY_UNAVAILABLE` |
| 8 | DER guardado = registro (SHA-256, serie, NoCertificado); X.509 RSA 2048–8192, no CA | `CSD_CERTIFICATE_MISMATCH` |
| 9 | El XML lleva exactamente ese certificado (un pre-sello previo a una sustitución no) | `CSD_CERTIFICATE_MISMATCH` |
| 10 | RFC del certificado = registro = `Emisor/@Rfc` del CFDI (el del Perfil Fiscal ya se exigió en 7) | `CSD_RFC_MISMATCH` |
| 11 | §M.0: en SANDBOX, certificado emitido por una CA de prueba de la allowlist; en PRODUCTION, nunca | `CSD_ENVIRONMENT_MISMATCH` |
| 12 | Sobre del provider configurado y versión de KEK disponible | `CSD_KEY_UNAVAILABLE` |
| 13 | Vigencia otra vez en el instante de abrir la llave | `CSD_EXPIRED` / `CSD_NOT_VALID` |

Después de abrir: sobre íntegro (`CSD_KEY_INTEGRITY_FAILED`), llave del certificado
(`checkPrivateKey`, `CSD_KEY_MISMATCH`), firma (`CFDI_SEAL_FAILED`) y verificación con la llave
pública del certificado (`CFDI_SEAL_VERIFICATION_FAILED`).

**CSD frente a e.firma:**

- ORBIT **no dispone actualmente de una regla offline suficientemente confiable**, usando solo
  las comprobaciones X.509 locales actuales, para afirmar que un certificado es CSD y no e.firma
  (`csdTypeVerifiedLocally: false`).
- Eso **no** significa que el SAT no los distinga: el SAT mantiene una clasificación oficial de
  certificados (FIEL / SELLOS), y la emisión mediante proveedor de certificación (PAC) requiere
  CSD.
- Antes de habilitar timbrado productivo debe existir un **mecanismo verificable** que confirme
  que el certificado es realmente un CSD: respaldado por una fuente del SAT, un PAC autorizado u
  otro mecanismo oficial o contractualmente fiable (gate `CSD_TYPE_VERIFIED`, §10).
- No se usan heurísticas por subject, issuer u OID sin evidencia oficial, ni scraping del SAT.
- Hasta entonces: texto de custodia, allowlist de CA de prueba en SANDBOX y fail closed en
  PRODUCTION. (FASE5C3, decisión 6 y §M, dice "mientras no exista una propiedad oficial
  documentada"; aquí se lee como "mientras ORBIT no tenga una verificación fiable", no como que el
  SAT no distinga los tipos.)

## 6. Errores

`Cfdi40Error` con códigos estables (`src/lib/cfdi40/errors.ts`), categoría, ruta y regla; mensaje
`CFDI40_BUILD_FAILED`. Nuevos: `CSD_NOT_CONFIGURED`, `CSD_EXPIRED`, `CSD_ENVIRONMENT_MISMATCH`,
`CSD_RFC_MISMATCH` (CERTIFICATE); `CSD_FORBIDDEN`, `CSD_SERVICE_UNAVAILABLE`,
`CSD_KEY_UNAVAILABLE`, `CSD_KEY_INTEGRITY_FAILED`, `CSD_KEY_MISMATCH`, `CFDI_SEAL_FAILED`
(SIGNING); `CFDI_SEAL_VERIFICATION_FAILED` (SEAL). Se reutilizan `CSD_NOT_VALID`,
`CSD_CERTIFICATE_MISMATCH`, `ORIGINAL_STRING_INVALID` y `PRE_SEAL_CFDI_REQUIRED`. Cualquier
error inesperado (base de datos, motor) se convierte en `CFDI_SEAL_FAILED`.

Ningún error contiene PKCS#8, DEK, ciphertext, llave envuelta, IV, tag, cadena original, XML,
contraseña ni texto de OpenSSL (prueba de serialización).

## 7. XML sellado e inmutabilidad

- El XML sellado se escribe con el **mismo árbol** del pre-sello más `Sello` en su posición de
  `cfdv40.xsd` (después de `Fecha`, antes de `FormaPago`); se exige que sea el pre-sello con
  exactamente ` Sello="…"` insertado. No se recalcula fecha, conceptos, importes, impuestos,
  emisor, receptor ni namespaces.
- `NoCertificado` y `Certificado` vienen del pre-sello (certificado público del CSD `VALID`).
- Se verifica el XML final como lo haría un PAC: cadena recalculada con la XSLT oficial desde el
  XML sellado, igual a la firmada, y `Sello` válido con el `Certificado` del XML.
- Pruebas de alteración (`sealedCfdi40XmlProblems` → `SELLO_NOT_VERIFIED`): importe, importe de
  concepto, total, RFC emisor y receptor, fecha (+1 s), descripción, impuesto, tasa, otro
  `NoCertificado`, otro `Certificado`, un carácter del `Sello`, y un solo byte en cuatro
  posiciones del contenido fiscal. Un `SealedCfdi40Xml` registrado y modificado en memoria deja
  de ser sellado y el PAC lo rechaza.

## 8. Concurrencia

- **Bloqueo:** la firma mantiene `FOR SHARE` sobre la fila `ACTIVE` de `CsdCertificate` durante
  validación, apertura, firma y verificación. Sustituir o deshabilitar hace `UPDATE` de esa fila
  (y después borra la llave): espera a que la firma termine. Si la sustitución gana, la firma ya
  no encuentra ese CSD `ACTIVE` (`CSD_NOT_CONFIGURED`) o el pre-sello lleva otro certificado
  (`CSD_CERTIFICATE_MISMATCH`, hay que reconstruirlo). Dos firmas simultáneas son compatibles
  (`FOR SHARE`) y no bloquean la asignación de folios (no se toca la fila `Organization`).
- **CSD que vence entre la lectura y la firma:** la vigencia se evalúa bajo el bloqueo y otra vez
  justo antes de abrir la llave (`CSD_EXPIRED`, llave sin abrir).
- **Dos solicitudes para la misma factura:** PKCS#1 v1.5 es determinista: mismo XML, mismo
  sello; nada se persiste en esta fase. Evitar dos envíos al PAC es responsabilidad de
  `StampAttempt` e idempotencia (FASE5C §18), en el bloque de timbrado.
- Prueba (PGlite): sustitución y deshabilitado solicitados mientras una firma está detenida en la
  apertura terminan **después** de ella; luego el pre-sello anterior se rechaza.
- **Límite:** la semántica `FOR SHARE` frente al `UPDATE` de una sustitución está diseñada para
  PostgreSQL. PGlite es una sola sesión que serializa las transacciones: verifica el
  comportamiento funcional y el orden observable, pero **no** constituye prueba definitiva del
  bloqueo concurrente real de PostgreSQL/Neon. Gate productivo
  `POSTGRES_CSD_CONCURRENCY_VALIDATED = false` hasta probarlo con sesiones concurrentes en un
  PostgreSQL real (no en Neon de producción; esta fase no se conecta a Neon).

## 9. Auditoría

`AuditEvent` (catálogo de Fase 5C.2), escrito por `sealCfdi40WithActiveCsd`:

| Acción | Resultado | Objetivo | Metadata permitida |
|---|---|---|---|
| `cfdi.sealed` | `SUCCESS` | `StampedInvoice` (`invoiceId` del servidor) | `certificateId` (UUID del CSD), `environment` |
| `cfdi.seal.failed` | `FAILURE` (`DENIED` para `CSD_FORBIDDEN`) | ídem | `errorCode`, `certificateId`, `environment` |

Nunca: `Sello`, cadena original, XML, certificado ni material de llave (prueba que recorre toda
la tabla). Sin evento "started": el sello es atómico y no persiste nada intermedio; el estado
`SIGNING` de `StampAttempt` cubrirá el "en curso" en el bloque de timbrado. `ActivityLog` no
recibe eventos de sello.

## 10. Ambientes y producción

| Capacidad | SANDBOX | PRODUCTION |
|---|---|---|
| Cadena original | Sí | Sí |
| CSD de prueba con provider `env` | Sí (solo certificados de una CA de prueba allowlisted) | No |
| CSD productivo con provider `env` | No | No |
| KMS/HSM | N/A | **Requerido** (no existe) |
| Firma | Sí (CSD sintético de una CA de prueba controlada) | **BLOQUEADA** hasta KMS/HSM + Legal gate + gates de evidencia |
| PAC | No | No |
| `ISSUED` | No | No |

- El ambiente fiscal (`PAC_ENVIRONMENT`) decide; `VERCEL_ENV` nunca (un despliegue de Vercel
  production en fiscal SANDBOX firma con CSD de prueba; probado).
- PRODUCTION falla cerrado en varios niveles: `resolveCustody` (provider `env` inválido, `kms:*`
  sin implementar, `productionLegalGateSatisfied = false`); la firma lo repite aunque reciba un
  objeto de custodia "disponible" y además exige los gates de evidencia (§10.1, código
  `src/lib/csd/production-gates.ts`); y un CSD de prueba nunca se acepta en PRODUCTION (§M.0).
- `env` **nunca** puede convertirse en fallback productivo: no hay fallback KMS → `env`. Nada se
  habilitó para que una prueba pase.

**PRODUCTION SIGNING = BLOCKED** hasta que exista, para KMS/HSM:

1. proveedor seleccionado (servicio y región);
2. implementación real detrás de `CsdKeyProvider` (`kms:<id>`);
3. gestión de la KEK y de las llaves (la KEK nunca sale del KMS/HSM ni llega a la base);
4. rotación (y re-envoltura sin la contraseña del usuario);
5. permisos mínimos (solo el proceso de firma puede descifrar);
6. auditabilidad del uso de la KEK;
7. recuperación ante pérdida o compromiso (incluida la ventana de respaldos de Neon);
8. pruebas (disponibilidad, contexto/AAD, rotación, falla cerrada sin fallback);

además de incorporarlo como subprocesador (`SUBPROCESSORS.md`, Aviso de Privacidad), el Legal
Production Gate (FASE5C3 §AB) y la cadena a las CA productivas del SAT (§M.0). Solo entonces, con
autorización, `productionLegalGateSatisfied` puede cambiar.

### 10.1 Gates de evidencia para PRODUCTION (`src/lib/csd/production-gates.ts`)

Constantes en código, todas `false`; la firma en fiscal PRODUCTION exige que las tres sean
`true` (además de KMS/HSM y Legal gate) y, si no, responde `CSD_SERVICE_UNAVAILABLE`. Una prueba
falla a propósito si alguna cambia. Solo cambian con la evidencia y autorización explícita.

| Gate | Estado | Qué falta |
|---|---|---|
| `CSD_TYPE_VERIFIED` | `false` | Evidencia de que el certificado aceptado para timbrado corresponde realmente a un CSD válido para ese flujo, por un mecanismo verificable (SAT, PAC autorizado u otro oficial/contractual). PRODUCTION **no** se activa solo porque el certificado sea RSA, el RFC coincida y la firma criptográfica funcione. SANDBOX sintético trabaja con un fixture/CA de prueba controlada |
| `OFFICIAL_CSD_FIXTURE_VALIDATED` | `false` | Ejecutar las reglas de extracción/normalización del RFC (§M.7) y de derivación de `NoCertificado` desde el número de serie (§M.8) contra material oficial de prueba o un fixture de PAC/SAT apto para tests. Hoy son **hipótesis**, no reglas verificadas por el SAT. (Evidencia parcial: el certificado de prueba del SAT incluido en CFDI publicados por el PAC cumple la regla de `NoCertificado`, 5C.5; no sustituye la validación.) Nunca un CSD real de un cliente en el repositorio |
| `POSTGRES_CSD_CONCURRENCY_VALIDATED` | `false` | Probar `FOR SHARE` frente a sustitución/deshabilitado con sesiones concurrentes en PostgreSQL real (§8) |

## 11. Evidencia

| Nivel | Qué prueba |
|---|---|
| Vector independiente (`tests/fixtures/cfdi40/seal`) | Sellos producidos por **OpenSSL 3.5.7** (`openssl dgst -sha256 -sign`) sobre las 10 cadenas de referencia con una llave sintética (descartada). Al generarlos, **.NET Framework 4.8 CNG** (`RSACng.SignData`, `Pkcs1`) y `node:crypto` produjeron bytes idénticos; OpenSSL y .NET los verificaron como PKCS#1 v1.5 y los rechazaron como PSS. En cada `npm test`, ORBIT los acepta y el XML sellado con ellos verifica |
| Interoperabilidad repetible (`tests/cfdi40-seal-interop.test.ts`) | En cada `npm test` donde existan las herramientas: con una llave sintética nueva, los 10 sellos que produce ORBIT por la ruta custodiada (sobre → DEK → PKCS#8 → firma) son **idénticos** a los de OpenSSL CLI y .NET CNG, y ambos los verifican como PKCS#1 v1.5 y no como PSS. Si falta una herramienta, la prueba se marca *skipped* con el motivo |
| CFDI del PAC (SAT test CSD) | Los 10 `SEAL_VERIFIED` de 5C.5 verifican con `sealedCfdi40XmlProblems` (cadena recalculada + `Sello` + `Certificado`); los 5 editados después de sellarse o sin sello, no |
| Estructura PKCS#1 | La operación pública RSA recupera `DigestInfo(SHA-256)` del mensaje |
| Integración | 10 facturas ORBIT (PUE, PPD, IVA 16 %, exento, descuento, varios conceptos, persona física, retenciones, receptor genérico, Unicode, USD) selladas con el CSD custodiado en PGlite; el sello firma la cadena de referencia |

Ninguna de estas pruebas es "verificado por el SAT": son implementaciones independientes de
acuerdo sobre llaves sintéticas y CFDI de prueba del PAC. `child_process` se usa solo en el
generador del vector (herramienta de prueba), nunca en el runtime de ORBIT.

## 12. Rendimiento y memoria

Medido en local (Windows, Node 24.14.1, RSA 2048, 300 iteraciones; mediana / p95, ms):

| Paso | Mediana | p95 |
|---|---|---|
| Compilar la XSLT oficial (una vez por proceso) | 66 | — |
| Cadena original (varios conceptos) | 7.1 | 10.8 |
| Abrir la llave (provider `env`: DEK + AES-GCM) | 0.13 | 0.25 |
| Firma RSA-SHA256 | 1.9 | 3.2 |
| Verificación | 0.1 | 0.2 |
| `createSealedCfdi40` (cadena recalculada + verificaciones) | 10.4 | 14.9 |
| `signWithCustodiedKey` completo | 2.2 | 3.3 |

Memoria tras 500/1000/1500 sellos con GC forzado: `external` y `arrayBuffers` +1 KB (ningún
`Buffer` retenido); `heapUsed` +107/+151/+178 KB, crecimiento que se aplana (código/caches de V8;
los registros son `WeakSet`/`WeakMap`). No hay singleton con `KeyObject` ni caché de llaves
(revisión estática en pruebas). Con un KMS real, abrir la llave añadirá la latencia de red del
KMS dentro de la transacción.

## 13. Autorización por factura y siguiente gate

Que exista un CSD no autoriza a sellar ni timbrar cualquier factura. Orden previsto del bloque de
timbrado:

```
autorización explícita por factura (usuario, Organization, factura, draftVersion; un solo uso;
sin volver a pedir la contraseña)  →  sealCfdi40WithActiveCsd  →  XSD (cfdv40.xsd)  →  PAC sandbox
```

La autorización va **antes** de abrir la llave: el sello es el uso del CSD. `sealCfdi40WithActiveCsd`
no la verifica todavía (no existe `StampRequest` implementado); el bloque de timbrado debe
llamarlo solo después de validarla y con el `invoiceId` resuelto en el servidor.

**XSD:** `cfdi40SchemaValidator.validate(SealedCfdi40Xml)` ya existe como gate y hoy responde
`UNAVAILABLE / NO_APPROVED_XSD_ENGINE` para un CFDI sellado (y `REJECTED` para todo lo demás). La
siguiente fase elige y audita el motor XSD (sin dependencias nuevas en esta). Si el XSD falla, el
XML sellado se descarta y no se envía al PAC.

## 14. Riesgos y límites

1. PRODUCTION bloqueado hasta KMS/HSM, Legal gate y gates de evidencia (intencional, §10).
2. Tipo de certificado: ORBIT no tiene todavía una verificación offline fiable de CSD frente a
   e.firma con sus comprobaciones X.509 locales; el SAT sí distingue FIEL/SELLOS. Gate
   `CSD_TYPE_VERIFIED` (§5, §10.1).
3. Reglas RFC (§M.7) y NoCertificado (§M.8): hipótesis, no verificadas por el SAT. Gate
   `OFFICIAL_CSD_FIXTURE_VALIDATED`; la allowlist oficial de CA de prueba sigue vacía (sin
   custodia fuera de pruebas).
4. Zeroization de mejor esfuerzo (§4).
5. Concurrencia: verificada funcionalmente con PGlite, no con bloqueos reales de PostgreSQL. Gate
   `POSTGRES_CSD_CONCURRENCY_VALIDATED` (§8).
6. La vigencia del certificado en la `Fecha` del CFDI se comprueba al construir el pre-sello
   (`issuedAt`); al firmar se comprueba en el instante de firma. El PAC rechazará además un CFDI
   con `Fecha` demasiado antigua: el timbrado debe ocurrir poco después del sello.
7. Sin XSD aprobado: ningún CFDI sellado puede pasar al PAC todavía.

**Pendiente técnico del harness (no es un defecto del runtime fiscal de 5C.6):** E2E suites that
start Next dev servers must guarantee complete process shutdown before static typecheck/build
execution, because concurrent writes to `.next/dev` generated artifacts can make local
validation flaky. Observado al cerrar 5C.6: tras las E2E, `.next/dev/types/validator.ts` quedó
truncado y, como `tsconfig.json` incluye `.next/dev/types/**/*.ts`, `typecheck` y `build`
fallaron hasta regenerar ese artefacto (sin cambios en código ni pruebas).

## 15. Pruebas

- `tests/cfdi40-seal.test.ts` también fija los tres gates de evidencia en `false`.

- `tests/cfdi40-seal.test.ts`: algoritmo y padding, 10 facturas selladas, vector OpenSSL, CFDI
  del PAC, alteraciones, constructor estricto y tipos, apertura sin caché con DEK/PKCS#8
  sobrescritos, sin red (`fetch`, `net.connect`, `dns.lookup`: 0 intentos), revisión estática.
- `tests/cfdi40-seal-store.test.ts` (PGlite + flujo real de configuración): sello de 10 facturas
  con una apertura cada una y auditoría; cada rechazo con su código y sin abrir la llave;
  auditoría/errores sin secretos; concurrencia.
- Ajustados a la nueva frontera: `tests/cfdi40-hardening.test.ts` (un solo `registry.add`, después
  de la verificación) y `tests/csd-crypto.test.ts` (firmas solo en `private-key.ts` y
  `signing.ts`, con padding explícito).
- Corregido: en `tests/cfdi40-cadena.test.ts` la expresión `/<xsl:output\b…/` contenía un
  carácter de retroceso literal en lugar de `\b` y nunca coincidía; ahora la comprobación de
  `xsl:output` se ejecuta y exige al menos una declaración.
- `tests/cfdi40-seal-interop.test.ts`: ORBIT frente a OpenSSL CLI y .NET CNG con llave nueva.
- Herramienta: `tests/fixtures/cfdi40/seal-interop.mjs` (OpenSSL CLI y .NET CNG; solo pruebas).

## 16. Matriz final de gates (tras 5C.6)

| Gate | Estado |
|---|---|
| Cadena original | PASS |
| Firma RSA/SHA-256 (PKCS#1 v1.5) | PASS |
| Verificación local | PASS |
| Tamper resistance | PASS |
| No-network signing | PASS |
| Private-key lifecycle | PASS |
| XSD oficial | PENDING |
| CSD type official verification (`CSD_TYPE_VERIFIED`) | PENDING |
| Official CSD fixture (`OFFICIAL_CSD_FIXTURE_VALIDATED`) | PENDING |
| Postgres concurrency (`POSTGRES_CSD_CONCURRENCY_VALIDATED`) | PENDING |
| KMS/HSM production | PENDING |
| PAC sandbox | PENDING |
| PAC production | PENDING |
| READY → ISSUED | PENDING |

Los PASS son de esta fase en SANDBOX con material sintético y evidencia independiente (§11); no
habilitan nada en PRODUCTION.
