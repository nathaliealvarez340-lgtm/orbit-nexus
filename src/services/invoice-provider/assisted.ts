export interface InvoiceProviderAdapter {
  id: string;
  name: string;
  aliases: string[];
  portalUrl: string;
  requiredFields: Array<{ key: string; label: string }>;
  validate(values: Record<string, string>): string[];
  queryStatus(): Promise<"REDIRECT_REQUIRED">;
}
const definitions = [
  {
    id: "oxxo",
    name: "OXXO",
    aliases: ["oxxo"],
    portalUrl:
      "https://www4.oxxo.com/facturacionElectronica-web/views/layout/inicio.do",
    requiredFields: [
      { key: "purchaseDate", label: "Fecha de venta" },
      { key: "folio", label: "Folio de venta" },
      { key: "operationNumber", label: "ID de venta" },
      { key: "total", label: "Total" },
    ],
  },
  {
    id: "walmart",
    name: "Walmart",
    aliases: [
      "walmart",
      "walmart supercenter",
      "bodega aurrera",
      "sams club",
      "sam's club",
    ],
    portalUrl: "https://facturacion-clientes.walmart.com/",
    requiredFields: [
      { key: "ticketNumber", label: "TC del ticket" },
      { key: "operationNumber", label: "TR del ticket" },
    ],
  },
  {
    id: "costco",
    name: "Costco",
    aliases: ["costco", "costco wholesale"],
    portalUrl: "https://www.costco.com.mx/facturacion",
    requiredFields: [{ key: "ticketNumber", label: "Número de ticket" }],
  },
];
export const invoiceAdapters: InvoiceProviderAdapter[] = definitions.map(
  (d) => ({
    ...d,
    validate(values) {
      return this.requiredFields
        .filter((f) => !values[f.key]?.trim())
        .map((f) => f.label);
    },
    async queryStatus() {
      return "REDIRECT_REQUIRED";
    },
  }),
);
export function resolveInvoiceProvider(merchant: string) {
  return invoiceAdapters.find((p) =>
    p.aliases.includes(merchant.trim().toLowerCase()),
  );
}
// Extracted URLs are untrusted evidence; never navigate to them automatically.
