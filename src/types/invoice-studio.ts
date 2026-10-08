// Fase 5 shared contract (docs/tasks/FASE5-CONTRACT.md). Not server-only: types only.
// Decimal values travel as strings and are converted/validated server-side with Decimal.
import type { PacEnvironment } from "./stamping";

export type InvoiceDocumentType = "I" | "E" | "T";
export type InvoicePaymentMethod = "PUE" | "PPD";
export type InvoiceVatFactor = "TASA" | "EXENTO";
export type InvoiceStatus =
  "DRAFT" | "READY" | "ISSUED" | "CANCELLED" | "ERROR";

// §12
export type CatalogOption = {
  code: string;
  label: string;
  active: boolean;
};

export type InvoiceFiscalCatalogs = {
  documentTypes: CatalogOption[];
  paymentMethods: CatalogOption[];
  paymentForms: CatalogOption[];
  cfdiUses: CatalogOption[];
  fiscalRegimes: CatalogOption[];
  currencies: CatalogOption[];
  taxObjects: CatalogOption[];
  exportCodes: CatalogOption[];
};

// §9
export type InvoiceStudioClient = {
  id: string;
  legalName: string;
  rfc: string;
  fiscalRegime: string;
  postalCode: string;
  cfdiUse?: string;
  defaultPaymentForm?: string;
  email?: string;
  personType?: string;
  foreignTaxId?: string;
  country?: string;
};

// §11
export type SavedInvoiceConcept = {
  id: string;
  name: string;
  description: string;
  productCode: string;
  unitCode: string;
  defaultQuantity?: string;
  unitPrice?: string;

  taxObject: string;

  vatFactor: InvoiceVatFactor;
  vatRate?: string;

  withholdingVatRate?: string;
  withholdingIsrRate?: string;

  active: boolean;
};

// §8
export type InvoiceStudioContext = {
  issuer: {
    organizationId: string;
    legalName: string;
    rfc: string;
    fiscalRegime: string;
    postalCode: string;
    email: string;
    profileComplete: boolean;
  };

  settings: {
    prefix: string;
    nextNumberPreview?: number;
    currencyDefault: string;
    paymentMethodDefault?: InvoicePaymentMethod;
    paymentFormDefault?: string;
    template?: string;
    color?: string;
    logoAvailable: boolean;
  };

  clients: InvoiceStudioClient[];

  savedConcepts: SavedInvoiceConcept[];

  catalogs: InvoiceFiscalCatalogs;
};

// §15
export type InvoiceDraftConcept = {
  savedConceptId?: string;

  description: string;
  productCode: string;
  unitCode: string;

  quantity: string;
  unitPrice: string;

  discount?: string;

  taxObject: string;

  vatFactor: InvoiceVatFactor;
  vatRate?: string;

  withholdingVatRate?: string;
  withholdingIsrRate?: string;
};

// §14
export type CreateInvoiceDraftRequest = {
  clientId: string;

  invoiceDate: string;

  documentType: InvoiceDocumentType;

  currency: string;
  exchangeRate?: string;

  cfdiUse: string;

  paymentMethod?: InvoicePaymentMethod;
  paymentForm?: string;

  exportCode: string;

  concepts: InvoiceDraftConcept[];
};

// §21-22: PATCH /api/outgoing-invoices/[id]
export type UpdateInvoiceDraftRequest = CreateInvoiceDraftRequest & {
  /** updatedAt received from the server; a mismatch returns 409 DRAFT_CONFLICT. */
  expectedUpdatedAt: string;
};

// §16
export type InvoiceTotals = {
  subtotal: string;
  discount: string;

  transferredTaxes: string;
  withheldTaxes: string;

  total: string;

  lines: {
    subtotal: string;
    discount: string;
    transferredTaxes: string;
    withheldTaxes: string;
    total: string;
  }[];
};

// §18
export type InvoiceValidationSection =
  "issuer" | "receiver" | "document" | "payment" | "concepts" | "totals";

export type InvoiceValidationIssue = {
  code: string;

  severity: "ERROR" | "WARNING";

  section: InvoiceValidationSection;

  field?: string;

  conceptIndex?: number;

  message: string;
};

// §19
export type InvoiceValidationSectionStatus = "OK" | "WARNING" | "ERROR";

export type InvoiceValidationResult = {
  valid: boolean;

  canMarkReady: boolean;

  sections: {
    issuer: InvoiceValidationSectionStatus;
    receiver: InvoiceValidationSectionStatus;
    document: InvoiceValidationSectionStatus;
    payment: InvoiceValidationSectionStatus;
    concepts: InvoiceValidationSectionStatus;
    totals: InvoiceValidationSectionStatus;
  };

  issues: InvoiceValidationIssue[];
};

// §20: also returned by PATCH /api/outgoing-invoices/[id]
export type CreateInvoiceDraftResponse = {
  id: string;
  folio: string | null;

  status: "DRAFT" | "READY";

  totals: InvoiceTotals;

  validation: InvoiceValidationResult;

  updatedAt: string;
};

// The following shapes are not spelled out in the contract; they describe the
// responses of routes the contract defines (§13, §23, §24, §26, §27).

/** §24: POST /api/outgoing-invoices/validate. totals is null when the payload is not structurally valid. */
export type ValidateInvoiceDraftResponse = {
  totals: InvoiceTotals | null;
  validation: InvoiceValidationResult;
};

/** §23: POST /api/outgoing-invoices/[id]/ready (422 returns { error, code, validation }). */
export type MarkInvoiceReadyResponse = CreateInvoiceDraftResponse;

/** §13: GET /api/fiscal-catalogs/[catalog]. complete=false while the source is a curated subset. */
export type FiscalCatalogSearchResponse = {
  catalog: string;
  source: "CURATED_SUBSET" | "SAT_OFFICIAL";
  complete: boolean;
  results: CatalogOption[];
};

/** §27: POST /api/invoice-concepts and PATCH /api/invoice-concepts/[id]. */
export type SaveInvoiceConceptRequest = Omit<
  SavedInvoiceConcept,
  "id" | "active"
> & {
  active?: boolean;
};

/** Snapshot of issuer/receiver captured when the draft was last saved. */
export type InvoicePartySnapshot = {
  rfc: string;
  legalName: string;
  personType: string;
  fiscalRegime: string;
  postalCode: string;
  email: string;
  country: string;
  cfdiUse?: string;
  foreignTaxId?: string;
  street?: string;
  exteriorNumber?: string;
  interiorNumber?: string;
  colony?: string;
  locality?: string;
  municipality?: string;
  state?: string;
};

/**
 * Fase 5C: why fiscal edits are blocked. STAMP_IN_PROGRESS covers an active attempt,
 * RECONCILIATION_REQUIRED an UNKNOWN attempt, ISSUED a stamped (immutable) invoice.
 */
export type InvoiceEditLock = {
  locked: boolean;
  reason: "STAMP_IN_PROGRESS" | "RECONCILIATION_REQUIRED" | "ISSUED" | null;
};

/** §26: GET /api/outgoing-invoices/[id] */
export type InvoiceDraftDetail = {
  id: string;
  folio: string | null;
  status: InvoiceStatus;
  /** Null until a real PAC stamps the invoice (Fase 5C). */
  uuid: string | null;
  clientId: string | null;
  invoiceDate: string | null;
  documentType: string;
  currency: string;
  exchangeRate?: string;
  cfdiUse: string | null;
  paymentMethod?: InvoicePaymentMethod;
  paymentForm?: string;
  exportCode: string;
  issuerSnapshot: InvoicePartySnapshot | null;
  receiverSnapshot: InvoicePartySnapshot | null;
  concepts: (InvoiceDraftConcept & { position: number })[];
  totals: InvoiceTotals;
  validation: InvoiceValidationResult;
  readyAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Legacy top-level amounts kept for existing consumers; same values as totals. */
  subtotal: string;
  tax: string;
  total: string;

  // Fase 5C (docs/tasks/FASE5C-CONTRACT.md). Optional until the backend populates
  // them (Fase 5C-A); consumers must treat an absent field as "not provided yet".
  /** Draft version; a stamping attempt is bound to the exact version it signed. */
  version?: number;
  /** CFDI emission date-time (Comprobante Fecha). */
  issuedAt?: string | null;
  /** FechaTimbrado from the Timbre Fiscal Digital; never used as issuedAt. */
  stampedAt?: string | null;
  fiscalEnvironment?: PacEnvironment | null;
  /** Private downloads through the existing GET /api/documents/[id]. */
  xmlDocumentId?: string | null;
  pdfDocumentId?: string | null;
  editLock?: InvoiceEditLock;
};
