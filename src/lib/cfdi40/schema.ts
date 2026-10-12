import { isSealedCfdi40 } from "./sealed";
import type { SealedCfdi40Xml } from "./types";

// Fase 5C.4: XSD validation gate (FASE5C §15.3 step 4; FASE5C3 §AA.3, §AA.5).
//
// cfdv40.xsd requires Sello, NoCertificado and Certificado, so only a SEALED document can
// be XSD-valid. The validator takes SealedCfdi40Xml (compile time) and rejects anything not
// registered by ORBIT's sealing service (runtime, ./sealed.ts). No XSD engine is approved
// yet (parsing XML is not schema validation), so a genuine sealed CFDI gets UNAVAILABLE and
// the sealing/PAC flow must stop there: never send to a PAC without status VALID.
//
// An approved engine must: load the official cfdv40.xsd, tdCFDI.xsd and catCFDI.xsd from
// resources/sat/cfdi40 (hash-verified, src/lib/sat/cfdi40/manifest.json); resolve their
// remote schemaLocation imports only to those local files; make no network access, no
// eval/new Function and no child processes; and pass fixtures of valid and invalid CFDI.

export type Cfdi40SchemaValidation =
  | { status: "VALID" }
  | { status: "INVALID"; errors: readonly string[] }
  | { status: "REJECTED"; reason: "NOT_SEALED_BY_ORBIT" }
  | { status: "UNAVAILABLE"; reason: "NO_APPROVED_XSD_ENGINE" };

export interface Cfdi40SchemaValidator {
  validate(xml: SealedCfdi40Xml): Promise<Cfdi40SchemaValidation>;
}

export const cfdi40SchemaValidator: Cfdi40SchemaValidator = {
  async validate(xml) {
    if (!isSealedCfdi40(xml))
      return { status: "REJECTED", reason: "NOT_SEALED_BY_ORBIT" };
    return { status: "UNAVAILABLE", reason: "NO_APPROVED_XSD_ENGINE" };
  },
};
