# ORBIT NEXUS · Fase 5C.4 — CFDI 4.0 XML (sin sello)

Base: `origin/main` en `f393fc8`. Extiende `FASE5C-CONTRACT.md` (§11, §14, §15, §16) y
`FASE5C3-CONTRACT.md` (§AA). Este bloque **no** sella, **no** genera cadena original, **no**
llama al PAC, **no** timbra y **no** cambia `READY → ISSUED`.

```
factura ORBIT (READY, snapshots) → mapper → normalizer → validator → serializer → XML sin sellar
                                                                                ↓
                       (gates siguientes) cadena original → sello → XSD → PAC → ISSUED
```

---

## 1. Alcance

Soportado en v1 (cualquier otra combinación falla con un error explícito, nunca con XML
aproximado):

| Tema | v1 |
|---|---|
| Versión / tipo | CFDI 4.0, `TipoDeComprobante = I` |
| Método / forma de pago | `PUE` con `FormaPago` de `c_FormaPago` distinta de `99`; `PPD` con `FormaPago = 99` (CFDI40105) |
| Moneda | Claves de `c_Moneda` con 2 decimales (MXN, USD, EUR…). MXN sin `TipoCambio`; otras con `TipoCambio` > 0 de hasta 6 decimales |
| Exportación | `01` (No aplica) |
| Emisor | RFC, Nombre y RegimenFiscal del snapshot del Perfil Fiscal |
| Receptor | Nacional con RFC (moral o física) o RFC genérico `XAXX010101000` **no** global (régimen 616, `S01`, domicilio = LugarExpedicion) |
| Conceptos | `ObjetoImp` 01, 02, 03, 04; descuento por concepto |
| Impuestos | Traslado IVA `Tasa` 0.160000 o 0.000000; IVA `Exento`; retención IVA (0–0.16, ≤ IVA trasladado) e ISR (0–0.35) |
| Fecha | Generada en servidor, hora local del lugar de expedición |

No soportado (error `UNSUPPORTED`): E, T, N, P; Exportación 02/03/04; receptor extranjero
`XEXX010101000` (ResidenciaFiscal, NumRegIdTrib); factura global (`InformacionGlobal`,
CFDI40130); `CfdiRelacionados`; IVA 8 % (región fronteriza); IEPS; `ObjetoImp` 05–08; claves
de producto que exigen complemento (CFDI40163, CFDI40228) o IEPS; monedas con decimales
distintos de 2 y `XXX`; `Confirmacion`; `ACuentaTerceros`, `InformacionAduanera`,
`CuentaPredial`, `ComplementoConcepto`, `Parte`; complementos y addendas.

---

## 2. Recursos oficiales del SAT

Página oficial: `http://omawww.sat.gob.mx/tramitesyservicios/Paginas/anexo_20.htm`
(«Formato de factura (Anexo 20)»). Descargados el 2026-10-12 directamente de `sat.gob.mx` /
`omawww.sat.gob.mx`, nunca de mirrors, npm ni GitHub. Nunca se descargan en runtime.

| Recurso | Tipo | Versión | Last-Modified (HTTP) | Bytes | SHA-256 | Guardado |
|---|---|---|---|---|---|---|
| `cfdv40.xsd` | XSD | 4.0 | 2024-06-04 | 50 607 | `2489b5b535f5cbc6a6c2db6132620de1833f85372512d01deea62880e700e276` | `resources/sat/cfdi40/` |
| `tdCFDI.xsd` | XSD | — | 2024-06-04 | 7 315 | `b3b81fe4017b95d5477f23a32f47e8b0571683cfddfff1330508c75e02b504cd` | `resources/sat/cfdi40/` |
| `catCFDI.xsd` | XSD | — | 2024-12-13 | 5 984 046 | `6c58936cb77576f839a4d7915953ceaf252b9eb9319f9458fe5bb67ae2bb0bb1` | ya versionado (Fase 5C); hash idéntico |
| `cadenaoriginal_4_0.xslt` | XSLT 2.0 | 4.0 | 2026-04-17 | 21 324 | `b0559b380e73b850ca8a3da53b077a6051a09d87068d8d98e82dfd4acfba7565` | versionado, **no ejecutado**; sus 32 `xsl:include` remotos no están versionados |
| `MatrizDeErrores_CFDI_v40_20260325.xls` | Matriz de errores | v40_20260325 | 2026-03-24 | 454 656 | `bdc350035c7ed720af5be15509e01d0bda7c12cec4ad9797b0c34f889c1140a7` | `resources/sat/cfdi40/` |
| `Anexo_20_Guia_de_llenado_CFDI.pdf` | Referencia | publicada 16/01/2026 | 2026-01-17 | 1 503 078 | `70e0c92df44b4f36975e4a0a5b1f0609f83c62deb029eda440fe4df6e2265a25` | solo hash |
| `Anexo20_2022.pdf` | Referencia (estándar técnico) | DOF 13/01/2022 | 2022-09-25 | 6 665 523 | `b3b6d63a97c859a31d7aacf0fe17b2d58207280df6f06caff3ceaf79954cf4bd` | solo hash |
| `catCFDI_V_4_20261001.xls` | Catálogos | release 2026-10-01 | 2026-10-01 | 48 773 632 | `974e9c401636ee48adfaaa0acd4a97d382c204146c201c631f9069fec0bad85b` | solo hash; descargado de nuevo y verificado idéntico |

- Manifiesto legible por máquina: `src/lib/sat/cfdi40/manifest.json` (URL, página de origen,
  fecha, `Last-Modified`, `ETag`, bytes, SHA-256, versión, propósito, `imports` de cada XSD,
  `includes` y versión de la XSLT). Generado por `scripts/sat/build-cfdi40-resources.mjs`,
  que copia byte a byte y se niega a sobrescribir un recurso distinto sin `--replace`.
- Los archivos oficiales usan CRLF; `.gitattributes` (`resources/sat/** binary`) evita
  cualquier conversión. Nunca se modifican.
- `src/lib/cfdi40/resources.ts` lee un recurso solo si su SHA-256 coincide con el manifiesto
  (`SAT_RESOURCE_MISSING` / `SAT_RESOURCE_CORRUPT`, sin fallback).

---

## 3. Catálogos

Estrategia: catálogos oficiales versionados en `src/lib/sat/catcfdi/` (convención existente),
generados por `scripts/sat/build-catcfdi.mjs` desde el xls oficial exportado por
`scripts/sat/export-catcfdi.ps1` (Excel COM, solo lectura, macros deshabilitadas). Cada
catálogo se marca completo solo si **todas** sus claves del xls existen como enumeración en
`catCFDI.xsd`. Actualización controlada: nueva descarga oficial → hash → regeneración →
revisión del diff → pruebas. Los tres catálogos previos se regeneraron **byte a byte
idénticos**.

| Catálogo | Entradas | Versión.revisión | Publicación | Solo en XSD |
|---|---|---|---|---|
| c_RegimenFiscal (previo) | 19 | 1.0 | — | 4 |
| c_UsoCFDI (previo) | 24 | 2.0 | 2023-04-22 | 1 |
| c_CodigoPostal (previo) | 95 748 | 1.8 | 2026-01-22 | 1 |
| c_FormaPago | 22 | 1.0 | — | 0 |
| c_MetodoPago | 2 | 1.0 | — | 0 |
| c_Moneda (con decimales y % variación) | 183 | 1.1 | — | 0 |
| c_TipoDeComprobante | 5 | 1.0 | — | 0 |
| c_Exportacion | 4 | 2.1 | 2022-02-24 | 0 |
| c_ObjetoImp | 8 | 4.0 | 2024-12-13 | 0 |
| c_Impuesto | 3 | 1.0 | — | 0 |
| c_TipoFactor | 3 | 1.0 | — | 0 |
| c_TasaOCuota | 19 filas | 4.0 | 2025-12-31 | sin enumeración XSD |
| c_ClaveUnidad | 2 410 | 1.0 | — | 8 |
| c_ClaveProdServ (código, IVA/IEPS obligatorio, complemento, vigencia, estímulo) | 52 513 | 2.2 | 2025-12-31 | 234 |

- Las claves que aparecen solo en el XSD no tienen vigencia publicada: el validador las
  reporta como `CATALOG_CODE_UNVERIFIABLE`, distinto de `CATALOG_CODE_UNKNOWN`.
- Vigencia evaluada en la fecha local de emisión.
- Invoice Studio sigue usando sus catálogos actuales (`sat-catalogs.ts` curado y
  `sat-catalogs-large.ts`, subconjuntos): no se modificaron en este bloque (ver §11, D6).

---

## 4. Auditoría: matriz ORBIT → CFDI

Fuentes reales: `prisma/schema.prisma` (`StampedInvoice`, `StampedInvoiceConcept`,
`FiscalProfile`, `Client`, `InvoiceSettings`), `src/services/outgoing-invoices.ts`
(snapshots y totales), `src/lib/invoice-totals.ts`, `src/lib/invoice-rules.ts`,
`src/lib/phase3-validation.ts`.

### Comprobante

| Campo CFDI | Fuente ORBIT | Req. | Validación | ¿Falta? |
|---|---|---|---|---|
| Version | constante `4.0` | R | XSD fixed | No |
| Serie | — (el folio ya lleva el prefijo) | O | `[^\|]{1,25}` | No se usa (D3) |
| Folio | `StampedInvoice.folio` (`ORB-000123`) | O | `[^\|]{1,40}` | No |
| Fecha | instante del servidor + zona de `c_CodigoPostal` del LugarExpedicion | R | t_FechaH, CFDI40101 | No se persiste aún; `invoiceDate` (solo fecha) se compara |
| Sello | bloque de sello | R (XSD) | CFDI40102 | Fuera de alcance |
| FormaPago | `paymentForm` | C | c_FormaPago CFDI40104; PPD→99 CFDI40105 | No |
| NoCertificado | `CsdCertificate.certificateNumber` (5C.3) | R (XSD) | `[0-9]{20}` | Fuera de alcance |
| Certificado | `CsdCertificate.certificateDer` (Base64) | R (XSD) | CFDI40106 | Fuera de alcance |
| CondicionesDePago | — | O | — | No modelado |
| SubTotal | Σ Importe calculado; se concilia con `subtotal` | R | CFDI40107/108 | No |
| Descuento | Σ descuentos; se concilia con `discount` | C | CFDI40110–112 | No |
| Moneda | `currency` | R | c_Moneda CFDI40113 | No |
| TipoCambio | `exchangeRate` | C | CFDI40114–117 | Rango FIX (CFDI40118) no verificable (D4) |
| Total | calculado; se concilia con `total` | R | CFDI40119 | No |
| TipoDeComprobante | `documentType` | R | c_TipoDeComprobante | No |
| Exportacion | `exportCode` | R | c_Exportacion CFDI40123 | No |
| MetodoPago | `paymentMethod` | C | c_MetodoPago CFDI40124 | No |
| LugarExpedicion | `issuerSnapshot.postalCode` (domicilio fiscal) | R | c_CodigoPostal CFDI40126 | Sucursales no modeladas (D5) |
| Confirmacion | — | C | CFDI40118/120/127 | No soportado |
| InformacionGlobal | — | C | CFDI40130 | No modelado (no soportado) |
| CfdiRelacionados | — | C | CFDI40137 | No modelado (no soportado) |

### Emisor y Receptor (snapshots guardados con el borrador, contrato §11)

| Campo CFDI | Fuente ORBIT | Req. | Validación | ¿Falta? |
|---|---|---|---|---|
| Emisor@Rfc | `issuerSnapshot.rfc` | R | t_RFC | No |
| Emisor@Nombre | `issuerSnapshot.legalName` | R | `[^\|]{1,300}`; coincidencia con el RFC (CFDI40139) solo verificable por el PAC | No |
| Emisor@RegimenFiscal | `issuerSnapshot.fiscalRegime` | R | CFDI40140/141 | No (un solo régimen) |
| Emisor@FacAtrAdquirente | — | C | CFDI40142 | No aplica |
| Receptor@Rfc | `receiverSnapshot.rfc` | R | t_RFC; reglas de genérico | No |
| Receptor@Nombre | `receiverSnapshot.legalName` | R | `[^\|]{1,300}`; CFDI40144/145 por el PAC | No |
| Receptor@DomicilioFiscalReceptor | `receiverSnapshot.postalCode` | R | `[0-9]{5}`; c_CodigoPostal (ORBIT); genérico = LugarExpedicion CFDI40149 | No |
| Receptor@ResidenciaFiscal | `receiverSnapshot.country` | C | CFDI40150–153 | Extranjero no soportado |
| Receptor@NumRegIdTrib | `receiverSnapshot.foreignTaxId` | C | CFDI40154–156 | Extranjero no soportado |
| Receptor@RegimenFiscalReceptor | `receiverSnapshot.fiscalRegime` | R | CFDI40157–159 | No |
| Receptor@UsoCFDI | `StampedInvoice.cfdiUse` (no el default del cliente) | R | CFDI40160/161 | No |

Nunca se usan nombre visible de la Organization, correo ni nombre comercial.

### Conceptos e impuestos

| Campo CFDI | Fuente ORBIT | Req. | Validación | ¿Falta? |
|---|---|---|---|---|
| ClaveProdServ | `StampedInvoiceConcept.productCode` | R | c_ClaveProdServ CFDI40162–164, CFDI40228 | No (ver riesgo de defaults) |
| NoIdentificacion | — | O | — | No modelado |
| Cantidad | `quantity` Decimal(12,4) | R | > 0, ≤ 6 decimales | No |
| ClaveUnidad | `unitCode` | R | c_ClaveUnidad CFDI40165 | No |
| Unidad | — | O | — | No modelado; no se deriva del catálogo |
| Descripcion | `description` (≤ 1000) | R | `[^\|]{1,1000}` | No |
| ValorUnitario | `unitPrice` Decimal(12,2) | R | > 0 CFDI40166 | No (ORBIT limita a 2 decimales) |
| Importe | calculado; se concilia con `subtotal` del concepto | R | CFDI40167 | No |
| Descuento | `discount` Decimal(12,2) | O | CFDI40168/169 | No |
| ObjetoImp | `taxObject` | R | CFDI40170–172 | No |
| Traslado IVA | `vatFactor` (`TASA`/`EXENTO`) + `vatRate`; `taxRate` se concilia | C | CFDI40174–180 | No |
| Retención IVA / ISR | `withholdingVatRate`, `withholdingIsrRate` | C | CFDI40181–186 | No |
| IEPS, ACuentaTerceros, InformacionAduanera, CuentaPredial, Parte | — | C | — | No modelado (no soportado) |
| Comprobante/Impuestos | agrupación calculada; se concilia con `tax`, `withheldVat`, `withheldIsr` | C | CFDI40202–221 | No |

### Datos obligatorios que faltan

Para el alcance v1 **no falta ningún dato obligatorio del contenido fiscal** y no se requiere
migración. Quedan pendientes, por diseño, de otros bloques:

1. **Fecha de emisión persistida**: se deriva del instante del servidor al construir; el
   bloque de timbrado debe guardar en `StampedInvoice.issuedAt` exactamente el instante usado.
2. **NoCertificado, Certificado, Sello**: del CSD `VALID` (5C.3) en el bloque de sello.
3. **Zona horaria** de 830 códigos postales cuyo dato oficial es inconsistente (D2).

Riesgo de calidad (no faltante): `StampedInvoiceConcept` tiene defaults de base de datos
(`productCode = 01010101`, `unitCode = ACT`, `taxObject = 02`, `vatFactor = TASA`) para
filas heredadas de Fase 3. La política que impide que se conviertan en CFDI está en §15.

---

## 5. Arquitectura (`src/lib/cfdi40/`)

| Módulo | Responsabilidad |
|---|---|
| `types.ts` | `OrbitInvoiceForCfdi` (entrada sin Prisma), `Cfdi40DraftInput`, `Cfdi40Document` (`Cfdi40Issuer`, `Cfdi40Receiver`, `Cfdi40Concept`, `Cfdi40Transfer`, `Cfdi40Withholding`, `Cfdi40Taxes`), `Cfdi40RelatedDocument`, `UnsignedCfdi40Xml`, `Cfdi40CertificateBinding`, `SealedCfdi40Xml` |
| `orbit-invoice.ts` | Único punto que toca registros Prisma: Decimal → texto exacto |
| `mapper.ts` | Vocabulario ORBIT → CFDI, sin cálculos ni defaults (lo que falta queda `null`) |
| `normalize.ts` | Alcance v1, textos (NFC + `whiteSpace=collapse`), Fecha, importes y agrupación de impuestos; concilia con lo persistido por ORBIT |
| `validate.ts` | Revalidación independiente: catálogos y vigencia, combinaciones, límites del Anexo 20, sumas, facetas XSD |
| `xml.ts` | Escritor único: nombres verificados, escape central (`& < > "` y `\t\n\r` como referencias), sin espacios entre elementos |
| `serialize.ts` | Orden de elementos y atributos del XSD; ida y vuelta obligatoria (re-parseo y comparación) |
| `issue-date.ts` | Fecha local desde el instante del servidor y la zona oficial |
| `catalogs.ts` | Lecturas sobre los catálogos oficiales (carga diferida de los grandes) |
| `decimal.ts` | Aritmética exacta y fórmulas de límites |
| `resources.ts` | Lectura de recursos SAT verificada por hash y confinada a `resources/sat/cfdi40` |
| `sealed.ts` | Única puerta hacia XSD o PAC: registro privado del servicio de sello + comprobación estructural de `Sello`, `Certificado`, `NoCertificado` (§17) |
| `schema.ts` | Gate XSD (solo acepta `SealedCfdi40Xml`; rechaza lo no sellado por ORBIT). Fase 5C.7: validación XSD oficial real, ver `FASE5C7-XSD-VALIDATION.md` |
| `build.ts` | Orquestador puro `buildUnsignedCfdi40(invoice, { issuedAt, catalogs })` y gate de READY `checkCfdi40Content(invoice, { at, catalogs })` (§14) |
| `readiness.ts` | Traduce los issues CFDI al contrato de validación de Invoice Studio (`CFDI_<código>`) |
| `errors.ts` | Códigos estables y categorías |

El constructor no consulta la base de datos, la red, el reloj ni números aleatorios. El
servicio que lo invoque (bloque de timbrado) debe: cargar el borrador por `organizationId` de
sesión, exigir `READY` y la versión esperada, pasar `new Date()` del servidor y los
catálogos, y persistir el instante usado.

---

## 6. Dinero y decimales

- Aritmética: clon privado de decimal.js (el mismo de `Prisma.Decimal`, sin dependencia
  nueva) con 60 dígitos de precisión, redondeo `ROUND_HALF_UP` («redondeo» aritmético del
  Anexo 20) y sin notación exponencial. Nunca `number` para importes.
- Concepto: `Importe = round(Cantidad × ValorUnitario, decimales de la moneda)`;
  `Base = Importe − Descuento`; `Importe` de impuesto = `round(Base × TasaOCuota)`. Se escriben
  con los decimales de la moneda (2 en v1), como ORBIT ya los persiste.
- Comprobante: `SubTotal`, `Descuento`, bases e importes de `Impuestos` son el redondeo de las
  sumas (guía de llenado, preguntas 37 y 39); totales de impuestos = suma de los resúmenes;
  `Total = SubTotal − Descuento + Trasladados − Retenidos` (CFDI40119).
- Límites oficiales (Anexo 20, DOF 13/01/2022) implementados exactamente: inferior truncado,
  superior redondeado hacia arriba, con `10^-12`. El redondeo exacto del producto siempre
  queda dentro; ORBIT además exige el redondeo exacto (más estricto que la tolerancia SAT).
- Serialización: `Cantidad` en forma mínima (`1`, `0.3333`); `ValorUnitario` con al menos los
  decimales de la moneda; importes con exactamente esos decimales; `TasaOCuota` con 6
  decimales (guía, pregunta 40); `TipoCambio` en forma mínima.
- Conciliación: cada importe calculado debe coincidir con lo que ORBIT guardó
  (`calculateInvoiceTotals`); una diferencia es `ORBIT_TOTALS_MISMATCH`, nunca se corrige.

---

## 7. Fecha y lugar de expedición

- `Fecha` = instante del servidor convertido a la hora local del `LugarExpedicion`
  (código postal fiscal del emisor). Nunca la fecha u hora del navegador.
- Zona: la que publica `c_CodigoPostal` (6 zonas). Desfase fijo, o regla de horario de verano
  (mes + «N domingo» + hora) aplicada solo si el dato es consistente (verano = invierno + 1 h).
- Zona no resoluble (hoy: zona 3, «Tiempo del Centro en Frontera», verano −7 / invierno −6, 830
  códigos postales, p. ej. 32000) o código postal inexistente ⇒ el CFDI no se construye
  (`ISSUE_TIME_ZONE_UNRESOLVED` / `PLACE_OF_ISSUE_UNKNOWN`). Nunca hay código postal ni zona
  por defecto (§16).
- La fecha local debe coincidir con `invoiceDate` del borrador (`ISSUE_DATE_DIFFERS_FROM_DRAFT`,
  D1).
- Antigüedad y futuro: la `Fecha` es el instante actual, así que no puede ser futura; el
  límite de antigüedad para timbrar (72 h, RMF) lo aplica el PAC y debe revalidarse en el
  bloque de timbrado con la hora del servidor.

---

## 8. XML

- UTF-8, declaración `<?xml version="1.0" encoding="UTF-8"?>`, raíz `cfdi:Comprobante` con
  `xmlns:cfdi="http://www.sat.gob.mx/cfd/4"`, `xmlns:xsi` y
  `xsi:schemaLocation="http://www.sat.gob.mx/cfd/4 http://www.sat.gob.mx/sitio_internet/cfd/4/cfdv40.xsd"`.
- Elementos en el orden de `xs:sequence`; atributos en el orden de declaración del XSD;
  opcionales ausentes se omiten (nunca vacíos ni inventados); sin espacios ni saltos entre
  elementos; sin salto de línea final.
- Textos: Unicode NFC y regla `collapse` aplicada por ORBIT (el XML y la futura cadena llevan
  el mismo valor); `|` y caracteres no permitidos por XML se rechazan, nunca se sustituyen.
- Sin dependencia: Node estándar y el escritor propio de `xml.ts`. `fast-xml-parser` (ya
  instalado) solo se usa para la comprobación de ida y vuelta: su `XMLValidator` acepta
  documentos mal formados (p. ej. `<a b="x<y"/>`), por eso no se usa como validador.
- Determinismo: mismo borrador + mismo instante ⇒ mismos bytes (prueba); el único campo
  generado es `Fecha`.

---

## 9. Certificado y sello

`cfdv40.xsd` declara `Sello`, `NoCertificado` y `Certificado` como **requeridos**. Por eso:

| Representación | Contiene | Producida por |
|---|---|---|
| `UnsignedCfdi40Xml` (`stage: "UNSIGNED"`) | Contenido fiscal; sin los tres atributos | Este bloque |
| Pre-sello (Fase 5C.5) | + `NoCertificado` y `Certificado` del CSD `VALID`; sin `Sello`. Entrada de la cadena original | Bloque de sello |
| `SealedCfdi40Xml` (`stage: "SEALED"`) | + `Sello` verificado localmente | Fase 5C.6: solo `createSealedCfdi40` (`docs/tasks/FASE5C6-CSD-SIGNING.md`) |

Nunca hay placeholders. TypeScript impide usar un XML sin sellar donde se exige uno sellado
(prueba con `@ts-expect-error`), y en tiempo de ejecución `sealed.ts` rechaza todo lo que no
registró el servicio de sello (§17). Las posiciones de los tres atributos están reservadas en
el orden de serialización.

---

## 10. Validación XSD (estado real)

- **No se valida contra XSD.** Solo hay: reglas propias derivadas de facetas XSD y matriz de
  errores, y comprobación de buena formación por ida y vuelta. Ninguna prueba ni resultado se
  presenta como «validado contra XSD».
- El XML sin sellar no puede ser válido contra el XSD; el gate (`schema.ts`) solo acepta
  `SealedCfdi40Xml`, responde `REJECTED / NOT_SEALED_BY_ORBIT` a todo lo no sellado por
  ORBIT y, para un CFDI sellado, `UNAVAILABLE / NO_APPROVED_XSD_ENGINE`. **Actualizado en Fase 5C.7:**
  el gate valida contra el XSD oficial y devuelve `XsdValidatedCfdi40` (`FASE5C7-XSD-VALIDATION.md`).
- Auditoría de motores (nada instalado):

| Candidato | Resultado |
|---|---|
| `xmllint-wasm` 5.3.0 | Auditoría técnica completa en §20: **NEEDS POC**. Fase 5C.7: descartado tras POC; elegido `libxml2-wasm` 0.7.2 (`FASE5C7-XSD-VALIDATION.md` §5) |
| `libxmljs2` 0.37.0 / `libxmljs` 1.0.11 | Bindings nativos (node-gyp/prebuild): descartados como en §AA.5.1 |
| `xsd-schema-validator` 0.11.0 | Ejecuta Java en un proceso hijo: descartado |
| `@cfdi/xsd` 4.0.19 | `ajv` (`new Function`), conversión a JSON Schema: no es validación XSD; descartado |

---

## 11. Decisiones abiertas

| # | Decisión | Estado en v1 |
|---|---|---|
| D1 | `invoiceDate` del borrador frente a la `Fecha` de emisión | Error si difieren; producto debe decidir si el timbrado actualiza la fecha |
| D2 | Zona 3 de `c_CodigoPostal` (dato oficial inconsistente, 830 CP) | No se emite; requiere aclaración con SAT/PAC |
| D3 | Serie/Folio | `Folio` = folio ORBIT completo; sin `Serie` |
| D4 | Rango de `TipoCambio` (FIX de Banxico, CFDI40118) | No verificable (sin fuente FIX); la guía la condiciona a procedimientos que publique el SAT |
| D5 | Lugar de expedición de sucursal | No modelado; se usa el CP fiscal |
| D6 | Unificar los catálogos de Invoice Studio con los oficiales | READY ya aplica el contrato CFDI con los catálogos oficiales (§14); la búsqueda de la UI (Codex) sigue usando el subconjunto curado |
| D11 | Filas READY anteriores al gate de §14 | No se migran (sin Prisma); el detalle las muestra con errores y la emisión las rechaza; falta decidir si el servicio de emisión las regresa a DRAFT |
| D12 | Compatibilidad de payloads Fase 3 que omiten `taxObject`/`vatFactor`/`exportCode` | Se conserva (defaults 02/TASA/01); ningún cliente del repositorio la usa; propuesta: retirarla en una revisión del contrato |
| D7 | Importes de concepto con 6 decimales (guía, pregunta 37) | ORBIT redondea a los decimales de la moneda (válido) |
| D8 | Políticas ORBIT más estrictas que el SAT (retención 0 %, retención con RFC genérico, retención IVA ≤ IVA trasladado, importe exacto) | Activas; revisables |
| D9 | Receptor extranjero (CFDI40155 frente a la práctica sin comercio exterior) | No soportado |
| D10 | Matriz de errores `.xls` versionada en el repositorio (454 KB) | Versionada para auditoría |

---

## 12. Gates siguientes

1. **Cadena original** (en curso: `docs/tasks/FASE5C5-CADENA-ORIGINAL.md`; includes versionados, motor pendiente de autorización): versionar los `xsl:include` de
   `cadenaoriginal_4_0.xslt` (incluido `utilerias.xslt`) desde sus URLs oficiales con hash;
   decidir motor XSLT con el gate de `FASE5C3 §AA.5.3` (la hoja declara `version="2.0"`);
   serializador pre-sello con `NoCertificado`/`Certificado` del CSD `VALID`; reproducir byte
   a byte cadenas de CFDI oficiales o de prueba. Si ningún motor pasa: se detiene la fase
   (§AA.5.4).
2. **Sello**: `CsdVault.sign` (RSA-SHA256 PKCS#1 v1.5) y verificación local (FASE5C §16.4).
3. **XSD**: motor aprobado; validar solo `SealedCfdi40Xml`; nunca enviar al PAC sin `VALID`.
4. **PAC / ISSUED**: solo después de los tres anteriores (FASE5C §17–§21).

---

## 13. Pruebas

`tests/cfdi40.test.ts` (fixtures sintéticos en `tests/fixtures/cfdi40.ts`; XML de referencia
escrito a mano en `tests/fixtures/cfdi40/ingreso-pue-iva16.unsigned.xml`). Estado de los
fixtures: `BUILDER_VALID` (pasan el constructor de ORBIT) o inválidos; **ninguno es
SAT-XSD-validated**. Cubren: recursos y hashes, recurso alterado/ausente, atributos
requeridos del XSD, catálogos, decimales y límites con los ejemplos oficiales, Fecha y
horario de verano, escape, XML de referencia byte a byte, determinismo, PUE, PPD, IVA 16 %,
0 %, exento, descuento, múltiples conceptos, retenciones, USD con tipo de cambio, RFC
genérico, Unicode y caracteres escapables, alcance no soportado, datos inválidos, totales
inconsistentes, catálogo inexistente o no verificable, errores sin datos fiscales, separación
sin sellar/sellado, mapper y adaptador.

`tests/cfdi40-hardening.test.ts` (§14–§18): gate de READY frente a emisión, traducción al
contrato de Invoice Studio, defaults heredados, ausencia de zona por defecto, separación sin
sellar/sellado en tipos y en ejecución (CSD sintético de `tests/fixtures/synthetic-csd.mjs`,
que **no prueba validez SAT**), integridad de recursos y scripts. `tests/phase5.test.ts`:
`taxObject`/`exportCode` no seleccionados. `scripts/phase5-e2e.mjs`: RFC sintéticos
corregidos al patrón oficial `t_RFC`.

---

# Hardening final de Fase 5C.4

## 14. READY frente al constructor CFDI

**Auditoría.** Antes, READY = `validateInvoiceRules` (catálogos curados de
`sat-catalogs.ts` / `sat-catalogs-large.ts`) y `documentType = I`. Casos que READY aceptaba y
el contrato CFDI 4.0 rechaza (verificados con el constructor):

| Caso | Invoice Studio | Constructor CFDI |
|---|---|---|
| RFC fuera de `t_RFC` (p. ej. último carácter distinto de dígito o `A`) | Aceptado (regex ORBIT más laxa) | `RFC_INVALID` |
| Receptor extranjero `XEXX010101000` | Aceptado | `FOREIGN_RECEIVER_UNSUPPORTED` |
| Exportación 03/04 (activas en el catálogo curado) | Aceptadas | `EXPORT_UNSUPPORTED` |
| IVA 8 % (frontera) | Advertencia | `VAT_BORDER_RATE_UNSUPPORTED` |
| `01010101` | Advertencia | `PRODUCT_CODE_GENERIC` |
| Claves que exigen complemento (p. ej. 15101505) | Aceptadas | `PRODUCT_COMPLEMENT_UNSUPPORTED` |
| ClaveProdServ/ClaveUnidad: subconjunto curado frente al catálogo oficial con vigencia; claves solo-XSD | Curado | `CATALOG_CODE_UNKNOWN` / `_NOT_IN_FORCE` / `_UNVERIFIABLE` |
| `\|` o caracteres de control en textos | Aceptados | `TEXT_PIPE_NOT_ALLOWED` / `TEXT_INVALID_CHARACTER` |
| Descuento igual al importe con objeto 02 (base 0) | Aceptado | `TAX_BASE_NOT_POSITIVE` |
| CP fiscal del emisor en la zona 3 | Aceptado | `ISSUE_TIME_ZONE_UNRESOLVED` |

**Resolución.** READY significa «contenido fiscal emitible según el contrato CFDI 4.0 vigente
en el instante de READY». `evaluate()` (`src/services/outgoing-invoices.ts`) ejecuta, cuando
las reglas propias de Invoice Studio no tienen errores y el tipo es I, `checkCfdi40Content`:
el mismo mapper, normalizador, validador y serializador que la emisión, en modo `CONTENT`.
No se duplica ninguna regla: Invoice Studio conserva sus mensajes por campo y el contrato CFDI
vive solo en `src/lib/cfdi40`. Los issues se traducen con `readiness.ts` a
`InvoiceValidationIssue` (`code: "CFDI_<código>"`, `severity: "ERROR"`, sección, campo y
concepto; el mensaje añade la regla oficial `CFDI40xxx` cuando existe). Se aplica en validar,
crear, actualizar (se guarda con el borrador), marcar READY y el detalle (revalidado).

**Diferencia READY / emisión.** La emisión (`buildUnsignedCfdi40`, modo `EMISSION`) exige
además `status = READY` y que `invoiceDate` sea la fecha local de la `Fecha` (D1), y reevalúa
vigencias y zona en su propio instante. No se agrega estado; `ISSUED` no cambia.

**Contrato publicado.** Sin cambios de tipos ni rutas. Nuevos valores de `code` (tipo
`string`): `CFDI_*`, `EXPORT_CODE_REQUIRED`, `CONCEPT_TAX_OBJECT_REQUIRED`.

## 15. Política de defaults fiscales heredados

No se inventa ningún valor. Procedencia y política:

| Valor | Origen automático | Política |
|---|---|---|
| `productCode = 01010101` | Default de BD (migración Fase 3) | **Bloquea siempre** (`PRODUCT_CODE_GENERIC`), aun guardado de nuevo: hay que elegir la clave específica |
| `unitCode = ACT` | Default de BD (migración Fase 3), siempre junto con `01010101` | **Aceptable** como elección: unidad oficial vigente; en filas heredadas no llega sola al CFDI porque `01010101` bloquea y la revisión la muestra |
| `taxObject = 02`, `vatFactor = TASA`, `exportCode = 01`, `vatRate = taxRate` | Defaults y backfill de la migración Fase 5 | **Requiere confirmación** en filas heredadas (`LEGACY_RECORD_REVIEW_REQUIRED`) |
| `""` de Invoice Studio (sin seleccionar) | Antes, zod lo convertía en 02/01 en silencio | **Bloquea READY**: se guarda `""` (`CONCEPT_TAX_OBJECT_REQUIRED`, `EXPORT_CODE_REQUIRED`; constructor: `TAX_OBJECT_MISSING`, `EXPORT_CODE_MISSING`); sin objeto de impuesto no se calcula IVA |
| `vatFactor = TASA` preseleccionado y visible en Invoice Studio | Selección visible | **Aceptable**: con TASA la tasa se elige explícitamente (`CONCEPT_VAT_RATE_REQUIRED` / `CONCEPT_VAT_MISSING`); TASA sola nunca produce importe |
| `taxObject`/`vatFactor`/`exportCode` omitidos (`undefined`/`null`) en la API | Compatibilidad con payloads Fase 3 | Se conserva (D12); ningún cliente del repositorio la usa |

**Marca de registro heredado.** `StampedInvoice.validation === null` ⇒ nunca se guardó con las
reglas de Fase 5 (`legacyRecord`). Confirmar = abrirla en Invoice Studio (los valores se ven) y
guardarla. Límite: hasta este cambio, marcar READY escribía `validation` sin reescribir
conceptos, así que un borrador heredado marcado READY perdió la marca; ahora marcar READY una
fila heredada falla. Esas filas no se distinguen sin una columna de procedencia (fuera de
alcance: sin Prisma); `01010101` sigue bloqueando en ellas.

## 16. Zona horaria y lugar de expedición

- Sin código postal ni zona por defecto, ni en READY ni en emisión: CP fiscal ausente ⇒
  `ISSUER_DATA_MISSING`; CP inexistente en `c_CodigoPostal` ⇒ `PLACE_OF_ISSUE_UNKNOWN`
  (CFDI40126); zona no resoluble ⇒ `ISSUE_TIME_ZONE_UNRESOLVED` (CFDI40101). Los mensajes
  indican corregir el Perfil Fiscal y que ORBIT no usa zona por defecto.
- Datos de zona malformados (desfase vacío o no entero, regla incompleta, ordinal inválido,
  verano ≠ invierno + 1 h) ⇒ no resoluble.
- Una prueba prohíbe `Mexico_City`, `America/`, `Etc/GMT`, `toLocale*String` y
  `getTimezoneOffset` en `src/lib/cfdi40`.
- Fuera del CFDI siguen existiendo `America/Mexico_City` para la regla de fecha del borrador de
  Invoice Studio (`mexicoToday`) y la fecha inicial de la UI; no intervienen en la `Fecha`.

## 17. Sin sellar frente a sellado

- **Tipos.** `SealedCfdi40Xml` lleva una marca solo de tipo: ni `UnsignedCfdi40Xml` ni un
  literal la satisfacen. `cfdi40SchemaValidator.validate` y `Cfdi40PacAdapter.submit`
  (`Cfdi40PacSubmission { cfdi: SealedCfdi40Xml }`) solo aceptan sellados.
- **Ejecución.** `sealed.ts` acepta un valor solo si el servicio de sello lo registró
  (`WeakSet` privado; en esta fase no existe función para registrar, así que todo se rechaza,
  incluso una falsificación bien formada) y si:
  - `Sello`: Base64 canónico, 128–1024 bytes, no constante y de la longitud del módulo RSA del
    certificado;
  - `Certificado`: Base64 canónico de un X.509 válido que no es de CA;
  - `NoCertificado`: 20 dígitos e igual al derivado del número de serie (§M.8);
  - coinciden con el certificado del CSD activo (`Cfdi40CertificateBinding`);
  - `bytes`, `xml` y `sha256` son consistentes.
  `assertSealedCfdi40` / `pacSubmission` lanzan `SEALED_CFDI_REQUIRED`; el gate XSD responde
  `REJECTED`.
- **No se afirma** la verificación criptográfica del sello: requiere la cadena original
  (FASE5C §16.4) y corresponde al bloque de sello, que registrará el CFDI solo después de
  verificarlo.

## 18. Integridad de recursos SAT

- SHA-256 y tamaño de cada recurso contra el manifiesto, byte a byte; el directorio contiene
  exactamente los archivos del manifiesto.
- Rutas confinadas (`cfdi40ResourcePath`): se rechazan rutas absolutas, con `\`, con `..`, de
  otro directorio o con otro nombre ⇒ `SAT_RESOURCE_PATH_INVALID`, antes de tocar el disco.
- `.gitattributes`: `resources/sat/** binary` (comprobado con `git check-attr`); una conversión
  de fin de línea es una modificación (`SAT_RESOURCE_CORRUPT`).
- Sin descargas: ni el módulo ni `scripts/sat/*` usan red; `build-cfdi40-resources.mjs` se
  niega a reemplazar un recurso distinto sin `--replace` (probado en un directorio aislado) y
  `build-catcfdi.mjs` solo lee `resources/sat`.
- Los 32 `xsl:include` siguen sin resolver (`includesStored: false`).

## 19. Serverless / Vercel

- **Hoy:** nada lee `resources/sat/cfdi40` en tiempo de ejecución. Los catálogos JSON se
  importan y quedan en el bundle (comprobado: `route.js.nft.json` de
  `/api/outgoing-invoices` lista los chunks de `c_ClaveProdServ`, `c_ClaveUnidad` y
  `c_CodigoPostal`); ningún `.nft.json` contiene `resources/sat`. No se modifica
  `next.config.ts`.
- **Al conectar los gates XSD/XSLT:** `readCfdi40Resource` lee con `process.cwd()` y una ruta
  del manifiesto, que el trazado estático no detecta. Hay que agregar, solo para la ruta de
  sello (no `/*`, para no cargar 6 MB en todas las funciones), sin el `.xls`:

  ```ts
  outputFileTracingIncludes: {
    "/api/outgoing-invoices/[id]/<ruta-de-sello>": [
      "./resources/sat/cfdi40/*.xsd",
      "./resources/sat/cfdi40/*.xslt",
    ],
  },
  ```

  Claves = globs de ruta (picomatch); valores = globs desde la raíz del proyecto
  (`node_modules/next/dist/docs/.../output.md`). Runtime Node.js (no Edge).
- **Verificación:** tras `npm run build`, el `route.js.nft.json` de esa ruta debe listar
  `cfdv40.xsd`, `tdCFDI.xsd`, `catCFDI.xsd` (y la XSLT con sus includes cuando se versionen);
  agregar una prueba que lo lea. En ejecución, un recurso ausente o alterado falla cerrado
  (`SAT_RESOURCE_MISSING`/`_CORRUPT`). Pendiente de comprobar en un Preview (sin despliegue
  en esta fase) que `process.cwd()` es la raíz con las rutas trazadas.
- **Si se aprueba xmllint-wasm:** `serverExternalPackages: ["xmllint-wasm"]` e incluir
  `./node_modules/xmllint-wasm/xmllint-node.js` y `xmllint.wasm` (se cargan con
  `path.resolve(__dirname, …)` en un `worker_threads.Worker` y con `fs.readFileSync`).

## 20. Auditoría técnica de xmllint-wasm 5.3.0

Método: lectura estática de los archivos publicados de `xmllint-wasm@5.3.0` desde jsDelivr
(lista con hashes de `data.jsdelivr.com`) en el navegador aislado. Nada instalado, ejecutado ni
agregado al repositorio.

| Aspecto | Hallazgo |
|---|---|
| Licencia | MIT (`COPYING`); libxml2 también MIT |
| Dependencias | Ninguna de runtime; `peerDependencies: @types/node >=16` (solo tipos) |
| Scripts de instalación | Ninguno (`test`, `lint`, `check-types`, `build`) |
| `eval` / `new Function` | Ninguno en `index-node.js`, `xmllint-node.js`, `index-browser.mjs`, `xmllint-browser.mjs` |
| Red | En Node, `xmllint.wasm` se lee con `fs.readFileSync(__dirname + …)`; `fetch`/`XMLHttpRequest` solo en ramas de navegador/worker del glue de emscripten (archivos «lazy» no usados); sin emulación de sockets en el wasm. Las dependencias del XSD se pasan en memoria (`preload`); un `schemaLocation` remoto no puede descargarse |
| Procesos | Un `worker_threads.Worker` por validación (se termina al final); sin `child_process` |
| Capacidad XSD real | libxml2 2.13.8 (cadena `21308` en el wasm), `xmllint --schema`: validación XSD 1.0 real |
| Imports/includes locales | `cfdv40.xsd` importa `catCFDI.xsd` y `tdCFDI.xsd` por URL absoluta del SAT: hay que mapearlos a los archivos verificados (reescritura en memoria tras la verificación de hash, sin tocar el archivo oficial, o catálogo XML) y usar `--nonet` |
| Node/Vercel | Node ≥ 16; necesita `serverExternalPackages` y trazado del worker y del wasm; memoria por defecto 16–32 MiB: `catCFDI.xsd` (6 MB, enumeraciones enormes) probablemente exige subir `maxMemoryPages`; el esquema se compila en cada llamada |
| Mantenimiento | Un mantenedor (noppa); 52 estrellas, 2 issues y 1 PR abiertos; publicado 2026-08-05 |
| Tamaño | 875 339 bytes desempaquetado, 12 archivos; `xmllint.wasm` 778 732 bytes |
| Vulnerabilidades | `npm audit`: 0, pero no ve la libxml2 embebida. libxml2 publicó versiones de seguridad posteriores a 2.13.8: revisar en el POC qué CVE aplican al validador XSD. El sandbox WASM limita el impacto (sin FS ni red); queda la denegación de servicio (CPU/memoria). Las entradas son XML generado por ORBIT y XSD oficiales verificados, no archivos de usuarios |

**Recomendación: NEEDS POC** (proyecto aislado, sin instalar en el repositorio):
1. CFDI sellado de prueba ⇒ válido; fixtures inválidos (faceta, orden, atributo requerido,
   clave de catálogo) ⇒ inválidos con mensajes esperados;
2. sin red (ejecución con red deshabilitada);
3. resolución local de los dos imports con verificación de hash;
4. tiempo y memoria pico con `catCFDI.xsd`, frente a los límites de la función;
5. revisión de CVE de libxml2 2.13.8;
6. licencia y atribución.

Aprobación explícita antes de instalar.
