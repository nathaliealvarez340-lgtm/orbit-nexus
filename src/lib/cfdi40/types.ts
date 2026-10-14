// Fase 5C.4: internal CFDI 4.0 model, separate from Prisma records.
//
//   ORBIT invoice (OrbitInvoiceForCfdi, plain strings)
//     → mapper     → Cfdi40DraftInput   (CFDI vocabulary, unvalidated)
//     → normalizer → Cfdi40Document     (computed amounts, canonical strings)
//     → validator  → issues             (catalogs, combinations, limits, facets)
//     → serializer → UnsignedCfdi40Xml  (deterministic bytes, no NoCertificado/Certificado/Sello)
//     → pre-seal   → PreSealCfdi40Xml   (+ NoCertificado, Certificado of the VALID CSD; Fase 5C.5)
//     → official SAT XSLT → Cfdi40OriginalString (exact output)
//     → CSD signature, verified → SealedCfdi40Xml (+ Sello; Fase 5C.6)
//     → official SAT XSD (exact bytes) → XsdValidatedCfdi40 (Fase 5C.7) → future PAC
//
// Monetary values are decimal strings everywhere; they are parsed only by ./decimal.ts.

/** Snapshot of the ORBIT outgoing invoice needed for its CFDI; no Prisma types. */
export type OrbitInvoiceForCfdi = {
  id: string;
  organizationId: string;
  status: string;
  version: number;
  folio: string | null;
  /** Date chosen in Invoice Studio (YYYY-MM-DD); only cross-checked, never the CFDI Fecha. */
  invoiceDate: string | null;
  documentType: string;
  currency: string;
  exchangeRate: string | null;
  cfdiUse: string | null;
  paymentMethod: string | null;
  paymentForm: string | null;
  exportCode: string;
  /** Fiscal snapshots stored with the draft (contract §11); parsed strictly by the mapper. */
  issuerSnapshot: unknown;
  receiverSnapshot: unknown;
  totals: OrbitTotals;
  concepts: readonly OrbitConceptForCfdi[];
  /**
   * True when the invoice was never saved by the Fase 5 fiscal rules (its stored
   * validation is null): taxObject, vatFactor, vatRate, exportCode and, before Fase 3,
   * productCode/unitCode may be migration defaults, not choices of the user.
   */
  legacyRecord: boolean;
};
export type OrbitTotals = {
  subtotal: string;
  discount: string;
  transferred: string;
  withheldVat: string;
  withheldIsr: string;
  total: string;
};
export type OrbitConceptForCfdi = {
  position: number;
  description: string;
  productCode: string;
  unitCode: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  taxObject: string;
  /** ORBIT stores "TASA" | "EXENTO". */
  vatFactor: string;
  vatRate: string | null;
  /** Effective VAT rate ORBIT applied when saving; cross-checked. */
  appliedVatRate: string;
  withholdingVatRate: string | null;
  withholdingIsrRate: string | null;
  totals: {
    amount: string;
    discount: string;
    transferred: string;
    withheldVat: string;
    withheldIsr: string;
  };
};

// ---------------------------------------------------------------------------------------
// Mapper output: CFDI vocabulary, still unvalidated.

export type Cfdi40PartyInput = {
  rfc: string | null;
  name: string | null;
  personType: string | null;
  fiscalRegime: string | null;
  postalCode: string | null;
};
export type Cfdi40ReceiverInput = Cfdi40PartyInput & {
  cfdiUse: string | null;
  country: string | null;
  foreignTaxId: string | null;
};
export type Cfdi40VatInput =
  | { factor: "Tasa"; rate: string | null }
  | { factor: "Exento"; rate: string | null };
export type Cfdi40ConceptInput = {
  index: number;
  productCode: string;
  unitCode: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  taxObject: string;
  vat: Cfdi40VatInput;
  withholdingVatRate: string | null;
  withholdingIsrRate: string | null;
  orbit: OrbitConceptForCfdi["totals"] & { appliedVatRate: string };
};
/** CfdiRelacionados. Not produced by ORBIT yet; any entry is rejected in v1. */
export type Cfdi40RelatedDocument = {
  relationType: string;
  uuids: readonly string[];
};
export type Cfdi40DraftInput = {
  invoiceId: string;
  status: string;
  documentType: string;
  serie: string | null;
  folio: string | null;
  draftDate: string | null;
  currency: string;
  exchangeRate: string | null;
  paymentForm: string | null;
  paymentMethod: string | null;
  exportCode: string;
  legacyRecord: boolean;
  issuer: Cfdi40PartyInput;
  receiver: Cfdi40ReceiverInput;
  concepts: readonly Cfdi40ConceptInput[];
  relatedDocuments: readonly Cfdi40RelatedDocument[];
  orbitTotals: OrbitTotals;
};

// ---------------------------------------------------------------------------------------
// Normalized, computed document: every string is exactly what the XML will contain.

export type Cfdi40Issuer = { rfc: string; name: string; fiscalRegime: string };
export type Cfdi40Receiver = {
  rfc: string;
  name: string;
  fiscalAddressPostalCode: string;
  fiscalRegime: string;
  cfdiUse: string;
};
export type Cfdi40Transfer =
  | { base: string; tax: string; factor: "Tasa"; rate: string; amount: string }
  | { base: string; tax: string; factor: "Exento"; rate: null; amount: null };
export type Cfdi40Withholding = {
  base: string;
  tax: string;
  factor: "Tasa";
  rate: string;
  amount: string;
};
export type Cfdi40Concept = {
  productCode: string;
  quantity: string;
  unitCode: string;
  description: string;
  unitPrice: string;
  amount: string;
  /** Omitted when the concept has no discount. */
  discount: string | null;
  taxObject: string;
  /** Present only with ObjetoImp 02. */
  taxes: {
    transfers: readonly Cfdi40Transfer[];
    withholdings: readonly Cfdi40Withholding[];
  } | null;
};
export type Cfdi40TransferSummary = Cfdi40Transfer;
export type Cfdi40WithholdingSummary = { tax: string; amount: string };
export type Cfdi40Taxes = {
  totalWithheld: string | null;
  totalTransferred: string | null;
  withholdings: readonly Cfdi40WithholdingSummary[];
  transfers: readonly Cfdi40TransferSummary[];
};
export type Cfdi40Document = {
  version: "4.0";
  serie: string | null;
  folio: string | null;
  /** t_FechaH, local time of LugarExpedicion, generated from a server instant. */
  issuedAt: string;
  paymentForm: string;
  paymentMethod: string;
  subtotal: string;
  discount: string | null;
  currency: string;
  exchangeRate: string | null;
  total: string;
  documentType: "I";
  exportCode: string;
  placeOfIssue: string;
  issuer: Cfdi40Issuer;
  receiver: Cfdi40Receiver;
  concepts: readonly Cfdi40Concept[];
  taxes: Cfdi40Taxes | null;
};

// ---------------------------------------------------------------------------------------
// Representations. cfdv40.xsd declares Sello, NoCertificado and Certificado as required,
// so an XML without them can never be XSD-valid, and no placeholder is ever written.

/**
 * Fiscal content only: no NoCertificado, Certificado or Sello. Never sendable to a PAC (only
 * SealedCfdi40Xml may be, after XSD validation).
 */
export type UnsignedCfdi40Xml = {
  readonly stage: "UNSIGNED";
  readonly xml: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
};
/**
 * NoCertificado and Certificado, taken server-side from the public certificate of the active
 * VALID CSD. The cadena original is generated from the XML with these attributes and
 * without Sello.
 */
export type Cfdi40CertificateBinding = {
  readonly noCertificado: string;
  readonly certificadoBase64: string;
};
/** Type-only brand: only serializePreSealCfdi40 produces this representation. */
declare const preSealBrand: unique symbol;
/**
 * Fase 5C.5: the unsigned content plus NoCertificado and Certificado of the active VALID
 * CSD, in their cfdv40.xsd positions, and no Sello. Input of the cadena original; never
 * sendable to a PAC and never XSD-valid (Sello is required).
 */
export type PreSealCfdi40Xml = {
  readonly [preSealBrand]: true;
  readonly stage: "PRE_SEAL";
  readonly xml: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly certificate: Cfdi40CertificateBinding;
};
/** Type-only brand: only generateCfdi40OriginalString produces this representation. */
declare const originalStringBrand: unique symbol;
/**
 * Fase 5C.5: the output of the official SAT XSLT, exactly as produced (no trim, no
 * normalization). `bytes` (UTF-8) is what the CSD signs (Fase 5C.6).
 */
export type Cfdi40OriginalString = {
  readonly [originalStringBrand]: true;
  readonly stage: "ORIGINAL_STRING";
  readonly value: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
  /** SHA-256 of the pre-seal XML it was generated from. */
  readonly preSealSha256: string;
  readonly noCertificado: string;
  readonly xslt: { readonly rootSha256: string; readonly engine: string };
};

/** Type-only brand: no value exists, so no object literal can satisfy SealedCfdi40Xml. */
declare const sealedBrand: unique symbol;
/**
 * Fase 5C.6: the pre-seal XML plus a Sello verified locally (FASE5C §16.4). Produced only by
 * createSealedCfdi40 (./sealed.ts), which registers it; besides this compile-time brand,
 * ./sealed.ts accepts at runtime only registered, unchanged values, whatever their shape.
 * The only representation the XSD validator accepts (Fase 5C.7); a PAC adapter needs more:
 * XsdValidatedCfdi40.
 */
export type SealedCfdi40Xml = {
  readonly [sealedBrand]: true;
  readonly stage: "SEALED";
  readonly xml: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly certificate: Cfdi40CertificateBinding;
  /** SHA-256 of the pre-seal XML it was sealed from. */
  readonly preSealSha256: string;
  /** SHA-256 of the UTF-8 cadena original that the Sello signs. */
  readonly originalStringSha256: string;
};

/** Type-only brand: no value exists, so no object literal can satisfy XsdValidatedCfdi40. */
declare const xsdValidatedBrand: unique symbol;
/**
 * Fase 5C.7: "these exact sealed bytes were validated against this exact official XSD set".
 * Produced only by validateSealedCfdi40Xsd (./schema.ts), which registers it; a value whose
 * bytes change afterwards stops being valid. The only input a PAC adapter may receive.
 */
export type XsdValidatedCfdi40 = {
  readonly [xsdValidatedBrand]: true;
  readonly stage: "XSD_VALIDATED";
  readonly xml: string;
  readonly bytes: Uint8Array;
  /** SHA-256 of the XML bytes, equal to the SealedCfdi40Xml it was validated from. */
  readonly sha256: string;
  readonly certificate: Cfdi40CertificateBinding;
  readonly preSealSha256: string;
  readonly originalStringSha256: string;
  readonly xsd: {
    /** SHA-256 of the official XSD set (cfdv40.xsd and its imports) used. */
    readonly bundleSha256: string;
    /** Validator package and version. */
    readonly engine: string;
  };
};
