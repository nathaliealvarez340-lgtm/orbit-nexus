// Fase 5C.8: evidence still missing before PRODUCTION stamping with a PAC (docs/tasks/
// FASE5C8-PAC-SANDBOX.md §23). A flag becomes true only with that evidence and explicit
// authorization, never to make a test or a demo pass. They are independent of the signing
// gates (src/lib/csd/production-gates.ts), the KMS/HSM provider and the Legal gate, which
// PRODUCTION also needs; this phase cannot build a PRODUCTION adapter at all
// (resolveSwPacConfiguration → PAC_PRODUCTION_BLOCKED).
export const productionPacGates = Object.freeze({
  /** One real SW sandbox stamp verified end to end (needs SW_SANDBOX_TOKEN and a test CSD). */
  PAC_SANDBOX_LIVE_VALIDATED: false,
  /** SW's real duplicate answers (same CustomID, same Sello) observed and reconciled. */
  PAC_RECONCILIATION_LIVE_VALIDATED: false,
  /**
   * SelloSAT verified cryptographically over the TFD cadena with the SAT certificate named by
   * NoCertificadoSAT, from a trusted official source; today only structure and binding are.
   */
  TFD_SAT_SEAL_VERIFIED: false,
  /** Production PAC credentials, contract and configuration segregated from sandbox. */
  PAC_PRODUCTION_CREDENTIALS: false,
});

export type ProductionPacGate = keyof typeof productionPacGates;
