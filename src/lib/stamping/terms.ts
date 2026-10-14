import { createHash } from "node:crypto";
import type { StampAuthorizationTerms } from "@/types/stamping";

// Fase 5C.8 (FASE5C §28, FASE5C3 §AA.9): the per-invoice stamping authorization. The text is
// the contract's affirmative statement; the version name marks it as provisional pending legal
// review, so it is never presented as approved. Changing the text requires a new version.
// The checkbox starts unchecked, applies only to the invoice and version shown, is consumed
// by exactly one StampAttempt and never authorizes future invoices or the e.firma.
export const stampAuthorizationTerms: StampAuthorizationTerms = Object.freeze({
  version: "autorizacion-timbrado-2026-10-borrador-1",
  text: [
    "Versión preliminar sujeta a revisión jurídica.",
    "Revisé la información del CFDI y autorizo a ORBIT NEXUS a utilizar el Certificado de Sello Digital configurado para sellar este comprobante y enviarlo al PAC para su certificación.",
    "Esta autorización aplica únicamente a este CFDI en la versión mostrada; no autoriza futuras facturas ni el uso de la e.firma, y no permite modificar los datos después del sellado.",
  ].join("\n\n"),
});

export const stampAuthorizationTermsSha256 = createHash("sha256")
  .update(stampAuthorizationTerms.text, "utf8")
  .digest("hex");
