import { z } from "zod";

export const passwordSchema = z
  .string()
  .min(12, "Usa al menos 12 caracteres")
  .max(128)
  .regex(/[a-z]/, "Incluye una minúscula")
  .regex(/[A-Z]/, "Incluye una mayúscula")
  .regex(/[0-9]/, "Incluye un número");
export const registerSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    email: z.email().max(254),
    password: passwordSchema,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    path: ["confirm"],
    message: "Las contraseñas no coinciden",
  });
const money = z
  .string()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, "Importe válido con hasta dos decimales")
  .refine(
    (v) => Number(v) > 0 && Number(v) < 10000000000,
    "Importe fuera de rango",
  );
const optionalText = z.string().trim().max(250).optional();
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v + "T00:00:00Z");
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Fecha inválida");
export const expenseSchema = z.object({
  merchant: z.string().trim().min(2).max(150),
  purchaseDate: dateSchema,
  total: money,
  folio: optionalText,
  issuerRfc: optionalText,
  time: optionalText,
  ticketNumber: optionalText,
  operationNumber: optionalText,
  branch: optionalText,
  paymentMethod: optionalText,
  billingReference: optionalText,
  billingUrl: z.union([z.literal(""), z.url().max(1000)]).optional(),
  subtotal: z.union([z.literal(""), money]).optional(),
  tax: z
    .union([z.literal(""), z.string().regex(/^\d{1,10}(\.\d{1,2})?$/)])
    .optional(),
});
export const billingDetailsSchema = expenseSchema.pick({
  folio: true,
  ticketNumber: true,
  operationNumber: true,
  branch: true,
  paymentMethod: true,
  billingReference: true,
});
export const fiscalSchema = z
  .object({
    rfc: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/, "RFC inválido"),
    legalName: z.string().trim().min(3).max(200),
    fiscalRegime: z.string().regex(/^\d{3}$/),
    postalCode: z.string().regex(/^\d{5}$/),
    cfdiUse: z.string().regex(/^[A-Z][0-9]{2}$/),
    email: z.email().max(254),
    personType: z.enum(["INDIVIDUAL", "COMPANY"]),
    confirmed: z.literal(true, {
      error: "Confirma que revisaste los datos fiscales",
    }),
  })
  .refine((v) => v.rfc.length === (v.personType === "INDIVIDUAL" ? 13 : 12), {
    path: ["rfc"],
    message: "El RFC no coincide con el tipo de persona",
  });
