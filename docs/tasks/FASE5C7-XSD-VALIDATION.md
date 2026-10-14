# ORBIT NEXUS · Fase 5C.7 — Validación XSD oficial CFDI 4.0

Rama `claude/fase5c7-xsd-validation` (base `8419ec6`, con 5C.6 integrada). Sin PAC, sin timbrado,
sin UUID/TFD, sin `READY → ISSUED`, sin migraciones, sin Neon, sin despliegue. Ninguna ruta llama
todavía a la validación: la usará el bloque de timbrado (autorización → sello → **XSD** → PAC).

## 1. Resultado

| Pieza | Estado |
|---|---|
| Esquemas oficiales | `cfdv40.xsd` + `catCFDI.xsd` + `tdCFDI.xsd`, byte a byte, con manifiesto (URL, namespace, grafo de importación, bytes, SHA-256, Last-Modified, ETag) |
| Bundle de runtime | `src/lib/sat/cfdi40/cfdv40-xsd.json` (texto exacto, verificado por hash al cargar); nada se lee del disco ni se descarga |
| Motor | **`libxml2-wasm` 0.7.2** (libxml2 2.15.1 en WebAssembly), versión exacta, auditado y fijado (§5) |
| Gate de dominio | `validateSealedCfdi40Xsd(sealed)` / `validateOfficialSealedCfdi40Xsd(sealed)` → `XsdValidatedCfdi40` |
| PAC | `pacSubmission` y `Cfdi40PacAdapter` aceptan solo `XsdValidatedCfdi40` (antes: `SealedCfdi40Xml`) |
| Evidencia independiente | .NET `XmlSchemaSet` coincide en VALID/INVALID en 39 casos (§11) |
| Build real | Next.js 16.3.6: compila, empaqueta el motor y el XSD; con `resources/` oculto y red bloqueada, 10/10 validados (§12) |
| Gate de producción | `XSD_OFFICIAL_VALIDATION_READY = true` (§15); **no** desbloquea firma, PAC ni `ISSUED` |

## 2. Fuentes SAT

Listadas en el Anexo 20 (http://omawww.sat.gob.mx/tramitesyservicios/Paginas/anexo_20.htm),
obtenidas el 2026-10-12 y **re-verificadas el 2026-10-13** con una descarga HTTPS completa
(`scripts/sat/fetch-cfdi40-resources.mjs --only XSD`): mismos bytes.

| Esquema | URL oficial | targetNamespace | Importado por | Bytes | SHA-256 | Last-Modified | ETag |
|---|---|---|---|---|---|---|---|
| `cfdv40.xsd` | http://www.sat.gob.mx/sitio_internet/cfd/4/cfdv40.xsd | `http://www.sat.gob.mx/cfd/4` | — (raíz) | 50 607 | `2489b5b535f5cbc6a6c2db6132620de1833f85372512d01deea62880e700e276` | Tue, 04 Jun 2024 17:12:17 GMT | `97b3e3b126a19ddaaed47a57732ec005` |
| `catCFDI.xsd` | http://www.sat.gob.mx/sitio_internet/cfd/catalogos/catCFDI.xsd | `http://www.sat.gob.mx/sitio_internet/cfd/catalogos` | `cfdv40.xsd` | 5 984 046 | `6c58936cb77576f839a4d7915953ceaf252b9eb9319f9458fe5bb67ae2bb0bb1` | Fri, 13 Dec 2024 19:59:34 GMT | `e29ac5164fd253d5734a4d931127ecd2` |
| `tdCFDI.xsd` | http://www.sat.gob.mx/sitio_internet/cfd/tipoDatos/tdCFDI/tdCFDI.xsd | `http://www.sat.gob.mx/sitio_internet/cfd/tipoDatos/tdCFDI` | `cfdv40.xsd` | 7 315 | `b3b81fe4017b95d5477f23a32f47e8b0571683cfddfff1330508c75e02b504cd` | Tue, 04 Jun 2024 17:13:32 GMT | `22ea0096f939b5b3b35c608c18da36b2` |

**Grafo de dependencias (verificado, no supuesto):** `cfdv40.xsd` tiene exactamente dos
`xs:import` (catCFDI y tdCFDI); ninguno de los tres tiene `xs:include`, `xs:redefine` ni
`xs:override`, y catCFDI y tdCFDI no importan nada. Complementos (Pagos, Nómina, Carta Porte,
Comercio Exterior, TFD…) no forman parte del CFDI base y no se versionan (§10).

## 3. Manifiesto y bundle

- `src/lib/sat/cfdi40/manifest.json`: cada XSD con `url`, `namespace`, `imports`,
  `referencedBy`, `bytes`, `sha256`, `lastModified`, `etag`, `obtainedAt`, `stored`.
- `scripts/sat/cfdi40-xsd-bundle.mjs` (usado por `build-cfdi40-resources.mjs` y ejecutable solo):
  deriva namespace e importaciones del archivo versionado, exige un grafo cerrado (toda referencia
  versionada, nada versionado sin referencia), y escribe `cfdv40-xsd.json` (texto UTF-8 exacto).
- En runtime, `verifyCfdi40XsdBundle` (`src/lib/cfdi40/xsd-resources.ts`) exige contra el
  manifiesto: misma raíz; exactamente los XSD del manifiesto (falta → `CFDI_XSD_SCHEMA_UNAVAILABLE`,
  sobra → `CFDI_XSD_SCHEMA_INTEGRITY_FAILED`); SHA-256 del texto igual; `targetNamespace` igual
  al declarado; `xs:import`/`include`/`redefine`/`override` del texto idénticos a los declarados
  (dependencia no declarada → `CFDI_XSD_SCHEMA_INTEGRITY_FAILED`). La versión del conjunto
  (`bundleSha256`) es el SHA-256 de las líneas "url sha256" ordenadas:
  `d99667dd2664e51e34d0880d1acf370838a857fc6c810c83b09beaf95d9ee2af`.

## 4. Mantenimiento y actualización SAT

`scripts/sat/fetch-cfdi40-resources.mjs --out <directorio nuevo vacío> [--only XSD|XSLT|all]`
(herramienta del mantenedor; la aplicación nunca la ejecuta):

- descarga **solo** las URL del manifiesto, por HTTPS (mismo host y ruta), sin seguir redirecciones,
  exige 200, tamaño coherente y un límite; escribe en un directorio fuera del repositorio que debe
  estar vacío (`flag: "wx"`, nunca sobrescribe) y guarda `Last-Modified`/`ETag`;
- imprime el diff de hashes contra el manifiesto y **detiene** con código 2 si un XSD o XSLT
  descargado referencia algo que no está en el allowlist;
- nunca escribe en `resources/` ni en `src/`.

**Gate de actualización SAT:** un hash nuevo nunca se aplica solo. Orden: descargar → diff de
hashes → revisar imports y compatibilidad → pruebas → `build-cfdi40-resources.mjs --dir <dir>
--replace` → commit → deploy. Además, `tests/cfdi40-xsd-guard.test.ts` fija la huella del conjunto
y del bundle: un XSD nuevo sin revisión hace fallar las pruebas.

## 5. Motor XSD: auditoría y elección

| Candidato | Resultado |
|---|---|
| **`libxml2-wasm` 0.7.2** | **Elegido** (detalle abajo) |
| `xmllint-wasm` 5.3.0 (MIT, libxml2 2.13.8) | Descartado: ejecuta la CLI de xmllint en un `worker_threads`, vuelve a leer y compilar los 6 MB de catCFDI en cada llamada (sin validador reutilizable), carga `xmllint.wasm` desde disco y devuelve errores como texto; trae `@types/node` como dependencia |
| `libxmljs` 1.0.11 / `libxmljs2` 0.37.0 | Descartados: binarios nativos (node-gyp/prebuild), scripts de instalación |
| `xsd-schema-validator` 0.11.0 | Descartado: requiere Java |
| `@cfdi/xsd` 4.0.19 | Descartado: convierte a JSON Schema y valida con `ajv` (`new Function`); no es validación XSD |
| `xmllint` 0.1.1 | Descartado: sin mantenimiento (2022) |
| xmllint/.NET/Java del sistema | Solo como validadores independientes en pruebas, nunca en runtime |

`libxml2-wasm` 0.7.2:

| Criterio | Hallazgo |
|---|---|
| Licencia | MIT (+ licencia MIT de libxml2 incluida) |
| Mantenimiento | 17 versiones desde 2023-10; 0.7.0 (2026-03), 0.7.1 (2026-03), 0.7.2 (2026-09-07); un mantenedor (`jameslan`) |
| libxml2 | 2.15.1 (notas de la 0.7.0: "Bump libxml2 to 2.15.1"); incluye las correcciones de 2025 de `xmlschemas` publicadas en 2.13.x/2.14.x |
| Dependencias | Ninguna; peers ninguna |
| Scripts de instalación | Ninguno (`hasInstallScript` falso) |
| CVE | `npm audit`: 0. `npm audit` no ve la libxml2 embebida: su seguimiento es manual (re-auditoría obligatoria al cambiar de versión) |
| Node | `engines.node >= 18`; probado en Node 24.14.1 |
| Binarios nativos | Ninguno: el WebAssembly va **embebido como cadena** dentro de `lib/libxml2raw.mjs` (no hay `.wasm` aparte) |
| Red | Ninguna: sin `fetch`/`http`; el WebAssembly no tiene sockets |
| Sistema de archivos | El WebAssembly usa un FS en memoria vacío; un import a un archivo real del host falla (probado). `node:fs` solo en el glue para stdin (no usado) y en `lib/nodejs.mjs` (proveedores de archivos opcionales, **no** se importan) |
| `child_process`, workers | Ninguno |
| `eval` / `new Function` | Ninguno (`eval` es el nombre de un método XPath del paquete) |
| Tamaño | 1,23 MB desempaquetado; en Next.js, un chunk de 1,8 MB |
| Módulo | ES module con top-level await: se carga con `import()` (CommonJS no puede hacer `require`); Turbopack lo empaqueta como módulo asíncrono sin configuración |
| Vercel/Linux | JS + WebAssembly puro: mismo artefacto en Windows y Linux; build real de Next.js verificado en Windows (§12) |

POC aislado (fuera del repositorio, `--ignore-scripts`) antes de instalar: compila `cfdv40.xsd`
pidiendo exactamente sus dos imports; valida los CFDI de ORBIT y del PAC; rechaza DTD/XXE/billion
laughs; no lee archivos del host. Instalado con `npm install --save-exact --ignore-scripts
libxml2-wasm@0.7.2`: el lockfile solo agrega `node_modules/libxml2-wasm` y la raíz.

**Dependency guard** (`tests/cfdi40-xsd-guard.test.ts`): versión exacta, `integrity`, `resolved`,
sin scripts ni dependencias, SHA-256 de `package.json`, `lib/libxml2raw.mjs` (libxml2 embebida) y
`LICENSE.libxml2`, huella de `lib/*.mjs`, ausencia de binarios, id del motor, huella del conjunto
XSD y del bundle. Cualquier cambio exige repetir la auditoría.

## 6. Resolver cerrado

- `resolveSatXsdImport(bundle, url)`: solo una URL absoluta `http://www.sat.gob.mx/…` presente en
  el bundle, tal como está escrita. Rechaza https, otros hosts y puertos, mayúsculas, `..`, query,
  fragmento, `file:`, `data:`, UNC, rutas de Windows o relativas, localhost, 127.0.0.1, `[::1]`,
  169.254.169.254 (prueba con cada una).
- El adaptador registra un único proveedor de entrada en libxml2 que sirve bytes del bundle **solo
  durante la compilación** (síncrona). Fuera de ella, cualquier petición se registra y hace fallar
  la validación.
- `compileCfdi40Xsd` exige que el motor pida **exactamente** las importaciones declaradas (ni más
  ni menos): si no, `CFDI_XSD_SCHEMA_INTEGRITY_FAILED`.
- `schemaLocation` del XML es metadato: nunca se usa para cargar nada; se comprueba como texto que
  sea el estándar del CFDI 4.0.

## 7. Seguridad XML

- Antes del motor: se rechaza cualquier `<!` o `<?` fuera de la declaración XML: DOCTYPE, DTD,
  `ENTITY` (general o de parámetro), CDATA, comentarios e instrucciones de procesamiento
  (`CFDI_XSD_FORBIDDEN_MARKUP`). ORBIT no escribe ninguno.
- Solo los namespaces del CFDI 4.0 base (`cfdi`, `xsi`): XInclude, complementos o addenda con
  namespace propio → `CFDI_XSD_UNSUPPORTED_NAMESPACE`.
- libxml2 con `XML_PARSE_NONET`, sin `NOENT`, `DTDLOAD` ni `XINCLUDE`; además libxml2 2.15 limita
  la amplificación de entidades (POC: "billion laughs" rechazado).
- El XML es dato: se validan sus bytes exactos; ningún resultado del motor se ejecuta.

## 8. Flujo de dominio y tipo `XsdValidatedCfdi40`

```
SealedCfdi40Xml (registrado, Sello verificado; 5C.6)
   ▼ validateSealedCfdi40Xsd(sealed, { engine, bundle })
   │   isSealedCfdi40 → compilar (una vez por motor y versión del conjunto)
   │   copia privada de los bytes; SHA-256 = el del sellado
   │   preflight (marcado prohibido, namespaces, schemaLocation) → motor sobre esos bytes
   ▼
XsdValidatedCfdi40 (registrado)  ──►  pacSubmission  ──►  futuro adaptador PAC
```

- `XsdValidatedCfdi40` (marca de tipo + `WeakSet` en `schema.ts`) lleva el XML, sus bytes, su
  SHA-256 (= el del CFDI sellado), certificado, hashes de pre-sello y cadena, y
  `xsd: { bundleSha256, engine }`: "este XML exacto se validó contra esta versión exacta del XSD".
- Un byte cambiado después invalida el valor (`isXsdValidatedCfdi40` falso; el PAC lo rechaza con
  `XSD_VALIDATED_CFDI_REQUIRED`). Ningún literal ni copia puede serlo.
- TypeScript impide entregar `UnsignedCfdi40Xml`, `PreSealCfdi40Xml`, `Cfdi40OriginalString` o
  `SealedCfdi40Xml` a `Cfdi40PacSubmission`.
- `cfdi40XsdProblems(xml)` (herramientas y pruebas) aplica las mismas comprobaciones a cualquier
  XML y devuelve problemas; nunca produce un `XsdValidatedCfdi40`.
- Servicio con auditoría: `validateSealedCfdi40XsdForInvoice` (`src/services/cfdi40-xsd.ts`).

## 9. Errores y diagnósticos

| Código | Cuándo |
|---|---|
| `SEALED_CFDI_REQUIRED` | La entrada no es un `SealedCfdi40Xml` registrado y sin cambios |
| `CFDI_XSD_INVALID` | Violación del esquema (atributo faltante/no permitido, orden, tipo, faceta, valor fijo) o `schemaLocation` no estándar |
| `CFDI_XSD_UNSUPPORTED_NAMESPACE` | Namespace, complemento o addenda fuera del alcance |
| `CFDI_XSD_MALFORMED_XML` | XML mal formado |
| `CFDI_XSD_FORBIDDEN_MARKUP` | DOCTYPE/DTD/entidades/CDATA/comentarios/PI |
| `CFDI_XSD_SCHEMA_UNAVAILABLE` | Esquema faltante o motor no disponible/incompatible |
| `CFDI_XSD_SCHEMA_INTEGRITY_FAILED` | Bundle alterado, hash, namespace, import no declarado o petición no permitida |
| `CFDI_XSD_VALIDATION_FAILED` | Excepción interna del motor |
| `XSD_VALIDATED_CFDI_REQUIRED` | Algo que no es `XsdValidatedCfdi40` hacia el PAC |

Cada problema es un `Cfdi40Issue` acotado (máximo 20): `code`, `path` seguro (ruta de elementos con
prefijo e índice y `/@atributo`, p. ej. `/cfdi:Comprobante/cfdi:Emisor/@Rfc`), `rule`
(`XSD:ATTRIBUTE_MISSING`, `XSD:FACET_enumeration:catCFDI:c_Moneda`, `XSD:ELEMENT_UNEXPECTED`…),
`line`, `column` y el mensaje curado del catálogo. **Nunca** el texto de libxml2, valores fiscales,
XML, Sello, certificado, cadena, rutas del servidor ni URL arbitrarias (prueba de fugas).

## 10. Qué valida el XSD y qué no

Valida estructura, orden, tipos, atributos requeridos, patrones y facetas (longitud, dígitos,
enumeraciones de catálogos), namespaces y cardinalidades del CFDI 4.0 base.

**No** equivale a: la matriz de errores completa ni las reglas de negocio del SAT; la vigencia
contextual de catálogos (fechas de inicio/fin, combinaciones); la autorización del usuario; la
validez del Sello; que el CSD esté autorizado; la aceptación del PAC; el timbrado. Las validaciones
de dominio previas (5C.4) siguen vigentes y no se reemplazan.

**Complementos y addenda:** fuera del alcance de ORBIT v1. Con namespace propio se rechazan antes
del motor; sin esquema, el comodín estricto de `cfdi:Complemento`/`cfdi:Addenda` los rechaza
(`CFDI_XSD_UNSUPPORTED_NAMESPACE`). Para agregarlos en el futuro: versionar su XSD oficial en el
manifiesto (namespace, padre), ampliar el allowlist y los namespaces soportados, y pruebas.

## 11. Pruebas y evidencia

- `tests/cfdi40-xsd.test.ts` (12): conjunto oficial y grafo; bundle alterado/faltante/extra/
  namespace/import no declarado; resolver cerrado; compilación única por conjunto y fallo cerrado
  si el motor pide de más o de menos; **10 CFDI de ORBIT sellados por el flujo real** (PUE, PPD,
  IVA 16 %, exento, descuento, retenciones, varios conceptos y grupos de impuestos, persona física,
  receptor genérico, Unicode/escapes, USD) → `XsdValidatedCfdi40` con los bytes exactos; **25
  mutaciones** (atributo ausente/extra, orden, Version, decimal, patrón, enumeración, longitud,
  duplicado, elemento desconocido, namespace, schemaLocation ×2, mal formado, DTD, entidad
  externa, entidad de parámetro, billion laughs, XInclude, comentario, CDATA, PI, complemento,
  complemento sin esquema, addenda) con código, regla y ruta estables y sin fugas; independencia de
  gates (A/B/C, §13); import a archivo real del host nunca leído; sin red, archivos ni consola;
  revisión estática; auditoría; gate de producción.
- `tests/cfdi40-xsd-guard.test.ts` (2): dependencia y conjunto XSD fijados.
- `tests/cfdi40-xsd-interop.test.ts` (1): **libxml2-wasm y .NET `XmlSchemaSet` coinciden** en
  VALID/INVALID en 39 archivos: 10 CFDI de ORBIT sellados, 15 CFDI del PAC y 14 mutaciones
  (14 válidos, 25 inválidos). Se omite con motivo si no hay Windows PowerShell/.NET.
- `tests/cfdi40-xsd-runtime.test.ts` (1): el camino pre-sello → cadena → firma → sellado → XSD,
  empaquetado con esbuild en un directorio vacío (sin `resources/` ni `node_modules`), con red y
  lecturas de recursos bloqueadas: 10/10 validados, un inválido detectado, sin salida en consola.
- Pruebas anteriores ajustadas a la nueva frontera: el PAC exige `XSD_VALIDATED_CFDI_REQUIRED`
  (`cfdi40-hardening`, `cfdi40-cadena`, `cfdi40-seal`, `csd-scope`) y el gate XSD rechaza lo no
  sellado (`cfdi40`).

Ninguna de estas pruebas es "verificado por el SAT": son el esquema oficial más dos validadores
independientes de acuerdo.

## 12. Sin red, Vercel y build real

- Durante compilación y validación, con `fetch`, `http.request`, `https.request`, `net.connect`,
  `dns.lookup` y lecturas de archivo bloqueados y la consola espiada: **0 llamadas**.
- Build real (Next.js 16.3.6, Turbopack) con una ruta temporal que ejecuta el flujo completo
  (eliminada después): compila sin cambios de configuración; `libxml2-wasm` queda en un chunk del
  servidor (1,8 MB) y el XSD en chunks; la traza de la ruta no incluye `resources/` ni Prisma.
  `next start` con `resources/` renombrado, red bloqueada en el proceso: **10/10 CFDI sellados y
  validados**, dos veces; el inválido se detecta; sin peticiones de red; sin salida en consola.
- Linux/Vercel: el artefacto es JavaScript + WebAssembly embebido, idéntico en cualquier sistema;
  la verificación se hizo en Windows.

## 13. Gates independientes

| Caso | Resultado |
|---|---|
| A. Sello válido + XML inválido (CFDI sellado y registrado con `Moneda="ZZZ"`) | `CFDI_XSD_INVALID` (`XSD:FACET_enumeration`); no llega al PAC |
| B. XML válido + Sello alterado | XSD válido, pero `SELLO_NOT_VERIFIED`: nunca es `SealedCfdi40Xml`, el gate XSD lo rechaza |
| C. Sello válido + XSD válido | `XsdValidatedCfdi40`: candidato al siguiente gate; **no** timbrado |

## 14. Rendimiento y memoria

Local (Windows, Node 24.14.1):

| Medida | Valor |
|---|---|
| Cargar el bundle XSD (7,2 MB JSON) | 0,6 s (una vez por proceso) |
| Instanciar el WebAssembly | 1,0 s (una vez) |
| Compilar el esquema (incluye catCFDI) | 1,2 s (una vez por proceso y versión del conjunto) |
| Validar (caliente) | 22 ms (1 concepto) a 61 ms (5 conceptos); mediana 42 ms |
| 100 y 500 rondas válida + inválida | 61–67 ms por ronda; **1** compilación; `external`/`arrayBuffers` +8 KB (estable) |
| Memoria del proceso | ~220 MB RSS; ~76 MB de memoria del WebAssembly (esquema compilado) |

El costo crece con los conceptos por las enumeraciones de catálogos grandes (c_ClaveProdServ). Sin
fugas ni recompilación por factura. Arranque en frío de una función: ~2,8 s la primera validación.

## 15. Producción

| Capacidad | SANDBOX | PRODUCTION |
|---|---|---|
| Cadena original | YES | YES |
| Sello criptográfico | YES | **BLOCKED** (gates de 5C.6) |
| XSD local oficial | YES | YES* |
| CSD type verified | NO | REQUIRED |
| Official CSD fixture | NO | REQUIRED |
| Postgres concurrency | NO | REQUIRED |
| KMS/HSM | N/A | REQUIRED |
| PAC sandbox | NO | NO |
| PAC production | NO | NO |
| ISSUED | NO | NO |

\* Apto para producción solo con: bundle oficial íntegro (verificado en runtime), motor aprobado
(fijado y auditado), sin red, pruebas y manifiesto exacto.

**`XSD_OFFICIAL_VALIDATION_READY = true`** (`src/lib/cfdi40/production-gates.ts`): recursos SAT
versionados ✓, hashes verificados ✓, motor auditado y fijado ✓, resolver cerrado ✓, pruebas de
seguridad ✓, fixtures positivos y negativos ✓, evidencia independiente ✓, build real ✓. La
aprobación de la dependencia queda sujeta a la revisión humana antes del commit. Este gate **no**
cambia ningún otro: firma productiva, PAC e `ISSUED` siguen bloqueados.

## 16. Riesgos

1. `libxml2-wasm` tiene un solo mantenedor; versión exacta, archivos fijados y re-auditoría
   obligatoria al actualizar.
2. CVE de la libxml2 embebida: `npm audit` no los ve; seguimiento manual de libxml2 2.15.x.
3. Validar cuesta 20–60 ms y el arranque en frío ~2,8 s por instancia: aceptable para timbrado por
   factura; vigilar si se valida en lote.
4. Un cambio del SAT en un XSD requiere el gate de actualización (§4); un hash nuevo sin revisión
   rompe las pruebas.
5. El XSD no sustituye la matriz de errores ni las reglas de negocio (§10).
6. Linux verificado por construcción (JS + WebAssembly), no ejecutado en Linux en esta fase.
7. Complementos no soportados: cualquier CFDI con complemento o addenda se rechaza.

## 17. Siguiente paso hacia PAC sandbox

1. Autorización explícita por factura (`StampRequest`: usuario, Organization, factura,
   `draftVersion`, un solo uso), sin pedir la contraseña del CSD.
2. `StampAttempt` e idempotencia (FASE5C §18), entitlement SANDBOX.
3. Orquestación: autorización → `sealCfdi40WithActiveCsd` → `validateSealedCfdi40XsdForInvoice` →
   `pacSubmission` → adaptador SW sandbox (documentación oficial vigente, sin inventar endpoints).
4. Validación del TFD devuelto (UUID, `SelloSAT`, `NoCertificadoSAT`, `FechaTimbrado`,
   `RfcProvCertif`) y su XSD oficial (`TimbreFiscalDigitalv11.xsd`, a versionar con este mismo
   mecanismo); reconciliación de `UNKNOWN`. Producción sigue bloqueada por los gates de 5C.6.
