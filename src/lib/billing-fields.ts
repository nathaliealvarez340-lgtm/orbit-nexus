import { normalizeBillingUrl } from "./billing-url";
import type {
  Company,
  Expense,
  FiscalProfile,
} from "@/generated/prisma/client";
import type { FieldMapping } from "@/services/billing/types";

export const normalizedProviderName = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
export function matchProvider(
  providers: Company[],
  input: { rfc?: string | null; url?: string | null; name: string },
) {
  const eligible = providers.filter((p) => p.active);
  const unique = (rows: Company[]) => (rows.length === 1 ? rows[0] : null);
  const byRfc = input.rfc
    ? eligible.filter((p) => p.merchantRfc === input.rfc)
    : [];
  if (byRfc.length) return unique(byRfc);
  const url = normalizeBillingUrl(input.url ?? "");
  const byDomain = url
    ? eligible.filter(
        (p) =>
          p.domain === new URL(url).hostname &&
          (!p.merchantRfc || !input.rfc || p.merchantRfc === input.rfc),
      )
    : [];
  if (byDomain.length) return unique(byDomain);
  return unique(
    eligible.filter(
      (p) =>
        normalizedProviderName(p.name) === normalizedProviderName(input.name) &&
        (!p.merchantRfc || !input.rfc || p.merchantRfc === input.rfc),
    ),
  );
}
const ticketLabels: Record<string, string> = {
  merchant: "Comercio",
  issuerRfc: "RFC emisor",
  ticketNumber: "Número de ticket",
  folio: "Folio",
  operationNumber: "Operación",
  branch: "Sucursal",
  terminalNumber: "Terminal",
  purchaseDate: "Fecha",
  time: "Hora",
  total: "Total (MXN)",
  paymentMethod: "Método de pago",
  paymentReference: "Referencia de pago",
  billingReference: "Código de facturación",
};
const fiscalLabels: Record<string, string> = {
  rfc: "RFC receptor",
  legalName: "Razón social",
  fiscalRegime: "Régimen fiscal",
  postalCode: "Código postal",
  cfdiUse: "Uso CFDI",
  email: "Correo fiscal",
  street: "Calle",
  exteriorNumber: "Número exterior",
  interiorNumber: "Número interior",
  colony: "Colonia",
  locality: "Localidad",
  municipality: "Municipio",
  state: "Estado",
  country: "País",
};
export function mapBillingFields(
  expense: Expense,
  fiscal: FiscalProfile | null,
  required: string[],
): FieldMapping[] {
  const details =
    expense.details &&
    typeof expense.details === "object" &&
    !Array.isArray(expense.details)
      ? (expense.details as Record<string, unknown>)
      : {};
  const values: Record<string, unknown> = {
    ...details,
    merchant: expense.merchant,
    folio: expense.folio,
    purchaseDate: expense.purchaseDate.toISOString().slice(0, 10),
    total: expense.total.toFixed(2),
  };
  const requiredFiscal = [
    "rfc",
    "legalName",
    "fiscalRegime",
    "postalCode",
    "cfdiUse",
    "email",
  ];
  const fields: FieldMapping[] = [];
  for (const [labels, source, data] of [
    [ticketLabels, "TICKET_CONFIRMED", values],
    [fiscalLabels, "FISCAL_PROFILE", fiscal ?? {}],
  ] as const)
    for (const [key, label] of Object.entries(labels))
      fields.push({
        key,
        label,
        source,
        value: String((data as Record<string, unknown>)[key] ?? ""),
        required:
          required.includes(key) ||
          requiredFiscal.includes(key) ||
          ["purchaseDate", "total"].includes(key),
      });
  for (const key of required.filter(
    (key) => !fields.some((f) => f.key === key),
  ))
    fields.push({
      key,
      label: key,
      value: "",
      source: "USER_INPUT",
      required: true,
    });
  return fields;
}
