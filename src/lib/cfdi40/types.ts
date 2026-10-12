// Fase 5C.4: internal CFDI 4.0 model, separate from Prisma records.
//
//   ORBIT invoice (OrbitInvoiceForCfdi, plain strings)
//     → mapper     → Cfdi40DraftInput   (CFDI vocabulary, unvalidated)
//     → normalizer → Cfdi40Document     (computed amounts, canonical strings)
//     → validator  → issues             (catalogs, combinations, limits, facets)
//     → serializer → UnsignedCfdi40Xml  (deterministic bytes, no NoCertificado/Certificado/Sello)
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
 * Fiscal content only: no NoCertificado, Certificado or Sello. Input of the future sealing
 * step; never sendable to a PAC (only SealedCfdi40Xml may be, after XSD validation).
 */
export type UnsignedCfdi40Xml = {
  readonly stage: "UNSIGNED";
  readonly xml: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
};
/**
 * Future (sealing block): NoCertificado and Certificado taken server-side from the active
 * VALID CSD. The cadena original is generated from the XML with these attributes and
 * without Sello.
 */
export type Cfdi40CertificateBinding = {
  readonly noCertificado: string;
  readonly certificadoBase64: string;
};
/** Type-only brand: no value exists, so no object literal can satisfy SealedCfdi40Xml. */
declare const sealedBrand: unique symbol;
/**
 * Future (sealing block), produced only after the seal is verified locally. No function in
 * this phase returns it. Besides this compile-time brand, ./sealed.ts accepts at runtime
 * only objects registered by the sealing service, whatever their shape.
 */
export type SealedCfdi40Xml = {
  readonly [sealedBrand]: true;
  readonly stage: "SEALED";
  readonly xml: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly certificate: Cfdi40CertificateBinding;
};
