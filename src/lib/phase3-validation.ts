import { z } from "zod";
import { cfdiUses, paymentForms } from "./fiscal-catalogs";
import { dateSchema } from "./validation";
const text = z.string().trim().max(200).default("");
export const cfdiUseSchema = z
  .string()
  .refine(
    (v) => cfdiUses.some(([code]) => code === v),
    "Selecciona un uso CFDI del catálogo",
  );
export const paymentFormSchema = z
  .string()
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
  })
  .refine(
    (v) =>
      v.rfc === "XEXX010101000" ||
      v.rfc === "XAXX010101000" ||
      v.rfc.length === (v.personType === "INDIVIDUAL" ? 13 : 12),
    { path: ["rfc"], message: "RFC y tipo de persona incompatibles" },
  );
const decimal = (digits: number) =>
  z
    .string()
    .regex(new RegExp(`^\\d{1,7}(\\.\\d{1,${digits}})?$`))
    .refine((v) => Number(v) > 0);
export const draftSchema = z
  .object({
    clientId: z.string().min(1).max(100),
    invoiceDate: dateSchema,
    documentType: z.enum(["I", "E"]),
    cfdiUse: cfdiUseSchema,
    paymentForm: paymentFormSchema,
    paymentMethod: z.enum(["PUE", "PPD"]),
    currency: z.enum(["MXN", "USD", "EUR"]),
    concepts: z
      .array(
        z.object({
          description: z.string().trim().min(1).max(500),
          productCode: z.string().regex(/^\d{8}$/),
          unitCode: z.string().regex(/^[A-Z0-9]{2,3}$/),
          quantity: decimal(4),
          unitPrice: decimal(2),
          taxRate: z.enum(["0", "0.08", "0.16"]),
        }),
      )
      .min(1)
      .max(100),
  })
  .refine((v) => v.paymentMethod !== "PPD" || v.paymentForm === "99", {
    path: ["paymentForm"],
    message: "PPD requiere forma de pago 99",
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
});
