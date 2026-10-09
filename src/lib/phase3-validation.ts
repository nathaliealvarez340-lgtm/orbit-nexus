import { z } from "zod";
import { cfdiUses, paymentForms } from "./fiscal-catalogs";
import { canonicalRate, catalogCodes, vatRates } from "./sat-catalogs";
import { cfdiUseProblem, fiscalRegimeProblem } from "./fiscal-identity-rules";
import { dateSchema } from "./validation";
const text = z.string().trim().max(200).default("");
export const cfdiUseSchema = z
  .string({ error: "Selecciona un uso CFDI del catálogo" })
  .refine(
    (v) => cfdiUses.some(([code]) => code === v),
    "Selecciona un uso CFDI del catálogo",
  );
export const paymentFormSchema = z
  .string({ error: "Forma de pago inválida" })
  .refine(
    (v) => paymentForms.some(([code]) => code === v),
    "Forma de pago inválida",
  );
export const addressShape = {
  street: text,
  exteriorNumber: text,
  interiorNumber: text,
  colony: text,
  locality: text,
  municipality: text,
  state: text,
  country: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default("MEX"),
};
export const clientSchema = z
  .object({
    rfc: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/),
    legalName: z.string().trim().min(3).max(200),
    personType: z.enum(["INDIVIDUAL", "COMPANY"]),
    internalNumber: text,
    foreignTaxId: text,
    fiscalRegime: z.string().regex(/^\d{3}$/),
    cfdiUse: cfdiUseSchema,
    defaultPaymentForm: paymentFormSchema.default("99"),
    phone: text,
    email: z.email().max(254),
    additionalEmails: z.array(z.email().max(254)).max(10).default([]),
    notes: z.string().trim().max(2000).default(""),
    postalCode: z.string().regex(/^\d{5}$/),
    ...addressShape,
    reference: text,
    // Fase 5C §10.9: required only when saving reviewed data from an extraction.
    confirmed: z.literal(true).optional(),
    extractionId: z.string().trim().min(1).max(100).optional(),
  })
  .refine(
    (v) =>
      v.rfc === "XEXX010101000" ||
      v.rfc === "XAXX010101000" ||
      v.rfc.length === (v.personType === "INDIVIDUAL" ? 13 : 12),
    { path: ["rfc"], message: "RFC y tipo de persona incompatibles" },
  )
  .refine((v) => !v.extractionId || v.confirmed === true, {
    path: ["confirmed"],
    message: "Confirma que revisaste los datos fiscales del cliente",
  })
  // Fase 5C §10.2/§10.6: official régimen catalog and Uso CFDI compatibility.
  .superRefine((v, ctx) => {
    const regime = fiscalRegimeProblem(v.fiscalRegime, v.personType, v.rfc);
    if (regime)
      ctx.addIssue({ code: "custom", path: ["fiscalRegime"], message: regime });
    else {
      const use = cfdiUseProblem(
        v.cfdiUse,
        v.fiscalRegime,
        v.personType,
        v.rfc,
      );
      if (use)
        ctx.addIssue({ code: "custom", path: ["cfdiUse"], message: use });
    }
  });
// Fase 5 structural draft contract (src/types/invoice-studio.ts §14-15). Fiscal
// combinations live in invoice-rules.ts so a draft with fiscal errors can still be
// saved as DRAFT (contract §7). Codes that are persisted must exist in the catalog.
const absent = (v: unknown) => (v === "" || v === null ? undefined : v);
const decimalText = (integers: number, decimals: number, message: string) =>
  z
    .string({ error: message })
    .trim()
    .regex(new RegExp(`^\\d{1,${integers}}(\\.\\d{1,${decimals}})?$`), message);
const positive = (v: string) => /[1-9]/.test(v);
const catalogCode = (codes: Set<string>, message: string) =>
  z.string({ error: message }).refine((v) => codes.has(v), message);
const rateText = (message: string) =>
  z.preprocess(
    absent,
    z
      .string({ error: message })
      .trim()
      .regex(/^0(\.\d{1,6})?$/, message)
      .optional(),
  );
const productCode = z
  .string({ error: "Indica la clave de producto o servicio" })
  .trim()
  .regex(/^\d{8}$/, "La clave de producto o servicio tiene 8 dígitos");
const unitCode = z
  .string({ error: "Indica la clave de unidad" })
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{1,3}$/, "La clave de unidad tiene de 1 a 3 caracteres");
const taxObject = catalogCode(
  catalogCodes.taxObject,
  "Selecciona un objeto de impuesto del catálogo",
);
const vatFactor = z.enum(["TASA", "EXENTO"], {
  error: "Selecciona si el IVA es tasa o exento",
});
const vatRate = rateText("Tasa de IVA inválida");
const withholdingVatRate = rateText("Tasa de retención de IVA inválida");
const withholdingIsrRate = rateText("Tasa de retención de ISR inválida");

// Phase 3 clients sent `taxRate` and omitted taxObject/vatFactor/exportCode; those
// payloads keep working until Invoice Studio replaces the form (contract §36).
export const draftConceptSchema = z.preprocess(
  (v) =>
    v &&
    typeof v === "object" &&
    absent((v as { vatRate?: unknown }).vatRate) === undefined &&
    "taxRate" in v
      ? { ...v, vatRate: (v as { taxRate: unknown }).taxRate }
      : v,
  z.object({
    savedConceptId: z.preprocess(
      absent,
      z.string().trim().min(1).max(100).optional(),
    ),
    description: z
      .string({ error: "Describe el concepto" })
      .trim()
      .min(1, "Describe el concepto")
      .max(1000, "La descripción admite hasta 1000 caracteres"),
    productCode,
    unitCode,
    quantity: decimalText(8, 4, "Cantidad válida con hasta 4 decimales").refine(
      positive,
      "La cantidad debe ser mayor que cero",
    ),
    unitPrice: decimalText(10, 2, "Precio válido con hasta 2 decimales"),
    discount: z.preprocess(
      absent,
      decimalText(10, 2, "Descuento válido con hasta 2 decimales").optional(),
    ),
    taxObject: z.preprocess((v) => absent(v) ?? "02", taxObject),
    vatFactor: z.preprocess((v) => absent(v) ?? "TASA", vatFactor),
    vatRate,
    withholdingVatRate,
    withholdingIsrRate,
  }),
);
export const draftSchema = z.object({
  clientId: z
    .string({ error: "Selecciona un cliente" })
    .trim()
    .min(1, "Selecciona un cliente")
    .max(100),
  invoiceDate: dateSchema,
  documentType: z.enum(["I", "E", "T"], {
    error: "Selecciona un tipo de comprobante",
  }),
  currency: catalogCode(
    catalogCodes.currency,
    "Selecciona una moneda del catálogo",
  ),
  exchangeRate: z.preprocess(
    absent,
    decimalText(8, 6, "Tipo de cambio válido con hasta 6 decimales").optional(),
  ),
  cfdiUse: cfdiUseSchema,
  paymentMethod: z.preprocess(
    absent,
    z.enum(["PUE", "PPD"], { error: "Selecciona PUE o PPD" }).optional(),
  ),
  paymentForm: z.preprocess(absent, paymentFormSchema.optional()),
  exportCode: z.preprocess(
    (v) => absent(v) ?? "01",
    catalogCode(
      catalogCodes.exportCode,
      "Selecciona una clave de exportación del catálogo",
    ),
  ),
  concepts: z
    .array(draftConceptSchema, { error: "Agrega al menos un concepto" })
    .min(1, "Agrega al menos un concepto")
    .max(100, "Una factura admite hasta 100 conceptos"),
});
export type InvoiceDraftInput = z.infer<typeof draftSchema>;
export type InvoiceDraftConceptInput = InvoiceDraftInput["concepts"][number];
export const updateDraftSchema = draftSchema.extend({
  expectedUpdatedAt: z.iso.datetime({
    offset: true,
    error: "Recarga el borrador antes de guardarlo",
  }),
});
export const readyRequestSchema = z.object({
  expectedUpdatedAt: z.iso.datetime({ offset: true }).optional(),
});

// Saved concepts are templates (contract §11); they must be internally consistent.
export const savedConceptSchema = z
  .object({
    name: z
      .string({ error: "Nombra el concepto" })
      .trim()
      .min(1, "Nombra el concepto")
      .max(120, "El nombre admite hasta 120 caracteres"),
    description: z
      .string({ error: "Describe el concepto" })
      .trim()
      .min(1, "Describe el concepto")
      .max(1000, "La descripción admite hasta 1000 caracteres"),
    productCode,
    unitCode,
    defaultQuantity: z.preprocess(
      absent,
      decimalText(8, 4, "Cantidad válida con hasta 4 decimales")
        .refine(positive, "La cantidad debe ser mayor que cero")
        .optional(),
    ),
    unitPrice: z.preprocess(
      absent,
      decimalText(10, 2, "Precio válido con hasta 2 decimales").optional(),
    ),
    taxObject: taxObject.refine(
      (v) => ["01", "02", "03", "04"].includes(v),
      "Objeto de impuesto no soportado en esta fase",
    ),
    vatFactor,
    vatRate,
    withholdingVatRate,
    withholdingIsrRate,
    active: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    const taxes = [v.vatRate, v.withholdingVatRate, v.withholdingIsrRate];
    if (v.taxObject !== "02" && taxes.some(Boolean))
      ctx.addIssue({
        code: "custom",
        path: ["taxObject"],
        message: "Solo el objeto de impuesto 02 desglosa impuestos",
      });
    if (v.taxObject === "02" && v.vatFactor === "EXENTO" && v.vatRate)
      ctx.addIssue({
        code: "custom",
        path: ["vatRate"],
        message: "Un concepto exento no lleva tasa de IVA",
      });
    if (
      v.taxObject === "02" &&
      v.vatFactor === "TASA" &&
      !vatRates.includes(v.vatRate ? canonicalRate(v.vatRate) : "")
    )
      ctx.addIssue({
        code: "custom",
        path: ["vatRate"],
        message: "Selecciona IVA 16%, 8% o 0%",
      });
  });

export const settingsSchema = z.object({
  prefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{1,10}$/),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  template: z.literal("CLASSIC"),
  logoDocumentId: z.string().min(1).max(100),
  // Contract §10: optional so existing settings clients keep their stored defaults.
  currencyDefault: catalogCode(
    catalogCodes.currency,
    "Selecciona una moneda del catálogo",
  ).optional(),
  paymentMethodDefault: z.enum(["PUE", "PPD"]).nullable().optional(),
  paymentFormDefault: paymentFormSchema.nullable().optional(),
});
