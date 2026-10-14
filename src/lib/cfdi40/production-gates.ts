// Fase 5C.7: production readiness of the CFDI validation gates (docs/tasks/FASE5C7-XSD-VALIDATION.md
// §15). A flag is true only with the evidence listed for it, never to make a test or a demo
// pass. These gates do NOT enable signing (src/lib/csd/production-gates.ts), the PAC or
// ISSUED: each of those keeps its own gates.
export const productionCfdiGates = Object.freeze({
  /**
   * The official SAT XSD set is versioned byte-exact with a manifest and hashes verified at
   * runtime; the approved engine (libxml2-wasm, pinned and audited) validates the exact sealed
   * bytes in process, with a closed resolver, no network and no file access; XML security,
   * positive and negative fixtures and an independent validator (.NET XmlSchemaSet) agree; and
   * a real Next.js build serves it without resources/ or network.
   */
  XSD_OFFICIAL_VALIDATION_READY: true,
});
