// Temporary, type-only frontend bridge copied verbatim from FASE5-CONTRACT.md.
// Claude owns src/types/invoice-studio.ts. Remove this bridge when that file is integrated.
// No runtime backend implementation or alternate fiscal contract lives here.
declare module "@/types/invoice-studio" {
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
      paymentMethodDefault?: "PUE" | "PPD";
      paymentFormDefault?: string;
      template?: string;
      color?: string;
      logoAvailable: boolean;
    };

    clients: InvoiceStudioClient[];

    savedConcepts: SavedInvoiceConcept[];

    catalogs: InvoiceFiscalCatalogs;
  };

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

  export type SavedInvoiceConcept = {
    id: string;
    name: string;
    description: string;
    productCode: string;
    unitCode: string;
    defaultQuantity?: string;
    unitPrice?: string;

    taxObject: string;

    vatFactor: "TASA" | "EXENTO";
    vatRate?: string;

    withholdingVatRate?: string;
    withholdingIsrRate?: string;

    active: boolean;
  };

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

  export type CreateInvoiceDraftRequest = {
    clientId: string;

    invoiceDate: string;

    documentType: "I" | "E" | "T";

    currency: string;
    exchangeRate?: string;

    cfdiUse: string;

    paymentMethod?: "PUE" | "PPD";
    paymentForm?: string;

    exportCode: string;

    concepts: InvoiceDraftConcept[];
  };

  export type InvoiceDraftConcept = {
    savedConceptId?: string;

    description: string;
    productCode: string;
    unitCode: string;

    quantity: string;
    unitPrice: string;

    discount?: string;

    taxObject: string;

    vatFactor: "TASA" | "EXENTO";
    vatRate?: string;

    withholdingVatRate?: string;
    withholdingIsrRate?: string;
  };

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

  export type InvoiceValidationIssue = {
    code: string;

    severity: "ERROR" | "WARNING";

    section:
      "issuer" | "receiver" | "document" | "payment" | "concepts" | "totals";

    field?: string;

    conceptIndex?: number;

    message: string;
  };

  export type InvoiceValidationResult = {
    valid: boolean;

    canMarkReady: boolean;

    sections: {
      issuer: "OK" | "WARNING" | "ERROR";
      receiver: "OK" | "WARNING" | "ERROR";
      document: "OK" | "WARNING" | "ERROR";
      payment: "OK" | "WARNING" | "ERROR";
      concepts: "OK" | "WARNING" | "ERROR";
      totals: "OK" | "WARNING" | "ERROR";
    };

    issues: InvoiceValidationIssue[];
  };

  export type CreateInvoiceDraftResponse = {
    id: string;
    folio: string | null;

    status: "DRAFT" | "READY";

    totals: InvoiceTotals;

    validation: InvoiceValidationResult;

    updatedAt: string;
  };
}
