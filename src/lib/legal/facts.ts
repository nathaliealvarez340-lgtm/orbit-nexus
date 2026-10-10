// Fase 5C.2 §5: facts only the service operator can provide. ORBIT never invents them;
// null means "not defined yet" (docs/legal/OPEN-LEGAL-ITEMS.md). Filling a fact changes
// the documents' content, so it also requires a new version in ./registry.ts.
export type LegalFacts = {
  /** Name or business name and address of the data controller / service owner. */
  controller: { name: string; address: string } | null;
  /** Channel to exercise ARCO rights, revoke consent or limit use (e.g. an email). */
  privacyContact: string | null;
  /** Channel for questions about the terms. */
  termsContact: string | null;
  /** Retention periods approved by legal/accounting review. */
  retentionStatement: string | null;
  /** Approved disclosure of optional providers and infrastructure location/transfers. */
  providerDisclosure: string | null;
  /** Governing law and competent courts for the terms. */
  governingLawAndJurisdiction: string | null;
};

export const legalFacts: LegalFacts = {
  controller: null,
  privacyContact: null,
  termsContact: null,
  retentionStatement: null,
  providerDisclosure: null,
  governingLawAndJurisdiction: null,
};

export type LegalFactKey = keyof LegalFacts;

/** User-facing description of what is still pending for each fact. */
export const legalFactTopics: Record<LegalFactKey, string> = {
  controller: "Identidad y domicilio del responsable",
  privacyContact:
    "Medio para ejercer derechos ARCO y revocar el consentimiento",
  termsContact: "Medio de contacto sobre los términos",
  retentionStatement: "Plazos de conservación aprobados",
  providerDisclosure:
    "Identificación de proveedores opcionales y ubicación de la infraestructura",
  governingLawAndJurisdiction: "Legislación aplicable y jurisdicción",
};
