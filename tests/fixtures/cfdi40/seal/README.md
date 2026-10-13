# Seal test vector (Fase 5C.6)

Independent evidence for ORBIT's CFDI seal: RSA-SHA256 with PKCS#1 v1.5 padding over the
UTF-8 bytes of the cadena original, Base64.

- `synthetic-seal-vector.cer`: SYNTHETIC certificate (synthetic CA, not SAT), RSA 2048,
  RFC `SCA010101AB1`, NoCertificado `30001000000000000001`, valid 2026-01-01 to 2036-01-01.
  Its private key was generated in memory for this vector, written only to a temporary
  directory outside the repository so the OpenSSL command line could use it, and deleted.
  It is not kept anywhere: this vector can be verified, never re-signed.
- `<fixture>.sello.txt`: the Sello produced by the OpenSSL command line
  (`openssl dgst -sha256 -sign`) over `../cadena/orbit/<fixture>.cadena.txt`, Base64, no
  trailing newline. The same NoCertificado gives the same cadena as the DUAL_ENGINE
  references (the cadena omits `Certificado`).
- `provenance.json`: tools, versions, hashes. When generated, Microsoft .NET Framework CNG
  (`RSACng.SignData`, `RSASignaturePadding.Pkcs1`) and `node:crypto` produced byte-identical
  signatures for all ten cadenas, and OpenSSL and .NET verified each one as PKCS#1 v1.5 and
  rejected it as PSS.

`tests/cfdi40-seal.test.ts` checks, without external tools, that ORBIT accepts these
OpenSSL-made sellos: the Sello verifies over the reference cadena and the sealed XML built
from them verifies on its own. Evidence level: independent implementations agree on a
synthetic key; it is not "verified by the SAT".
