// Pure, dependency-free: also used by the CFDI 4.0 cadena original runtime (Fase 5C.5),
// which must not pull the CSD custody, HTTP or database modules into its bundle.

/**
 * §M.8: the certificate serial number is 20 bytes, each an ASCII digit, and those digits are
 * the 20-digit NoCertificado. Any other serial is unsupported (step 8). Validated against
 * official SAT test CSD and a live SW sandbox stamp (gate OFFICIAL_CSD_FIXTURE_VALIDATED,
 * ./production-gates.ts); there is still no SAT document that states the rule.
 */
export function certificateNumberFromSerial(serialNumberHex: string) {
  const hex =
    serialNumberHex.length % 2 ? "0" + serialNumberHex : serialNumberHex;
  if (!/^[0-9A-Fa-f]+$/.test(hex)) return null;
  const bytes = Buffer.from(hex, "hex");
  if (bytes.length !== 20 || bytes.some((byte) => byte < 0x30 || byte > 0x39))
    return null;
  return bytes.toString("latin1");
}
