# Cadena original fixtures (Fase 5C.5)

Every `*.cadena.txt` is the output of the official SAT `cadenaoriginal_4_0.xslt` (with its 33
versioned includes) on the matching XML, byte for byte, without a trailing newline. See
`docs/tasks/FASE5C5-CADENA-ORIGINAL.md` for how they were produced.

## Evidence levels (never "verified by the SAT")

| Level | Meaning |
|---|---|
| `SEAL_VERIFIED` | The fixture carries its own `Sello` and `Certificado` (SAT test CSD) and the `Sello` verifies, with `node:crypto` (RSA-SHA256), over this exact cadena. Proves the cadena is the one the CFDI was sealed with. |
| `DUAL_ENGINE` | Two independent XSLT engines produced identical bytes: `@tradik/xslt-processor` 1.3.4 with `@xmldom/xmldom` 0.9.12 (isolated POC) and Microsoft .NET `XslCompiledTransform` (Windows PowerShell). The fixture's own seal does not verify (it was edited after sealing) or it has none. Not an official expected value. |

## `sw/` — CFDI de prueba published by the PAC (SW sapien / SmarterWEB)

Taken unchanged from the public SDK repositories of `lunasoft` at pinned commits (MIT,
`LICENSE-SW.txt`; see `provenance.json` for each URL, commit and SHA-256). They use the SAT
test taxpayers and test CSD (e.g. `EKU9003173C9`, NoCertificado `30001000000500003416`), no
real taxpayer data.

## `orbit/` — synthetic ORBIT invoices

`*.preseal.xml` is produced by `buildPreSealCfdi40` from `tests/fixtures/cfdi40.ts` with the
public certificate `synthetic-seal-certificate.cer` (signed by a synthetic CA, fixed
NoCertificado `30001000000000000001`, valid 2026–2036; no private key is kept). Their
cadenas are `DUAL_ENGINE` references.
