# ORBIT NEXUS · Fase 5C.5 — Cadena original CFDI 4.0

Rama `claude/fase5c5-cadena-original` (base `origin/main` @ `027a04a`). Sin firma CSD, sin
`Sello`, sin PAC, sin timbrado, sin TFD/UUID, sin `ISSUED`, sin migraciones, sin Neon, sin
despliegue. Codex trabaja en paralelo en la UI de pre-creación de clientes; esta fase no toca
UI ni ese flujo.

## 1. Resultado

| Pieza | Estado |
|---|---|
| XSLT oficial y sus 33 `xsl:include` | Versionados byte a byte, con URL, fecha, bytes, SHA-256, `Last-Modified`, `ETag` y padre |
| Resolución local de includes | Allowlist de URL oficiales → texto verificado por hash; todo lo demás falla cerrado |
| XML pre-sello | `serializePreSealCfdi40` / `buildPreSealCfdi40` (con `NoCertificado` y `Certificado`, sin `Sello`) |
| Metadata pública del CSD | `readActiveCsdCertificateBinding`: solo CSD `VALID`, sin abrir la llave |
| Generador | `generateCfdi40OriginalString(preSeal, { engine, bundle })`, puro y determinista |
| Motor XSLT | **Aprobado e instalado** con versión exacta: `@tradik/xslt-processor@1.3.4` + `@xmldom/xmldom@0.9.12` (§6), conectado en `generateOfficialCfdi40OriginalString` |
| Evidencia | Con el motor instalado: 25 cadenas byte a byte iguales a la referencia .NET (10 ORBIT + 15 PAC); 10 del PAC además con `Sello` verificado; también en el build real de Next sin `resources/` ni red (§13) |
| Gate de dependencias | `tests/cfdi40-engine-guard.test.ts`: versión, tarball, archivos instalados, XSLT SAT y configuración de Next fijados (§6.3) |

Entrada productiva: `generateOfficialCfdi40OriginalString(preSeal)` (`src/lib/cfdi40/xslt-engine.ts`,
`server-only`). `unavailableXsltEngine` (`XSLT_ENGINE_UNAVAILABLE`) se conserva para pruebas del
puerto; no hay respaldo manual: si el motor falla, la cadena falla.

## 2. Arquitectura

```
Draft READY → buildPreSealCfdi40(invoice, { issuedAt, catalogs, certificate })
                 │  certificate = readActiveCsdCertificateBinding(...).binding  (solo certificado público)
                 ▼
            PreSealCfdi40Xml  (stage PRE_SEAL, registrado, sin Sello)
                 ▼
generateCfdi40OriginalString(preSeal, { engine, bundle })
                 │  bundle = loadCfdi40XsltBundle()  (XSLT oficial + 33 includes, hash verificados)
                 │  engine = cfdi40XsltEngine (@tradik/xslt-processor 1.3.4 + @xmldom/xmldom 0.9.12)
                 ▼
            Cfdi40OriginalString  (valor exacto + bytes UTF-8 + SHA-256)
                 ▼
            [siguiente gate] CsdVault.sign → Sello → verificación local → SealedCfdi40Xml
```

| Módulo | Responsabilidad |
|---|---|
| `scripts/sat/build-cfdi40-resources.mjs` | Versiona recursos oficiales y, transitivamente, los includes de la XSLT; genera el manifiesto y el bundle |
| `src/lib/sat/cfdi40/manifest.json` | Origen, fecha, bytes, SHA-256, `Last-Modified`, `ETag`, `referencedBy` de cada recurso |
| `src/lib/sat/cfdi40/cadenaoriginal-xslt.json` | Texto UTF-8 exacto de la XSLT raíz y sus includes (generado) |
| `src/lib/cfdi40/xslt-resources.ts` | Verifica el bundle contra el manifiesto; resolver allowlist |
| `src/lib/cfdi40/certificate-binding.ts` | `NoCertificado`/`Certificado` solo desde un certificado público válido |
| `src/lib/cfdi40/serialize.ts` | XML sin sellar y pre-sello |
| `src/lib/cfdi40/original-string.ts` | Puerto del motor, `compileCfdi40Xslt`, generador, adaptador estructural de `@tradik/xslt-processor` |
| `src/lib/cfdi40/xslt-engine.ts` | Motor aprobado conectado (`cfdi40XsltEngine`, `cfdi40XsltEngineId`) y `generateOfficialCfdi40OriginalString` |
| `src/lib/csd/certificate-number.ts` | `certificateNumberFromSerial` puro (sacado de `certificate.ts` para que la ruta de la cadena no arrastre Prisma ni la custodia) |
| `next.config.ts` | `serverExternalPackages: ["@tradik/xslt-processor"]` (§13) |
| `src/services/csd-store.ts` | `readActiveCsdCertificateBinding` (base de datos, sin llave) |

## 3. Recursos oficiales

Obtenidos el 2026-10-12 desde `http://www.sat.gob.mx/sitio_internet/cfd/…` (las URL exactas
que declara la XSLT; HTTP 200, sin redirecciones), copiados sin modificar a
`resources/sat/cfdi40/` (raíz) y `resources/sat/cfdi40/xslt/<ruta oficial>` (includes).
`.gitattributes`: `resources/sat/** binary` (sin conversión de fin de línea; 12 includes
empiezan con BOM UTF-8 y se conservan). La XSLT raíz vuelta a descargar coincide con el hash
de 5C.4.

**Árbol de includes:** `cadenaoriginal_4_0.xslt` → 33 `xsl:include` (ningún `xsl:import`);
ninguno de los 33 incluye o importa otro recurso (profundidad 1). Total: 34 archivos.

| # | Recurso (resources/sat/cfdi40/…) | URL oficial | Bytes | SHA-256 | Last-Modified | ETag |
|---|---|---|---|---|---|---|
| 0 | `cadenaoriginal_4_0.xslt` | http://www.sat.gob.mx/sitio_internet/cfd/4/cadenaoriginal_4_0/cadenaoriginal_4_0.xslt | 21324 | `b0559b380e73b850ca8a3da53b077a6051a09d87068d8d98e82dfd4acfba7565` | Fri, 17 Apr 2026 00:30:45 GMT | `80235f15569e7d9dfa81a67589ba04e8` |
| 1 | `xslt/2/cadenaoriginal_2_0/utilerias.xslt` | http://www.sat.gob.mx/sitio_internet/cfd/2/cadenaoriginal_2_0/utilerias.xslt | 920 | `1f7e9c9c04b2239cdf0928e6471d4f48165535c4d4d3ea445ec310b65cdf6c2c` | Sat, 08 Aug 2020 05:19:08 GMT | `fe27182d40f1523e8bff3bd25f51d2b2` |
| 2 | `xslt/donat/donat11.xslt` | http://www.sat.gob.mx/sitio_internet/cfd/donat/donat11.xslt | 994 | `608a65b07c5841857562026c244c81f9cf3ddd32ff1d28bebab347bb4230fee3` | Sat, 08 Aug 2020 05:20:07 GMT | `257d43cbf4b823df0762c49d39675b8c` |
| 3 | `xslt/divisas/divisas.xslt` | http://www.sat.gob.mx/sitio_internet/cfd/divisas/divisas.xslt | 707 | `64e24ea80b61f6a48ab242875e66877a49449286140187a668aa88241464640e` | Sat, 08 Aug 2020 05:20:04 GMT | `e6bf920a490452c3e280599f7a23c92b` |
| 4 | `xslt/implocal/implocal.xslt` | http://www.sat.gob.mx/sitio_internet/cfd/implocal/implocal.xslt | 1827 | `f99e91c983b7a43b72dc41129afca7342a30e6e45de71b34f7d4e5b6154439d4` | Sat, 08 Aug 2020 05:20:15 GMT | `9b44984838d70bdda1c4af2968b511fd` |
| 5 | `xslt/leyendasFiscales/leyendasFisc.xslt` | http://www.sat.gob.mx/sitio_internet/cfd/leyendasFiscales/leyendasFisc.xslt | 1410 | `1588e059a3fdfc29bcca4de27f99dcf52abbaa7d815f428f2353a3105f52328c` | Sat, 08 Aug 2020 05:20:26 GMT | `b185cee8ab5580fa739f9bda65d801ff` |
| 6 | `xslt/pfic/pfic.xslt` | http://www.sat.gob.mx/sitio_internet/cfd/pfic/pfic.xslt | 1010 | `5f18f835cf6007e92b156ad4cc65ab9167becdcfb1742f6cd655fd2f173e8b1b` | Sat, 08 Aug 2020 05:20:33 GMT | `f891f6a72fd677723aaf7d0dfb1e31c8` |
| 7 | `xslt/TuristaPasajeroExtranjero/TuristaPasajeroExtranjero.xslt` | http://www.sat.gob.mx/sitio_internet/cfd/TuristaPasajeroExtranjero/TuristaPasajeroExtranjero.xslt | 1931 | `5a65dd5bd8d340fdc547b92ff2797199a97674bf2c78feacb69186c91338a68b` | Sat, 08 Aug 2020 05:19:39 GMT | `a0b9f49cc95722b47bcfa42862e787e3` |
| 8 | `xslt/nomina/nomina12.xslt` | http://www.sat.gob.mx/sitio_internet/cfd/nomina/nomina12.xslt | 17105 | `4130bdb7f62d0987caa5af754ca0704c9e2693e3b454adfff02ba6146d673a08` | Sat, 08 Aug 2020 05:20:28 GMT | `8d9890d7942f57b18b961546bf9ce756` |
| 9 | `xslt/cfdiregistrofiscal/cfdiregistrofiscal.xslt` | http://www.sat.gob.mx/sitio_internet/cfd/cfdiregistrofiscal/cfdiregistrofiscal.xslt | 823 | `6f47783bfeafa3920cbb452a3adee0239efd2250c13b9d91d242930416d1dee2` | Sat, 08 Aug 2020 05:19:54 GMT | `a0d345d49e2ac3806b2310b834c7a631` |
| 10 | `xslt/pagoenespecie/pagoenespecie.xslt` | http://www.sat.gob.mx/sitio_internet/cfd/pagoenespecie/pagoenespecie.xslt | 1484 | `685854e25f091ebcb95a4865a7df80630949b2f400e47676ff8dfa2f3019a404` | Sat, 08 Aug 2020 05:20:32 GMT | `29624b6c06f68b6a3f4069d9505a033b` |
| 11 | `xslt/aerolineas/aerolineas.xslt` | http://www.sat.gob.mx/sitio_internet/cfd/aerolineas/aerolineas.xslt | 1912 | `b197afab9535802b04d5e614a2320c10b8b67180e97f120b51d7bb60e61e028d` | Sat, 08 Aug 2020 05:19:44 GMT | `7f0c2db3498b3a5552718581b834871d` |
| 12 | `xslt/valesdedespensa/valesdedespensa.xslt` | http://www.sat.gob.mx/sitio_internet/cfd/valesdedespensa/valesdedespensa.xslt | 2806 | `dff69b6c188c1332b6908936767050121571952a09b99f881c39e41773392b92` | Sat, 08 Aug 2020 05:20:52 GMT | `8683390ec6de694caff163af8bf4ced3` |
| 13 | `xslt/notariospublicos/notariospublicos.xslt` | http://www.sat.gob.mx/sitio_internet/cfd/notariospublicos/notariospublicos.xslt | 11323 | `7d2609b4b2977ace634d022e83f49bb20534bf137d7bdba014a40ee4b85e1d21` | Sat, 08 Aug 2020 05:20:31 GMT | `eb0884c2fece797eb13820ef25a3dda8` |
| 14 | `xslt/vehiculousado/vehiculousado.xslt` | http://www.sat.gob.mx/sitio_internet/cfd/vehiculousado/vehiculousado.xslt | 3029 | `683b2a66cfd07d67f3c19c48499692e648079d663475f2f04f14d37131a29235` | Sat, 08 Aug 2020 05:20:55 GMT | `ffe8cff49c285f6dd9b995cc76dc52b8` |
| 15 | `xslt/servicioparcialconstruccion/servicioparcialconstruccion.xslt` | http://www.sat.gob.mx/sitio_internet/cfd/servicioparcialconstruccion/servicioparcialconstruccion.xslt | 2145 | `692f0470dd0fd57e4c6ea87012296b78d67c31b00c3120eaba446d29219b29e4` | Sat, 08 Aug 2020 05:20:46 GMT | `9a7010fadaf10f014e993c1e3fa652de` |
| 16 | `xslt/renovacionysustitucionvehiculos/renovacionysustitucionvehiculos.xslt` | http://www.sat.gob.mx/sitio_internet/cfd/renovacionysustitucionvehiculos/renovacionysustitucionvehiculos.xslt | 6777 | `1cda351ecbe8c4ddb4c6bb6508e7ea9c36b11627317870f04939765274979aba` | Sat, 08 Aug 2020 05:20:45 GMT | `65dbc57768e72dc7b1f282f1a588344e` |
| 17 | `xslt/certificadodestruccion/certificadodedestruccion.xslt` | http://www.sat.gob.mx/sitio_internet/cfd/certificadodestruccion/certificadodedestruccion.xslt | 2882 | `e4b09099c1453b47bb286a69b05e60d5a5bccaaac466a4a2aebf788601f69349` | Sat, 08 Aug 2020 05:19:51 GMT | `64f1b00e93286a6fd5078a80b748b014` |
| 18 | `xslt/arteantiguedades/obrasarteantiguedades.xslt` | http://www.sat.gob.mx/sitio_internet/cfd/arteantiguedades/obrasarteantiguedades.xslt | 1603 | `0823ab4e0ad86ffc6b674680981f4471a60c8ab72431b8dedacd08b1e61ba8e8` | Sat, 08 Aug 2020 05:19:46 GMT | `ec20340119f649304bbb736292f26bc2` |
| 19 | `xslt/ComercioExterior11/ComercioExterior11.xslt` | http://www.sat.gob.mx/sitio_internet/cfd/ComercioExterior11/ComercioExterior11.xslt | 7293 | `c96afd3f14e8c1802a653ffe71d7147f2f74eb4f5daf9e0b21afca0b2c80c7f7` | Sat, 08 Aug 2020 05:19:26 GMT | `1ce58f58063c76a94fd59b528ef02751` |
| 20 | `xslt/ComercioExterior20/ComercioExterior20.xslt` | http://www.sat.gob.mx/sitio_internet/cfd/ComercioExterior20/ComercioExterior20.xslt | 7039 | `b7540d6878c8d1e14b3d7f8a8bf3889dc03b0dfb6dfbfc6d6b30e27a094b8446` | Tue, 16 Jan 2024 17:04:51 GMT | `50dacdf61c9dcaf068c9922fab4094fc` |
| 21 | `xslt/ine/ine11.xslt` | http://www.sat.gob.mx/sitio_internet/cfd/ine/ine11.xslt | 1966 | `4098bf77bfee89e870604b7bc96ba4bdb19df78341f5e0cbffdd094eb916bcad` | Sat, 08 Aug 2020 05:20:25 GMT | `ab39e084501e814d4a86c1404d7b66b9` |
| 22 | `xslt/iedu/iedu.xslt` | http://www.sat.gob.mx/sitio_internet/cfd/iedu/iedu.xslt | 1244 | `ef5e7e6cc0666cfc67d0c41ad865c2a044947289013ca2add0f89dea7fde667f` | Sat, 08 Aug 2020 05:20:15 GMT | `4c41f1edfafe204c647ecc18ef92479a` |
| 23 | `xslt/ventavehiculos/ventavehiculos11.xslt` | http://www.sat.gob.mx/sitio_internet/cfd/ventavehiculos/ventavehiculos11.xslt | 1864 | `77a103915ea66d6ade5a23e5db7e3c66467abf744acef5f9ac8cafdc16362c7d` | Sat, 08 Aug 2020 05:20:57 GMT | `fa8a891546b979e7de15bbeb4141f29e` |
| 24 | `xslt/detallista/detallista.xslt` | http://www.sat.gob.mx/sitio_internet/cfd/detallista/detallista.xslt | 2176 | `e09906ef78afc077aa3318ca87bf2469e8570f97299d2f0237a2bc81da1e5e12` | Sat, 08 Aug 2020 05:19:59 GMT | `549815efc82b814d641ca2c20a8c8406` |
| 25 | `xslt/EstadoDeCuentaCombustible/ecc12.xslt` | http://www.sat.gob.mx/sitio_internet/cfd/EstadoDeCuentaCombustible/ecc12.xslt | 4122 | `ad76f5a5c726df61fe82c1db5e3a189b1026fa0cd87518ea225498e24f4014fb` | Sat, 08 Aug 2020 05:19:29 GMT | `b5ffe7200e692f55acd3fab3301c8661` |
| 26 | `xslt/consumodecombustibles/consumodeCombustibles11.xslt` | http://www.sat.gob.mx/sitio_internet/cfd/consumodecombustibles/consumodeCombustibles11.xslt | 4192 | `f43a77f25aba6ea7ce48769a5c700d2edce78e75914fbe866eafdb816ac2a9c1` | Wed, 29 Dec 2021 01:38:47 GMT | `539ebe9f71f526668623e9b79e7d4ee2` |
| 27 | `xslt/GastosHidrocarburos10/GastosHidrocarburos10.xslt` | http://www.sat.gob.mx/sitio_internet/cfd/GastosHidrocarburos10/GastosHidrocarburos10.xslt | 5930 | `dc295079d9884a2afec09d63819eb874b4bede35ca8d4fe713625d0973e78a6b` | Sat, 08 Aug 2020 05:19:31 GMT | `da1094fa55a06f70c2708d5685554e08` |
| 28 | `xslt/IngresosHidrocarburos10/IngresosHidrocarburos.xslt` | http://www.sat.gob.mx/sitio_internet/cfd/IngresosHidrocarburos10/IngresosHidrocarburos.xslt | 1647 | `8dc9fb24cb47162da3d6fb831a1aa57a12571986eb123adfad2471370d56c10f` | Sat, 08 Aug 2020 05:19:34 GMT | `b4fe40d45bfc2a01fa0726ffe00489df` |
| 29 | `xslt/CartaPorte/CartaPorte20.xslt` | http://www.sat.gob.mx/sitio_internet/cfd/CartaPorte/CartaPorte20.xslt | 27549 | `0f8fa95e65eaf1fbfaba34ee7c0b78396dd04c920b1b54facddd178fad55add5` | Wed, 01 Dec 2021 19:10:38 GMT | `5a7600bfc5592638ded23c70c0e7f359` |
| 30 | `xslt/Pagos/Pagos20.xslt` | http://www.sat.gob.mx/sitio_internet/cfd/Pagos/Pagos20.xslt | 9827 | `9277a0a5049fbd56e3123e6489ffb16f6ccfbca30943aa7dbd0f969f3b70bd0f` | Wed, 05 Jan 2022 16:32:17 GMT | `7f79776aaf1cac9c258418f3606c6fec` |
| 31 | `xslt/CartaPorte/CartaPorte30.xslt` | http://www.sat.gob.mx/sitio_internet/cfd/CartaPorte/CartaPorte30.xslt | 33207 | `3da384b7797ab037c0fc37d79716e0f4eb7704c6a585353aa2d73c6f76892e35` | Mon, 25 Sep 2023 17:47:48 GMT | `4b19e91a64f97a4132e2b84e6c118b2e` |
| 32 | `xslt/CartaPorte/CartaPorte31.xslt` | http://www.sat.gob.mx/sitio_internet/cfd/CartaPorte/CartaPorte31.xslt | 34063 | `6ef3db6a004a7b27014bf8f03b9762f337479f0694525b193eaa9e3ff058fa0f` | Mon, 17 Jun 2024 01:41:07 GMT | `d1f542a806081961b2e16c5957aecb7b` |
| 33 | `xslt/HidrocarburosPetro/hidrocarburospetroliferos.xslt` | http://www.sat.gob.mx/sitio_internet/cfd/HidrocarburosPetro/hidrocarburospetroliferos.xslt | 1208 | `b212b9df8119de4278a24d5258b27ac295746b7476cc6aef969a3ad1d6c55a4b` | Mon, 27 Apr 2026 18:13:05 GMT | `8f40a2a24790e9416850fa5733c85a16` |

## 4. Resolución local (sin red, sin archivos)

- El bundle es un módulo JSON (como los catálogos oficiales): el bundler lo incluye en el
  código del servidor; no hay lectura de archivos ni descarga en runtime.
- `verifyCfdi40XsltBundle` exige, contra el manifiesto: misma raíz; los 34 recursos presentes;
  SHA-256 del texto UTF-8 igual al del manifiesto (un byte, el BOM o el hash declarado
  alterados → `SAT_XSLT_RESOURCE_INTEGRITY_FAILED`); ningún recurso extra
  (`SAT_XSLT_RESOURCE_NOT_ALLOWED`); y cada `xsl:include`/`xsl:import` de cada hoja versionado
  (`SAT_XSLT_RESOURCE_MISSING`).
- `resolveSatXsltInclude(bundle, href)` acepta solo una URL absoluta `http://www.sat.gob.mx/
  sitio_internet/cfd/…` exactamente como está escrita y presente en la allowlist. Rechaza
  (`SAT_XSLT_RESOURCE_NOT_ALLOWED`): rutas relativas, `..`, `https:` u otro host, puerto,
  mayúsculas normalizadas, usuario, query, fragmento, `file:`, `data:`, `javascript:`,
  localhost, IP privadas y de metadatos de nube. No hay red: no existe camino a `fetch`.
- `document()` se rechaza en el adaptador.

## 5. XSLT 2.0 declarado, XSLT 1.0 usado

Las 34 hojas declaran `version="2.0"`, pero solo usan instrucciones XSLT 1.0
(`stylesheet`, `output`, `include`, `template`, `param`, `with-param`, `call-template`,
`apply-templates`, `for-each`, `if`, `value-of`), XPath 1.0 (rutas `./@Atributo`,
`./ns:Elemento`, `.//`, `/`, `./*`, una igualdad y una prueba de variable) y dos funciones:
`string()` y `normalize-space()`. Sin `as=`, `xsl:function`, `xsl:sequence`, regex,
`document()` ni `xsl:import`. El único `xsl:value-of` recibe una cadena, así que no hay
diferencia de semántica 1.0/2.0 (separador de secuencias). Conclusión: un procesador XSLT 1.0
conforme en modo forwards-compatible produce el mismo resultado. Una prueba fija este
inventario: si el SAT publica hojas con otras construcciones, falla y hay que re-auditar el
motor.

## 6. Auditoría de motores XSLT

| Candidato | Licencia | Resultado |
|---|---|---|
| **`@tradik/xslt-processor` 1.3.4** + `@xmldom/xmldom` 0.9.12 | BSD-3-Clause + MIT | **APROBADO e instalado** (2026-10-12, versión exacta). Pasa el POC y el gate con motor real (§6.2) |
| `libxslt-wasm` 0.0.20 | MIT (libxslt/libxml2 MIT) | **RECHAZADO**: su build trata `version="2.0"` como error de compilación ("only 1.1 features are supported") y la salida es solo espacios; resuelve includes con `fetch` (red) sin hook local; exige `--experimental-wasm-jspi` |
| `@pretextbook/libxslt-wasm` 0.1.1 | MIT | No evaluado en POC: misma arquitectura libxslt-WASM, 2 versiones (2026-07). Rechazado por madurez |
| `xslt-polyfill` 1.0.31 | BSD-3 | Polyfill de navegador (libxslt WASM); no orientado a Node. No evaluado |
| `xsltjs` 0.0.75 | MIT | JS puro, versión 0.0.x, depende de `xpath` 0.0.34. No evaluado (madurez) |
| `xslt-bridge` 1.0.0, `polyxslt` 1.1.0 | MIT | Publicados hace días, un solo mantenedor. Rechazados por madurez |
| `@tim-riep/node-xslt` 0.2.0 | Apache-2.0 | Binario nativo vía FFI (`koffi`), 58 MB. Rechazado |
| `saxonjs-he` 3.0.0-beta2 | Licencia propia | Beta; licencia por confirmar. Rechazado |
| Saxon-JS / `xslt3` | Propietaria | Rechazado (FASE5C3 §AA.5.1) |
| `xslt-processor` | LGPL-3.0 | Rechazado (FASE5C3 §AA.5.1) |
| `@saxon-he/cli` | MIT (envoltorio) | Ejecuta Java en un proceso hijo. Rechazado |
| Bindings nativos de libxslt (`libxslt`, `libxslt-next`, …) | MIT | Binarios nativos; solo como fallback §AA.5.5 |
| `@cfdi/transform` | MIT | Reimplementa la XSLT. Rechazado (FASE5C3 §AA.5.1) |

### 6.1 `@tradik/xslt-processor` 1.3.4

| Criterio | Hallazgo |
|---|---|
| Licencia | BSD-3-Clause; DOM `@xmldom/xmldom` MIT |
| Mantenimiento | Creado 2026-01-27, 13 versiones, 1.3.4 publicada el 2026-10-12; un solo publicador (`tradik`). Riesgo: proyecto joven y de cadencia alta |
| Dependencias | Ninguna directa. Peers opcionales: `@xmldom/xmldom` (usado), `jsdom`, `@tradik/xslt3` (no se instalan). Transitivas con xmldom: 2 paquetes |
| Scripts npm | Ninguno de instalación (`build`, `test`, …) |
| `eval` / `new Function` | Ninguno en `dist` (búsqueda estática; las coincidencias son comentarios) |
| `child_process`, workers | Ninguno |
| Red | `fetch` solo en el loader asíncrono por defecto, que no se usa: la API síncrona sin loader falla; ORBIT pasa su loader allowlist. En el POC `fetch` global lanzaba error y nada lo llamó |
| Filesystem | Ninguno en `dist` |
| `import()` dinámico | Solo para `@tradik/xslt3` con `xsltVersion: "auto"`; el `XsltEngine` usado corre XSLT 1.0 |
| XSLT 2.0 | No es un procesador 2.0: ejecuta hojas 2.0 en modo forwards-compatible. Suficiente para el conjunto SAT (§5), no para XSLT 2.0 general |
| `xsl:include` / `xsl:import` | `stylesheetLoader` síncrono configurable; sin él, error |
| Namespaces | Correctos con `cfdi:`, `cartaporte20:`, `pago20:`, `nomina12:`, `cce11:`, `tfd:` y atributos no ASCII (`Año`, `Antigüedad`) |
| Node / Vercel | `engines.node >= 20.19`; Node 24 local; JS puro, sin binarios; se empaqueta normalmente |
| Determinismo | Dos ejecuciones sobre 15 fixtures: idénticas byte a byte |
| Vulnerabilidades | `npm audit`: 0 con `@xmldom/xmldom` 0.9.12. **xmldom 0.9.8–0.9.11 tiene advisories HIGH**: fijar ≥ 0.9.12 |
| Tamaño | 5.6 MB desempaquetado (incluye bundles de navegador y fuentes); `dist/xslt-processor.cjs` 393 KB |

**Gate FASE5C3 §AA.5.3 (POC aislado, fuera del repositorio):**

| Requisito | Resultado |
|---|---|
| 1. Ejecuta las XSLT oficiales versionadas | Sí: los mismos bytes que `resources/sat/cfdi40` |
| 2. Includes solo desde recursos allowlisted | Sí: 33/33 por el loader; cualquier otra URL lanza |
| 3. Sin red en runtime | Sí, con `fetch` global sustituido por uno que lanza (no se bloqueó la red del sistema operativo) |
| 4. Cadenas conocidas byte a byte | La única cadena esperada publicada por el PAC (`cadenaOriginal.txt`) corresponde a un XML que no está publicado; se usa la verificación de sellos (6) |
| 5. CFDI de prueba publicados por el PAC | Sí: SDK de SW sapien (MIT) |
| 6. Verificación del `Sello` existente | **10 CFDI con `Sello` verificado** (RSA-SHA256, `node:crypto`) sobre la cadena producida |
| 7. Espacios, Unicode, decimales, complementos | Unicode/escapes/espacios/decimales: fixtures ORBIT y caracteres especiales (dos motores); Carta Porte 2.0 con sello verificado; Pagos 2.0, Nómina 1.2, Comercio Exterior 1.1 (dos motores). ORBIT v1 no emite complementos |
| Licencia / auditoría de código / Vercel | Sí / sí / sí (JS puro) |

**Decisión: APROBADO `@tradik/xslt-processor@1.3.4` + `@xmldom/xmldom@0.9.12`** (2026-10-12),
instalados con `npm install --save-exact`; sin `npm audit fix` ni cambios de otras dependencias.
Condiciones de la aprobación:

1. versión exacta (hecho) y `--ignore-scripts` en CI (ninguno de los dos paquetes tiene scripts de
   instalación; la prueba de dependencias lo exige);
2. `DOMParser` de xmldom configurado para lanzar en errores (hecho: `onError` lanza un error sin
   mensaje del parser; sustituye al manejador por defecto que escribe en `console.error`);
3. prueba con el motor real sobre los 25 fixtures (hecho, §6.2); toda actualización la repite;
4. versión registrada en cada cadena (hecho: `xslt.engine` = `cfdi40XsltEngineId`).

Cableado aplicado (`src/lib/cfdi40/xslt-engine.ts`, `server-only`):

```ts
const domParser = new DOMParser({ onError(level) { if (level !== "warning") throw new XmlParseError(); } });
export const cfdi40XsltEngine = tradikXsltEngine({ XsltEngine }, domParser, cfdi40XsltEngineId);
export async function generateOfficialCfdi40OriginalString(xml: PreSealCfdi40Xml) {
  return generateCfdi40OriginalString(xml, { engine: cfdi40XsltEngine, bundle: await loadCfdi40XsltBundle() });
}
```

Solo se usa el `XsltEngine` síncrono (XSLT 1.0, modo forwards-compatible): `stylesheetLoader`
síncrono = resolver allowlist sobre el bundle verificado; `documentLoader` lanza
`SAT_XSLT_RESOURCE_NOT_ALLOWED`. **No se usa el loader asíncrono de la librería** (el único camino
a `fetch` en `dist`) ni `xsltVersion: "auto"` (el único `import()` dinámico, hacia `@tradik/xslt3`,
que no está instalado).

### 6.2 Gate con el motor real (`tests/cfdi40-cadena-engine.test.ts`)

Con el motor instalado y la ruta productiva, con `fetch`, `net.Socket#connect` y la lectura de
archivos (`fs.readFileSync`/`readFile`/`openSync`/`open`/`createReadStream`/`fs.promises`)
**bloqueados y registrados**, y la consola registrada:

| Prueba | Resultado |
|---|---|
| 33 `xsl:include` cargados por el motor real, cada uno una vez, solo desde el bundle | 33/33 |
| ORBIT (Ingreso PUE, PPD, IVA 16 %, exento, descuento, múltiples conceptos, persona física, retenciones, Unicode/escapes/emoji, USD con tipo de cambio, receptor genérico `XAXX010101000`) vía `generateOfficialCfdi40OriginalString` | 10/10 byte a byte = referencia .NET |
| CFDI de prueba del PAC (Ingreso, Egreso, Pagos 2.0, Nómina 1.2, Comercio Exterior 1.1, Carta Porte 2.0, addenda, caracteres especiales, MXN/AMD/XXX) | 15/15 = referencia; 10 `Sello` verificados |
| Determinismo | Dos ejecuciones y una instancia nueva del motor: idénticas |
| Allowlist / `document()` | Rechazados con el motor real |
| Red, archivos, consola durante la ejecución | 0 intentos, 0 salidas (con autoprueba de que los bloqueos funcionan) |

Si cualquiera falla, la cadena no se usa: no existe respaldo manual ni reimplementación.

**Diferencia de parser detectada y cerrada:** xmldom normaliza U+2028, U+2029 y U+0085 como fin de
línea (regla de XML 1.1) y .NET/XML 1.0 no; la misma factura produciría cadenas distintas. La
normalización de texto CFDI (`src/lib/cfdi40/normalize.ts`) los rechaza
(`TEXT_INVALID_CHARACTER`) antes de llegar al motor; la prueba demuestra ambas cosas.

### 6.3 Gate de dependencias (`tests/cfdi40-engine-guard.test.ts`)

Falla a propósito si cambia cualquiera de estos valores; actualizarlos exige repetir la auditoría
(§6.1), el gate con motor real (§6.2), la comparación con .NET y los sellos, y actualizar este
documento:

- versión exacta en `package.json` y en el lockfile (raíz y paquete), `integrity` y `resolved` del
  tarball, sin `hasInstallScript`, sin dependencias de runtime;
- SHA-256 de los archivos instalados que se ejecutan: `dist/xslt-processor.js`,
  `dist/xslt-processor.cjs`, `package.json` de tradik; `package.json` y huella de `lib/*.js` de
  xmldom;
- huella del conjunto XSLT SAT (34 URL + SHA-256) y SHA-256 del bundle JSON: una XSLT nueva del SAT
  no se usa sin revisión;
- `cfdi40XsltEngineId` = `@tradik/xslt-processor@1.3.4 (@xmldom/xmldom@0.9.12)`;
- `next.config.ts` mantiene `serverExternalPackages: ["@tradik/xslt-processor"]` (§13).

**Si no se aprueba (FASE5C3 §AA.5.4/§AA.5.5):** no se reimplementa la XSLT. Fallback: servicio
interno separado con un motor de referencia auditado (libxslt nativo o .NET
`XslCompiledTransform`, que en este POC dio bytes idénticos), detrás del mismo puerto
`Cfdi40XsltEngine`, con autenticación entre servicios y su propio análisis de seguridad.

## 7. XML pre-sello

- `cfdi40Tree(document, certificate)` escribe `NoCertificado` y `Certificado` en su posición de
  `cfdv40.xsd` (después de `FormaPago`, antes de `SubTotal`); `Sello` nunca. Sin certificado,
  el XML es exactamente el sin sellar de 5C.4.
- `serializePreSealCfdi40` valida el certificado (§8), serializa, comprueba la ida y vuelta y
  registra el valor (WeakSet, congelado). `isPreSealCfdi40` lo vuelve a comprobar (bytes,
  SHA-256); un objeto parecido o modificado no pasa.
- `buildPreSealCfdi40` ejecuta la construcción de emisión completa y exige que el certificado
  esté vigente en el instante `issuedAt`.
- La cadena original 4.0 incluye `NoCertificado` (no `Certificado` ni `Sello`); el XML
  pre-sello lleva ambos para que el XML firmado sea el mismo con el `Sello` añadido.
- Tipos: `UnsignedCfdi40Xml` → `PreSealCfdi40Xml` (marca de tipo) → `Cfdi40OriginalString`
  (marca de tipo) → futuro `SealedCfdi40Xml`. Un XML pre-sello no es sellado
  (`SELLO_MISSING`, `pacSubmission` lo rechaza).

## 8. Metadata pública del CSD

`readActiveCsdCertificateBinding(db, actor, custody, now, env)`:

1. `readCsdState` debe dar `VALID` (vigente, RFC del Perfil Fiscal confirmado, custodia del
   entorno fiscal capaz de servir la llave, sin desenvolverla);
2. lee del registro activo solo `environment`, `certificateDer`, `certificateSha256`,
   `serialNumberHex`, `certificateNumber`; el entorno debe ser el de la custodia;
3. `certificateBindingFromDer`: SHA-256, número de serie y `NoCertificado` deben coincidir con el
   registro; certificado X.509 RSA no de CA, vigente en `now`.

Nunca selecciona columnas del sobre (`ciphertext`, `iv`, `authTag`, `wrappedDek`) ni la
relación `privateKey`, no pide contraseña y no llama a `openPrivateKey` (prueba con un proxy
que registra cada consulta). Errores: `CSD_NOT_VALID`, `CSD_CERTIFICATE_MISMATCH`,
`CERTIFICATE_BINDING_INVALID`.

## 9. Generador

`generateCfdi40OriginalString(xml, { engine, bundle })`:

- solo acepta `PreSealCfdi40Xml` producido por ORBIT (`PRE_SEAL_CFDI_REQUIRED`; también en
  tipos con `@ts-expect-error`);
- compila una vez por motor y bundle; pasa la raíz y los includes sin BOM (firma de
  codificación, no contenido) y solo vía el resolver;
- devuelve el resultado **sin** recortar, normalizar ni recodificar; solo comprueba su forma
  (`||…||`, una línea, contiene el `NoCertificado` del certificado) o falla con
  `ORIGINAL_STRING_INVALID`;
- errores del motor → `XSLT_TRANSFORM_FAILED`, sin mensajes del motor (pueden contener XML);
  un include rechazado por el resolver conserva su código (`SAT_XSLT_RESOURCE_*`);
- sin base de datos, red, archivos temporales ni reloj.

## 10. Fixtures y evidencia

Niveles (`tests/fixtures/cfdi40/cadena/README.md`); ninguno es "verificado por el SAT":

- `SEAL_VERIFIED`: el CFDI de prueba trae `Sello` y `Certificado` (CSD de prueba del SAT) y el
  `Sello` se verifica con `node:crypto` sobre la cadena guardada. La prueba lo repite.
- `DUAL_ENGINE`: `@tradik/xslt-processor` (POC y paquete instalado) y Microsoft .NET `XslCompiledTransform`
  (PowerShell, includes servidos por `XmlPreloadedResolver` sin resolver de respaldo)
  produjeron bytes idénticos.

**CFDI de prueba del PAC (`sw/`, MIT, commits fijados en `provenance.json`):**

| Fixture | Evidencia | Tipo | Método | Moneda | SHA-256 de la cadena |
|---|---|---|---|---|---|
| `sw-ingreso` | SEAL_VERIFIED | I | PUE | AMD | `65e274aee9b59190…` |
| `sw-egreso-nota-credito` | SEAL_VERIFIED | E | PUE | AMD | `2b9f1777c491c6b3…` |
| `sw-addenda` | SEAL_VERIFIED | I | PUE | MXN | `7f0710ccead7226e…` |
| `sw-cartaporte20-ingreso-autotransporte` | SEAL_VERIFIED | I | PPD | AMD | `3d9b327362fa1ba2…` |
| `sw-cartaporte20-ingreso-aereo` | SEAL_VERIFIED | I | PUE | MXN | `cec060fb742d61f6…` |
| `sw-cartaporte20-traslado-ferroviario` | SEAL_VERIFIED | T | — | XXX | `5bf26a547f6c8f29…` |
| `sw-cartaporte20-traslado-maritimo` | SEAL_VERIFIED | T | — | XXX | `ce18c90049727df2…` |
| `sw-dotnet-timbrado` | SEAL_VERIFIED | I | PUE | MXN | `11895dd6d1396451…` |
| `sw-php-sellado` | SEAL_VERIFIED | I | PPD | MXN | `7d95fa6f1e20c200…` |
| `sw-python-timbrado` | SEAL_VERIFIED | I | PPD | AMD | `4c034e2e9795dd08…` |
| `sw-pagos20` | DUAL_ENGINE | P | — | XXX | `211fa34e7ee8b0f8…` |
| `sw-nomina12` | DUAL_ENGINE | N | PPD | MXN | `35d36b1d9bb9b861…` |
| `sw-comercio-exterior11` | DUAL_ENGINE | I | PPD | AMD | `133670b464d53150…` |
| `sw-ingreso-global` | DUAL_ENGINE | I | PUE | MXN | `bc041f04f110756d…` |
| `sw-caracteres-especiales` | DUAL_ENGINE | I | PPD | AMD | `c1c0d81a90efc51c…` |

**Facturas sintéticas ORBIT (`orbit/`, `DUAL_ENGINE`), cadena completa:**

```text
ingreso-descuento
||4.0|ORB-000123|2026-10-12T12:30:15|03|30001000000000000001|2500.00|250.00|MXN|2610.00|I|01|PUE|06600|SCA010101AB1|EMPRESA SINTETICA DE PRUEBAS|601|SCB020202CD2|CLIENTE SINTETICO DE PRUEBAS|64000|601|G03|84111506|2|E48|Servicio de facturación sintético|1250.00|2500.00|250.00|02|2250.00|002|Tasa|0.160000|360.00|2250.00|002|Tasa|0.160000|360.00|360.00||

ingreso-exento
||4.0|ORB-000123|2026-10-12T12:30:15|03|30001000000000000001|800.00|MXN|800.00|I|01|PUE|06600|SCA010101AB1|EMPRESA SINTETICA DE PRUEBAS|601|SCB020202CD2|CLIENTE SINTETICO DE PRUEBAS|64000|601|G03|84111506|1|E48|Servicio de facturación sintético|800.00|800.00|02|800.00|002|Exento|800.00|002|Exento||

ingreso-multiples-conceptos
||4.0|ORB-000123|2026-10-12T12:30:15|03|30001000000000000001|3523.82|100.00|MXN|3289.02|I|01|PUE|06600|SCA010101AB1|EMPRESA SINTETICA DE PRUEBAS|601|SCB020202CD2|CLIENTE SINTETICO DE PRUEBAS|64000|601|G03|84111506|2|E48|Servicio de facturación sintético|1500.00|3000.00|100.00|02|2900.00|002|Tasa|0.160000|464.00|2900.00|001|Tasa|0.100000|290.00|2900.00|002|Tasa|0.106667|309.33|84111506|1|E48|Servicio de facturación sintético|250.50|250.50|02|250.50|002|Exento|84111506|1.5|E48|Servicio de facturación sintético|99.99|149.99|02|149.99|002|Tasa|0.000000|0.00|80101500|0.3333|H87|Servicio de facturación sintético|10.00|3.33|02|3.33|002|Tasa|0.160000|0.53|84111506|1|E48|Servicio de facturación sintético|120.00|120.00|01|001|290.00|002|309.33|599.33|2903.33|002|Tasa|0.160000|464.53|149.99|002|Tasa|0.000000|0.00|250.50|002|Exento|464.53||

ingreso-persona-fisica
||4.0|ORB-000123|2026-10-12T12:30:15|03|30001000000000000001|1251.00|MXN|1451.16|I|01|PUE|06600|SCA010101AB1|EMPRESA SINTETICA DE PRUEBAS|601|PEMA800101AB3|PERSONA FISICA SINTETICA|64000|612|G03|84111506|4|E48|Servicio de facturación sintético|312.75|1251.00|02|1251.00|002|Tasa|0.160000|200.16|1251.00|002|Tasa|0.160000|200.16|200.16||

ingreso-ppd
||4.0|ORB-000123|2026-10-12T12:30:15|99|30001000000000000001|1351.50|MXN|1567.74|I|01|PPD|06600|SCA010101AB1|EMPRESA SINTETICA DE PRUEBAS|601|SCB020202CD2|CLIENTE SINTETICO DE PRUEBAS|64000|601|G03|84111506|3|E48|Servicio de facturación sintético|450.50|1351.50|02|1351.50|002|Tasa|0.160000|216.24|1351.50|002|Tasa|0.160000|216.24|216.24||

ingreso-pue-iva16
||4.0|ORB-000123|2026-10-12T12:30:15|03|30001000000000000001|1000.00|MXN|1160.00|I|01|PUE|06600|SCA010101AB1|EMPRESA SINTETICA DE PRUEBAS|601|SCB020202CD2|CLIENTE SINTETICO DE PRUEBAS|64000|601|G03|84111506|1|E48|Servicio de facturación sintético|1000.00|1000.00|02|1000.00|002|Tasa|0.160000|160.00|1000.00|002|Tasa|0.160000|160.00|160.00||

ingreso-retenciones-persona-moral
||4.0|ORB-000123|2026-10-12T12:30:15|03|30001000000000000001|10000.00|MXN|9533.33|I|01|PUE|06600|PEMA800101AB3|PERSONA FISICA SINTETICA|612|SCB020202CD2|CLIENTE SINTETICO DE PRUEBAS|64000|601|G03|84111506|1|E48|Servicio de facturación sintético|10000.00|10000.00|02|10000.00|002|Tasa|0.160000|1600.00|10000.00|001|Tasa|0.100000|1000.00|10000.00|002|Tasa|0.106667|1066.67|001|1000.00|002|1066.67|2066.67|10000.00|002|Tasa|0.160000|1600.00|1600.00||

ingreso-rfc-generico-nacional
||4.0|ORB-000123|2026-10-12T12:30:15|03|30001000000000000001|500.00|MXN|580.00|I|01|PUE|06600|SCA010101AB1|EMPRESA SINTETICA DE PRUEBAS|601|XAXX010101000|CLIENTE SIN RFC|06600|616|S01|84111506|1|E48|Servicio de facturación sintético|500.00|500.00|02|500.00|002|Tasa|0.160000|80.00|500.00|002|Tasa|0.160000|80.00|80.00||

ingreso-unicode-escape
||4.0|ORB-000123|2026-10-12T12:30:15|03|30001000000000000001|100.00|MXN|116.00|I|01|PUE|06600|SCA010101AB1|PEÑA & ASOCIADOS|601|SCB020202CD2|CAFÉ <EL SOL>|64000|601|G03|84111506|1|E48|Diseño & "montaje" <ÑANDÚ> 'año' 2026 🚀|100.00|100.00|02|100.00|002|Tasa|0.160000|16.00|100.00|002|Tasa|0.160000|16.00|16.00||

ingreso-usd-tipo-cambio
||4.0|ORB-000123|2026-10-12T12:30:15|03|30001000000000000001|255.00|USD|17.2543|295.80|I|01|PUE|06600|SCA010101AB1|EMPRESA SINTETICA DE PRUEBAS|601|SCB020202CD2|CLIENTE SINTETICO DE PRUEBAS|64000|601|G03|84111506|10|E48|Servicio de facturación sintético|25.50|255.00|02|255.00|002|Tasa|0.160000|40.80|255.00|002|Tasa|0.160000|40.80|40.80||
```

Los CFDI del PAC con sello que no verifica fueron editados después de sellarse (ambos motores
coinciden en sus cadenas); se usan solo como `DUAL_ENGINE`. En 42 CFDI del PAC, los dos motores
coincidieron byte a byte en todos los casos.

## 11. Seguridad

- Sin logs: los errores llevan código, categoría, ruta (`CadenaOriginal`, `XSLT/<recurso>`,
  `Comprobante/@Certificado`) y regla; nunca el XML, RFC, certificado ni la cadena.
- Nada en analytics. Sin llave privada, contraseña ni ciphertext en esta fase.
- El motor no escribe en consola: el manejador de errores de xmldom se reemplaza (por defecto usa
  `console.error` con fragmentos del XML); las pruebas registran la consola durante la ejecución.
- Sin `child_process`, `eval` ni `new Function` en los módulos de la cadena (prueba estática que
  incluye `xslt-engine.ts` y `certificate-number.ts`); `dist` de tradik y `lib` de xmldom tampoco
  los contienen. `fetch` aparece solo en el loader asíncrono de tradik, que no se usa.

## 12. XSD

Separado: en esta fase el estado era **NO XSD VALIDATED** (`xmllint-wasm`: NEEDS POC, sin instalar).
Fase 5C.7 implementa la validación XSD oficial: `FASE5C7-XSD-VALIDATION.md`.
El XML pre-sello tampoco es válido contra `cfdv40.xsd` (falta `Sello`). Orden futuro: pre-sello →
cadena → sello → XML sellado → XSD → PAC.

## 13. Serverless / Vercel

- La XSLT y sus includes viajan como el módulo JSON
  `src/lib/sat/cfdi40/cadenaoriginal-xslt.json`, importado con `import()` igual que los
  catálogos grandes (que ya aparecen como chunks en `.nft.json` de las rutas que los usan). No
  hay lectura de archivos: **no se necesita `outputFileTracingIncludes`** y Vercel no puede
  dejar fuera un include sin que falle el build o la verificación de hash.
- Pruebas que lo detectan: el bundle contiene exactamente los 34 recursos del manifiesto con
  sus bytes, y cada referencia de cada hoja está en él; los módulos de la cadena no usan
  `fs`, red ni procesos.
- `resources/sat/cfdi40` sigue siendo la fuente versionada y no se empaqueta.
- **`serverExternalPackages: ["@tradik/xslt-processor"]`** (`next.config.ts`): Turbopack falla el
  build al intentar resolver el `import("@tradik/xslt3")` literal de `dist` (peer opcional, no
  instalado). Como paquete externo, Next no lo re-empaqueta: Node carga en runtime exactamente el
  `dist/xslt-processor.js` auditado (hash fijado en §6.3) y el `import()` perezoso nunca se evalúa.
  xmldom sí se empaqueta en el chunk del servidor.

**Verificación con build real (2026-10-12, Next 16.3.6, Turbopack; ruta temporal de prueba
eliminada después):**

| Comprobación | Resultado |
|---|---|
| `npm run build` con una ruta que importa `generateOfficialCfdi40OriginalString` | Sin la config: falla (`Can't resolve '@tradik/xslt3'`). Con `serverExternalPackages`: OK |
| Traza `route.js.nft.json` de la ruta | Incluye el chunk del bundle JSON (281 KB), el chunk del servidor con xmldom y el generador, `node_modules/@tradik/xslt-processor/dist/xslt-processor.js` y su `package.json`; **ningún** archivo de `resources/`; ningún archivo de Prisma |
| `next start` con `resources/` renombrado y `fetch`/`net.connect`/`dns.lookup` bloqueados en el proceso (`NODE_OPTIONS=--require`) | 10/10 cadenas ORBIT byte a byte iguales a la referencia, dos veces, respuestas idénticas; 0 intentos de red; 0 lecturas de recursos SAT en disco; sin salida en consola |

Prueba permanente equivalente sin Next: `tests/cfdi40-cadena-runtime.test.ts` empaqueta la ruta
productiva con esbuild (condición `react-server`) en un directorio vacío —sin `resources/` ni
`node_modules`— y la ejecuta en un proceso con la red bloqueada: 10/10 iguales, sin Prisma ni
código de llave privada en el bundle, < 5 MB.

Hoy ninguna ruta de producción importa el motor (la cadena se usará en el sello, 5C.6), así que el
build de la aplicación no lo ejercita; `serverExternalPackages` queda configurado y protegido por la
prueba de dependencias para que la primera ruta que lo use compile.

## 14. Límites y riesgos

1. Ninguna ruta productiva usa la cadena todavía (la consume el sello, 5C.6); el build real se
   verificó con una ruta temporal (§13).
2. `@tradik/xslt-processor` es joven y de un solo mantenedor; versión exacta, archivos fijados por
   hash y gate con motor real como regresión. No es un procesador XSLT 2.0 completo (suficiente solo para el conjunto SAT
   auditado; la prueba de inventario detecta cambios).
3. La regla `NoCertificado` = número de serie (FASE5C3 §M.8) sigue siendo hipótesis hasta CSD
   de prueba oficiales; los CSD de prueba del PAC la cumplen (`30001000000500003416`).
4. Las cadenas ORBIT son de dos motores, no del SAT; las del PAC con sello verificado no cubren
   todo (Pagos, Nómina y Comercio Exterior solo `DUAL_ENGINE`).
5. Si el SAT publica una nueva versión de la XSLT, hay que volver a descargar con el script
   (`--replace` tras revisión) y regenerar evidencia.
6. Rotar `BETTER_AUTH_SECRET` no afecta esta fase.
7. U+2028/U+2029/U+0085 en textos CFDI se rechazan (diferencia de parser, §6.2); válidos para el
   SAT pero no admitidos por ORBIT para garantizar una única cadena.
8. `npm audit` mantiene las 6 vulnerabilidades altas preexistentes (cadena `next`/`eslint-config-next`
   y `fast-glob`/`micromatch`/`braces`), idénticas antes y después; ninguna en los dos paquetes nuevos.

## 15. Siguiente gate: firma CSD

1. ~~Autorizar e instalar el motor (§6) y activar la prueba con el motor real.~~ Hecho.
2. ~~Firma con el CSD custodiado, Sello en el XML pre-sello y verificación local.~~ Hecho en
   Fase 5C.6: `docs/tasks/FASE5C6-CSD-SIGNING.md`.
3. Siguiente: autorización por factura → sello → XSD → PAC (FASE5C6 §13).

## 16. Pruebas

- `tests/cfdi40-cadena.test.ts`: manifiesto y bundle, alteraciones, resolver y SSRF,
  inventario XSLT, ausencia de red/archivos/eval, XML pre-sello, certificado, generador
  (motor de referencia sobre fixtures), adaptador `@tradik`, evidencia de sellos.
- `tests/cfdi40-csd-binding.test.ts`: PGlite + CSD sintético configurado con el flujo real;
  binding solo del certificado público; sin CSD, vencido, otro entorno, RFC cambiado,
  registro alterado y otra Organization.
- `tests/cfdi40.test.ts`, `tests/cfdi40-hardening.test.ts`: actualizados a los includes.
- `tests/cfdi40-cadena-engine.test.ts`: gate con el motor real instalado (§6.2).
- `tests/cfdi40-engine-guard.test.ts`: versiones, tarballs, archivos y XSLT SAT fijados (§6.3).
- `tests/cfdi40-cadena-runtime.test.ts`: ruta productiva empaquetada, sin `resources/`, `node_modules`
  ni red (§13).
