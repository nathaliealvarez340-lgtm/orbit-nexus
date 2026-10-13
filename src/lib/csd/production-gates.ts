// Fase 5C.6: evidence still missing before fiscal PRODUCTION signing
// (docs/tasks/FASE5C6-CSD-SIGNING.md §10). Each flag changes only when that evidence exists
// and with explicit authorization, never to make a test or a demo pass. Fiscal PRODUCTION
// signing also needs a real KMS/HSM provider and productionLegalGateSatisfied (custody.ts);
// the signing service requires all of them and otherwise fails closed.
export const productionSigningGates = Object.freeze({
  /**
   * A verifiable mechanism confirms that the certificate is a CSD (SAT type "SELLOS"), not an
   * e.firma (FIEL): a SAT source, an authorized PAC or another official or contractually
   * reliable mechanism. ORBIT's local X.509 checks alone are not that evidence, and no
   * subject/issuer/OID heuristic without official evidence counts.
   */
  CSD_TYPE_VERIFIED: false,
  /**
   * RFC extraction (FASE5C3 §M.7) and NoCertificado derivation (§M.8) validated against
   * official test CSD material or a PAC/SAT fixture fit for tests (never a customer's CSD).
   */
  OFFICIAL_CSD_FIXTURE_VALIDATED: false,
  /**
   * FOR SHARE (signing) against the UPDATE of a replacement or disable verified on a real
   * PostgreSQL with concurrent sessions; PGlite serializes transactions and cannot prove it.
   */
  POSTGRES_CSD_CONCURRENCY_VALIDATED: false,
});

export type ProductionSigningGate = keyof typeof productionSigningGates;

/** The gates still pending; fiscal PRODUCTION signing requires an empty list. */
export const pendingProductionSigningGates = (
  gates: Readonly<
    Record<ProductionSigningGate, boolean>
  > = productionSigningGates,
) =>
  (Object.keys(gates) as ProductionSigningGate[]).filter(
    (gate) => !gates[gate],
  );
