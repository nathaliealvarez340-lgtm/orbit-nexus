// Central CFDI 4.0 fiscal rules for outgoing-invoice drafts (contract §17-19).
// Pure and browser-safe: the server resolves tenant data and is the only authority;
// Invoice Studio consumes the resulting InvoiceValidationResult.
import { Prisma } from "@/generated/prisma/browser";
import type {
  InvoiceValidationIssue,
  InvoiceValidationResult,
  InvoiceValidationSection,
} from "@/types/invoice-studio";
import type { InvoiceDraftInput } from "./phase3-validation";
import type { CalculatedInvoiceTotals } from "./invoice-totals";
import {
  canonicalRate,
  catalogOption,
  cfdiUseCatalog,
  cfdiUseRules,
  exportCodeCatalog,
  genericProductCode,
  genericRfc,
  maxWithholdingIsrRate,
  maxWithholdingVatRate,
  regimePersonTypes,
  taxObjectCatalog,
  vatRates,
} from "./sat-catalogs";

export type RuleParty = {
  rfc: string;
  legalName: string;
  personType: string;
  fiscalRegime: string;
  postalCode: string;
  country?: string;
  foreignTaxId?: string;
};
export type InvoiceRuleInput = {
  issuer: (RuleParty & { profileComplete: boolean }) | null;
  /** available=false when the client was archived after the draft was saved. */
  receiver: (RuleParty & { available?: boolean }) | null;
  draft: InvoiceDraftInput;
  totals: CalculatedInvoiceTotals;
  /** YYYY-MM-DD in America/Mexico_City; enables stamping-window warnings. */
  today?: string;
  /** Large-catalog lookups. The server always provides them; unknown codes block READY. */
  isKnownProductCode?: (code: string) => boolean;
  isKnownUnitCode?: (code: string) => boolean;
  inactiveSavedConceptIds?: ReadonlySet<string>;
};

const rfcPattern = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;
const sections: InvoiceValidationSection[] = [
  "issuer",
  "receiver",
  "document",
  "payment",
  "concepts",
  "totals",
];
const decimal = (v: string) => new Prisma.Decimal(v);
const personLabel = (t: string) =>
  t === "INDIVIDUAL" ? "persona física" : "persona moral";

export function buildValidationResult(
  issues: InvoiceValidationIssue[],
  documentType?: string,
): InvoiceValidationResult {
  const status = (section: InvoiceValidationSection) =>
    issues.some((i) => i.section === section && i.severity === "ERROR")
      ? "ERROR"
      : issues.some((i) => i.section === section)
        ? "WARNING"
        : "OK";
  const valid = !issues.some((i) => i.severity === "ERROR");
  return {
    valid,
    canMarkReady: valid && documentType === "I",
    sections: Object.fromEntries(
      sections.map((s) => [s, status(s)]),
    ) as InvoiceValidationResult["sections"],
    issues,
  };
}

const fieldSections: Record<string, InvoiceValidationSection> = {
  clientId: "receiver",
  cfdiUse: "receiver",
  paymentMethod: "payment",
  paymentForm: "payment",
  concepts: "concepts",
};
// Structural (zod) failures expressed in the same contract as fiscal issues.
export function issuesFromStructure(
  zodIssues: readonly { path: readonly PropertyKey[]; message: string }[],
): InvoiceValidationIssue[] {
  return zodIssues.map((issue) => {
    const [head, index, field] = issue.path;
    const inConcept = head === "concepts" && typeof index === "number";
    return {
      code: "FIELD_INVALID",
      severity: "ERROR",
      section: fieldSections[String(head)] ?? "document",
      ...(inConcept
        ? { conceptIndex: index, ...(field ? { field: String(field) } : {}) }
        : head !== undefined
          ? { field: String(head) }
          : {}),
      message: issue.message,
    };
  });
}

export function validateInvoice(input: InvoiceRuleInput) {
  return buildValidationResult(
    validateInvoiceRules(input),
    input.draft.documentType,
  );
}

export function validateInvoiceRules(
  input: InvoiceRuleInput,
): InvoiceValidationIssue[] {
  const { issuer, receiver, draft, totals } = input;
  const issues: InvoiceValidationIssue[] = [];
  const error = (
    section: InvoiceValidationSection,
    code: string,
    message: string,
    extra: { field?: string; conceptIndex?: number } = {},
  ) => issues.push({ code, severity: "ERROR", section, ...extra, message });
  const warn = (
    section: InvoiceValidationSection,
    code: string,
    message: string,
    extra: { field?: string; conceptIndex?: number } = {},
  ) => issues.push({ code, severity: "WARNING", section, ...extra, message });

  // Issuer (FiscalProfile of the active Organization).
  if (!issuer)
    error(
      "issuer",
      "ISSUER_PROFILE_MISSING",
      "Configura el perfil fiscal del emisor.",
    );
  else {
    if (!issuer.profileComplete)
      error(
        "issuer",
        "ISSUER_PROFILE_INCOMPLETE",
        "Completa la dirección fiscal y adjunta la Constancia de Situación Fiscal del emisor.",
      );
    if (!issuer.legalName.trim())
      error(
        "issuer",
        "ISSUER_NAME_REQUIRED",
        "El emisor necesita una razón social.",
        { field: "legalName" },
      );
    if (!rfcPattern.test(issuer.rfc))
      error(
        "issuer",
        "ISSUER_RFC_INVALID",
        "El RFC del emisor no tiene un formato válido.",
        { field: "rfc" },
      );
    else if (
      issuer.rfc.length !== (issuer.personType === "INDIVIDUAL" ? 13 : 12)
    )
      error(
        "issuer",
        "ISSUER_RFC_PERSON_TYPE_MISMATCH",
        `El RFC del emisor no corresponde a una ${personLabel(issuer.personType)}.`,
        { field: "rfc" },
      );
    const types = regimePersonTypes.get(issuer.fiscalRegime);
    if (!types)
      error(
        "issuer",
        "ISSUER_REGIME_INVALID",
        "El régimen fiscal del emisor no existe en el catálogo del SAT.",
        { field: "fiscalRegime" },
      );
    else if (!(types as string[]).includes(issuer.personType))
      error(
        "issuer",
        "ISSUER_REGIME_PERSON_TYPE_MISMATCH",
        `El régimen fiscal del emisor no aplica a una ${personLabel(issuer.personType)}.`,
        { field: "fiscalRegime" },
      );
    if (!/^\d{5}$/.test(issuer.postalCode))
      error(
        "issuer",
        "ISSUER_POSTAL_CODE_INVALID",
        "El emisor necesita un código postal fiscal de 5 dígitos (lugar de expedición).",
        { field: "postalCode" },
      );
  }

  // Receiver (resolved from the tenant's Client, never free text).
  const generic =
    receiver?.rfc === genericRfc.publicGeneral ||
    receiver?.rfc === genericRfc.foreign;
  if (!receiver)
    error("receiver", "RECEIVER_REQUIRED", "Selecciona un cliente receptor.", {
      field: "clientId",
    });
  else {
    if (receiver.available === false)
      error(
        "receiver",
        "RECEIVER_NOT_AVAILABLE",
        "El cliente fue archivado; selecciona un cliente activo.",
        { field: "clientId" },
      );
    if (!receiver.legalName.trim())
      error(
        "receiver",
        "RECEIVER_NAME_REQUIRED",
        "El receptor necesita un nombre o razón social.",
        { field: "legalName" },
      );
    if (!rfcPattern.test(receiver.rfc))
      error(
        "receiver",
        "RECEIVER_RFC_INVALID",
        "El RFC del receptor no tiene un formato válido.",
        { field: "rfc" },
      );
    else if (
      !generic &&
      receiver.rfc.length !== (receiver.personType === "INDIVIDUAL" ? 13 : 12)
    )
      error(
        "receiver",
        "RECEIVER_RFC_PERSON_TYPE_MISMATCH",
        `El RFC del receptor no corresponde a una ${personLabel(receiver.personType)}.`,
        { field: "rfc" },
      );
    const types = regimePersonTypes.get(receiver.fiscalRegime);
    if (!types)
      error(
        "receiver",
        "RECEIVER_REGIME_INVALID",
        "El régimen fiscal del receptor no existe en el catálogo del SAT.",
        { field: "fiscalRegime" },
      );
    else if (!generic && !(types as string[]).includes(receiver.personType))
      error(
        "receiver",
        "RECEIVER_REGIME_PERSON_TYPE_MISMATCH",
        `El régimen fiscal del receptor no aplica a una ${personLabel(receiver.personType)}.`,
        { field: "fiscalRegime" },
      );
    if (!/^\d{5}$/.test(receiver.postalCode))
      error(
        "receiver",
        "RECEIVER_POSTAL_CODE_REQUIRED",
        "El receptor necesita un código postal fiscal.",
        { field: "postalCode" },
      );
    if (issuer && issuer.rfc === receiver.rfc)
      warn(
        "receiver",
        "RECEIVER_SAME_AS_ISSUER",
        "El receptor tiene el mismo RFC que el emisor; confirma que sea correcto.",
        { field: "rfc" },
      );
    if (generic) {
      const label =
        receiver.rfc === genericRfc.foreign ? "extranjero" : "nacional";
      if (receiver.fiscalRegime !== "616")
        error(
          "receiver",
          "RECEIVER_GENERIC_REGIME",
          `Con el RFC genérico ${label} el régimen del receptor debe ser 616 · Sin obligaciones fiscales.`,
          { field: "fiscalRegime" },
        );
      if (issuer && receiver.postalCode !== issuer.postalCode)
        error(
          "receiver",
          "RECEIVER_GENERIC_POSTAL_CODE",
          `Con el RFC genérico ${label} el código postal del receptor debe ser el del lugar de expedición (${issuer.postalCode}).`,
          { field: "postalCode" },
        );
      if (draft.cfdiUse !== "S01")
        error(
          "receiver",
          "CFDI_USE_GENERIC_RECEIVER",
          `Con el RFC genérico ${label} el Uso CFDI debe ser S01 · Sin efectos fiscales.`,
          { field: "cfdiUse" },
        );
    }
    if (
      receiver.rfc === genericRfc.publicGeneral &&
      receiver.legalName
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toUpperCase() === "PUBLICO EN GENERAL"
    )
      error(
        "receiver",
        "GLOBAL_INVOICE_NOT_SUPPORTED",
        "Las facturas globales a público en general no están soportadas en este sprint.",
        { field: "clientId" },
      );
    if (receiver.rfc === genericRfc.foreign) {
      if (!receiver.foreignTaxId?.trim())
        error(
          "receiver",
          "RECEIVER_FOREIGN_TAX_ID_REQUIRED",
          "Un receptor extranjero necesita su número de registro tributario.",
          { field: "foreignTaxId" },
        );
      if (!receiver.country || receiver.country === "MEX")
        error(
          "receiver",
          "RECEIVER_FOREIGN_RESIDENCE_INVALID",
          "Un receptor extranjero necesita su país de residencia fiscal (distinto de México).",
          { field: "country" },
        );
    }
    const use = cfdiUseRules.get(draft.cfdiUse);
    if (!catalogOption(cfdiUseCatalog, draft.cfdiUse)?.active)
      error(
        "receiver",
        "CFDI_USE_NOT_SUPPORTED",
        "Este Uso CFDI corresponde a complementos de pago o nómina, no soportados en este sprint.",
        { field: "cfdiUse" },
      );
    else if (use && !generic) {
      if (!(use.personTypes as string[]).includes(receiver.personType))
        error(
          "receiver",
          "CFDI_USE_PERSON_TYPE_MISMATCH",
          `El Uso CFDI ${draft.cfdiUse} no aplica a un receptor ${personLabel(receiver.personType)}.`,
          { field: "cfdiUse" },
        );
      else if (types && !use.receiverRegimes.includes(receiver.fiscalRegime))
        error(
          "receiver",
          "CFDI_USE_REGIME_MISMATCH",
          `El Uso CFDI ${draft.cfdiUse} no es compatible con el régimen fiscal ${receiver.fiscalRegime} del receptor.`,
          { field: "cfdiUse" },
        );
    }
  }

  // Document.
  if (draft.documentType === "E")
    error(
      "document",
      "DOCUMENT_TYPE_NOT_SUPPORTED",
      "Las facturas de Egreso requieren CFDI relacionados y no están soportadas en este sprint.",
      { field: "documentType" },
    );
  if (draft.documentType === "T")
    error(
      "document",
      "DOCUMENT_TYPE_NOT_SUPPORTED",
      "Los comprobantes de Traslado no están soportados en este sprint.",
      { field: "documentType" },
    );
  if (input.today) {
    const windowStart = new Date(input.today + "T00:00:00Z");
    windowStart.setUTCDate(windowStart.getUTCDate() - 3);
    if (draft.invoiceDate > input.today)
      warn(
        "document",
        "INVOICE_DATE_IN_FUTURE",
        "La fecha es posterior a hoy; no podrá timbrarse antes de esa fecha.",
        { field: "invoiceDate" },
      );
    else if (draft.invoiceDate < windowStart.toISOString().slice(0, 10))
      warn(
        "document",
        "INVOICE_DATE_OUTSIDE_STAMPING_WINDOW",
        "El SAT solo permite timbrar comprobantes con hasta 72 horas de antigüedad; actualiza la fecha antes de timbrar.",
        { field: "invoiceDate" },
      );
  }
  if (draft.currency === "MXN") {
    if (draft.exchangeRate && !decimal(draft.exchangeRate).equals(1))
      error(
        "document",
        "EXCHANGE_RATE_NOT_ALLOWED",
        "En pesos mexicanos el tipo de cambio debe omitirse o ser 1.",
        { field: "exchangeRate" },
      );
  } else if (!draft.exchangeRate)
    error(
      "document",
      "EXCHANGE_RATE_REQUIRED",
      `Indica el tipo de cambio de ${draft.currency} a pesos mexicanos.`,
      { field: "exchangeRate" },
    );
  else if (decimal(draft.exchangeRate).lessThanOrEqualTo(0))
    error(
      "document",
      "EXCHANGE_RATE_INVALID",
      "El tipo de cambio debe ser mayor que cero.",
      { field: "exchangeRate" },
    );
  if (!catalogOption(exportCodeCatalog, draft.exportCode)?.active)
    error(
      "document",
      "EXPORT_CODE_NOT_SUPPORTED",
      "La exportación definitiva A1 requiere complemento de comercio exterior, no soportado en este sprint.",
      { field: "exportCode" },
    );

  // Payment.
  if (draft.documentType === "T") {
    if (draft.paymentMethod || draft.paymentForm)
      error(
        "payment",
        "PAYMENT_NOT_ALLOWED_FOR_TRANSFER",
        "Un comprobante de Traslado no lleva método ni forma de pago.",
        { field: draft.paymentMethod ? "paymentMethod" : "paymentForm" },
      );
  } else {
    if (!draft.paymentMethod)
      error(
        "payment",
        "PAYMENT_METHOD_REQUIRED",
        "Selecciona el método de pago (PUE o PPD).",
        { field: "paymentMethod" },
      );
    if (!draft.paymentForm)
      error(
        "payment",
        "PAYMENT_FORM_REQUIRED",
        "Selecciona la forma de pago.",
        { field: "paymentForm" },
      );
    if (
      draft.paymentMethod === "PPD" &&
      draft.paymentForm &&
      draft.paymentForm !== "99"
    )
      error(
        "payment",
        "PAYMENT_PPD_REQUIRES_99",
        "Con método PPD la forma de pago debe ser 99 · Por definir.",
        { field: "paymentForm" },
      );
    if (draft.paymentMethod === "PUE" && draft.paymentForm === "99")
      error(
        "payment",
        "PAYMENT_PUE_FORM_UNDEFINED",
        "Con método PUE indica la forma en que se liquidó el pago; 99 · Por definir solo aplica a PPD.",
        { field: "paymentForm" },
      );
  }

  // Concepts.
  const receiverIsGeneric = !!receiver && generic,
    receiverIsIndividual = receiver?.personType === "INDIVIDUAL";
  draft.concepts.forEach((c, conceptIndex) => {
    const at = (field: string) => ({ field, conceptIndex });
    const line = totals.lines[conceptIndex];
    if (draft.documentType !== "T" && !/[1-9]/.test(c.unitPrice))
      error(
        "concepts",
        "CONCEPT_UNIT_PRICE_REQUIRED",
        "El precio unitario debe ser mayor que cero.",
        at("unitPrice"),
      );
    if (c.productCode === genericProductCode)
      warn(
        "concepts",
        "CONCEPT_PRODUCT_CODE_GENERIC",
        "01010101 · No existe en el catálogo es una clave genérica; usa una clave específica cuando sea posible.",
        at("productCode"),
      );
    // Until a complete, verified SAT source is loaded, a well-formed but unknown code
    // is never treated as fiscally valid: it blocks READY while the DRAFT can be saved.
    else if (
      input.isKnownProductCode &&
      !input.isKnownProductCode(c.productCode)
    )
      error(
        "concepts",
        "CONCEPT_PRODUCT_CODE_UNVERIFIED",
        `La clave de producto o servicio ${c.productCode} aún no pudo verificarse contra el catálogo disponible en ORBIT. Puedes guardar el borrador, pero no marcarlo como listo hasta usar una clave verificada.`,
        at("productCode"),
      );
    if (input.isKnownUnitCode && !input.isKnownUnitCode(c.unitCode))
      error(
        "concepts",
        "CONCEPT_UNIT_CODE_UNVERIFIED",
        `La clave de unidad ${c.unitCode} aún no pudo verificarse contra el catálogo disponible en ORBIT. Puedes guardar el borrador, pero no marcarlo como listo hasta usar una clave verificada.`,
        at("unitCode"),
      );
    if (line && line.discount.greaterThan(line.subtotal))
      error(
        "concepts",
        "CONCEPT_DISCOUNT_EXCEEDS_SUBTOTAL",
        "El descuento no puede ser mayor que el importe del concepto.",
        at("discount"),
      );
    if (
      c.savedConceptId &&
      input.inactiveSavedConceptIds?.has(c.savedConceptId)
    )
      warn(
        "concepts",
        "SAVED_CONCEPT_INACTIVE",
        "El concepto guardado de origen está desactivado; la línea conserva sus datos.",
        at("savedConceptId"),
      );
    if (!catalogOption(taxObjectCatalog, c.taxObject)?.active) {
      error(
        "concepts",
        "CONCEPT_TAX_OBJECT_NOT_SUPPORTED",
        `El objeto de impuesto ${c.taxObject} no está soportado en este sprint.`,
        at("taxObject"),
      );
      return;
    }
    const hasWithholding = !!(c.withholdingVatRate || c.withholdingIsrRate);
    if (c.taxObject !== "02") {
      if (c.vatRate || hasWithholding)
        error(
          "concepts",
          "CONCEPT_TAX_OBJECT_FORBIDS_TAXES",
          `Con objeto de impuesto ${c.taxObject} no se desglosan IVA ni retenciones.`,
          at(c.vatRate ? "vatRate" : "taxObject"),
        );
      if (c.taxObject === "03")
        warn(
          "concepts",
          "CONCEPT_TAX_OBJECT_NO_BREAKDOWN",
          "Objeto 03 indica que no hay obligación de desglosar impuestos; confirma que aplique a esta operación.",
          at("taxObject"),
        );
      return;
    }
    const vat = c.vatRate ? canonicalRate(c.vatRate) : undefined;
    if (c.vatFactor === "EXENTO") {
      if (c.vatRate)
        error(
          "concepts",
          "CONCEPT_VAT_RATE_NOT_ALLOWED_FOR_EXEMPT",
          "Un concepto exento de IVA no lleva tasa.",
          at("vatRate"),
        );
    } else if (!vat)
      error(
        "concepts",
        "CONCEPT_VAT_RATE_REQUIRED",
        "Indica la tasa de IVA o marca el concepto como exento.",
        at("vatRate"),
      );
    else if (!vatRates.includes(vat))
      error(
        "concepts",
        "CONCEPT_VAT_RATE_INVALID",
        "La tasa de IVA debe ser 16%, 8% o 0%.",
        at("vatRate"),
      );
    else if (vat === "0.08")
      warn(
        "concepts",
        "CONCEPT_VAT_BORDER_RATE",
        "IVA 8% solo aplica con el estímulo fiscal de región fronteriza; confirma que el emisor lo tenga.",
        at("vatRate"),
      );
    if (c.withholdingVatRate) {
      const rate = decimal(c.withholdingVatRate);
      if (rate.lessThanOrEqualTo(0) || rate.greaterThan(maxWithholdingVatRate))
        error(
          "concepts",
          "CONCEPT_WITHHOLDING_VAT_RATE_INVALID",
          "La retención de IVA debe ser mayor que 0% y hasta 16%.",
          at("withholdingVatRate"),
        );
      else if (
        c.vatFactor !== "TASA" ||
        !vat ||
        !vatRates.includes(vat) ||
        rate.greaterThan(vat)
      )
        error(
          "concepts",
          "CONCEPT_WITHHOLDING_VAT_EXCEEDS_VAT",
          "La retención de IVA no puede ser mayor que el IVA trasladado del concepto.",
          at("withholdingVatRate"),
        );
    }
    if (c.withholdingIsrRate) {
      const rate = decimal(c.withholdingIsrRate);
      if (rate.lessThanOrEqualTo(0) || rate.greaterThan(maxWithholdingIsrRate))
        error(
          "concepts",
          "CONCEPT_WITHHOLDING_ISR_RATE_INVALID",
          "La retención de ISR debe ser mayor que 0% y hasta 35%.",
          at("withholdingIsrRate"),
        );
    }
    if (hasWithholding && receiverIsGeneric)
      error(
        "concepts",
        "CONCEPT_WITHHOLDING_GENERIC_RECEIVER",
        "Un receptor con RFC genérico no puede efectuar retenciones.",
        at(c.withholdingVatRate ? "withholdingVatRate" : "withholdingIsrRate"),
      );
    else if (hasWithholding && receiverIsIndividual)
      warn(
        "concepts",
        "CONCEPT_WITHHOLDING_INDIVIDUAL_RECEIVER",
        "Las retenciones normalmente las efectúa una persona moral; confirma que el receptor deba retener.",
        at(c.withholdingVatRate ? "withholdingVatRate" : "withholdingIsrRate"),
      );
  });

  // Totals.
  if (totals.total.lessThan(0))
    error(
      "totals",
      "TOTAL_NEGATIVE",
      "Los descuentos y retenciones no pueden superar el importe de la factura.",
      { field: "total" },
    );
  return issues;
}
