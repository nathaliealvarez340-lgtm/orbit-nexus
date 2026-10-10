// Fase 5C.2 §5: versioned legal documents the frontend renders as data.
export type LegalDocumentKind = "TERMS" | "PRIVACY_NOTICE";
/** DRAFT documents are informative only: they cannot be accepted. */
export type LegalDocumentStatus = "DRAFT" | "PUBLISHED";

export type LegalSection = {
  id: string;
  title: string;
  paragraphs: string[];
  items?: string[];
};

export type LegalDocument = {
  kind: LegalDocumentKind;
  slug: "terminos" | "aviso-de-privacidad";
  title: string;
  locale: "es-MX";
  version: string;
  status: LegalDocumentStatus;
  /** YYYY-MM-DD; null while the document is a draft. */
  effectiveDate: string | null;
  /** SHA-256 of the exact content of this version; an acceptance must echo it. */
  contentHash: string;
  /** Topics the operator still has to define; empty once PUBLISHED. */
  pendingTopics: string[];
  sections: LegalSection[];
};

export type LegalDocumentSummary = Omit<LegalDocument, "sections">;

export type LegalAcceptanceRequest = {
  document: LegalDocumentKind;
  version: string;
  contentHash: string;
};

export type LegalAcceptanceState = {
  document: LegalDocumentKind;
  version: string;
  status: LegalDocumentStatus;
  contentHash: string;
  /** Only the current PUBLISHED version can be accepted. */
  acceptable: boolean;
  accepted: boolean;
  acceptedAt: string | null;
};
