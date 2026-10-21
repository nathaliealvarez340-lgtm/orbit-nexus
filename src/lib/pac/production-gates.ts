// Fase 5C.8: evidence still missing before PRODUCTION stamping with a PAC (docs/tasks/
// FASE5C8-PAC-SANDBOX.md §23). A flag becomes true only with that evidence and explicit
// authorization, never to make a test or a demo pass. They are independent of the signing
// gates (src/lib/csd/production-gates.ts), the KMS/HSM provider and the Legal gate, which
// PRODUCTION also needs; this phase cannot build a PRODUCTION adapter at all
// (resolveSwPacConfiguration → PAC_PRODUCTION_BLOCKED).
export const productionPacGates = Object.freeze({
  /**
   * One real SW sandbox stamp verified end to end. Evidence (2026-10-21, FASE5C8 §21): one
   * POST of an XsdValidatedCfdi40 sealed with the official test CSD EKU9003173C9 → HTTP 200
   * PAC_STAMPED; TFD 1.1, SelloCFD, cadenaOriginalSAT, unchanged fiscal content and the
   * CFDI + TFD XSD all verified by ORBIT.
   */
  PAC_SANDBOX_LIVE_VALIDATED: true,
  /**
   * End to end in the real SW sandbox: a real POST whose outcome ORBIT loses → UNKNOWN →
   * process restart → reconcileStampAttempt → SW duplicate answer → the same UUID →
   * SUCCEEDED. Evidence (2026-10-21, FASE5C8 §21.3.2): a fresh process recovered the UNKNOWN
   * attempt and the real reconcileStampAttempt resent the persisted bytes with the same
   * CustomID (submissionCount=2 committed first) → SW HTTP 400 code 307 with the earlier CFDI
   * → PAC_PREVIOUSLY_STAMPED, the same UUID, SUCCEEDED, no new signature.
   */
  PAC_RECONCILIATION_LIVE_VALIDATED: true,
  /**
   * SelloSAT verified cryptographically over the TFD cadena with the SAT certificate named by
   * NoCertificadoSAT, from a trusted official source; today only structure and binding are.
   */
  TFD_SAT_SEAL_VERIFIED: false,
  /** Production PAC credentials, contract and configuration segregated from sandbox. */
  PAC_PRODUCTION_CREDENTIALS: false,
});

export type ProductionPacGate = keyof typeof productionPacGates;
