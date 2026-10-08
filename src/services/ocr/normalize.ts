import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { normalizeBillingUrl } from "@/lib/billing-url";
import {
  extractionKeys,
  type TicketDetectedData,
  type TicketExtractionResult,
  type ExtractionKey,
} from "./types";

export function normalizeAmount(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let value = input
    .trim()
    .replace(/^(?:MXN|USD|EUR|\$)\s*/i, "")
    .replace(/\s*(?:MXN|USD|EUR)$/i, "");
  if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(value))
    value = value.replaceAll(",", "");
  else if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(value))
    value = value.replaceAll(".", "").replace(",", ".");
  else if (/^\d+,\d{1,2}$/.test(value)) value = value.replace(",", ".");
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(value)) return null;
  const decimal = new Prisma.Decimal(value);
  return decimal.gte(0) && decimal.lt("10000000000")
    ? decimal.toFixed(2)
    : null;
}
export function normalizeDate(value: string): string | null {
  let candidate = value.trim();
  const parts = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(candidate);
  if (parts) {
    const [, first, second, year] = parts;
    if (+first <= 12 && +second <= 12 && first !== second) return null;
    const [day, month] = +first > 12 ? [first, second] : [second, first];
    candidate = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return null;
  const date = new Date(candidate + "T00:00:00Z");
  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === candidate
    ? candidate
    : null;
}
const aliases: Partial<Record<ExtractionKey, string>> = {
  merchantName: "merchant",
  merchantRfc: "issuerRfc",
  date: "purchaseDate",
  transactionNumber: "operationNumber",
  storeNumber: "branch",
  billingCode: "billingReference",
};
export function normalizeExtraction(
  input: {
    provider: string;
    fields: Record<string, string | null | undefined>;
    raw?: unknown;
    rawText?: string | null;
    confidence?: number | null;
    fieldConfidence?: Record<string, number>;
  },
  qr: { payload: string | null; warnings: string[] },
  failed = false,
): TicketExtractionResult {
  const warnings = [...qr.warnings];
  const data = Object.fromEntries(
    extractionKeys.map((key) => [key, null]),
  ) as TicketDetectedData;
  data.dateRaw = null;
  data.timezone = null;
  const rawText = input.rawText?.slice(0, 100000) ?? null;
  for (const key of extractionKeys) {
    const value = input.fields[key] ?? input.fields[aliases[key] ?? ""];
    data[key] =
      typeof value === "string" && value.trim()
        ? value
            .trim()
            .slice(
              0,
              key === "qrPayload" ? 4096 : key === "billingUrl" ? 1000 : 250,
            )
        : null;
  }
  // Only explicit labels are parsed; no first-line merchant, inferred total or guessed currency.
  const patterns: Partial<Record<ExtractionKey, RegExp>> = {
    merchantName: /^\s*(?:comercio|raz[oó]n social)\s*[:#]\s*(.+)$/gim,
    merchantRfc: /^\s*RFC(?: emisor)?\s*[:#]\s*(.+)$/gim,
    ticketNumber: /^\s*(?:ticket|n[uú]mero de ticket|TC)\s*[:#]\s*(.+)$/gim,
    folio: /^\s*folio\s*[:#]\s*(.+)$/gim,
    transactionNumber:
      /^\s*(?:operaci[oó]n|transacci[oó]n|n[uú]mero de operaci[oó]n)\s*[:#]\s*(.+)$/gim,
    storeNumber: /^\s*sucursal\s*[:#]\s*(.+)$/gim,
    terminalNumber: /^\s*(?:terminal|caja)\s*[:#]\s*(.+)$/gim,
    billingCode: /^\s*c[oó]digo de facturaci[oó]n\s*[:#]\s*(.+)$/gim,
    subtotal: /^\s*subtotal\s*[:#]?\s+([\d$.,]+(?:\s*(?:MXN|USD|EUR))?)\s*$/gim,
    tax: /^\s*(?:IVA|impuesto)\s*[:#]?\s+([\d$.,]+)\s*$/gim,
    total:
      /^\s*(?:total|importe total|total a pagar)\s*[:#]?\s+([\d$.,]+(?:\s*(?:MXN|USD|EUR))?)\s*$/gim,
    date: /^\s*fecha\s*[:#]?\s+(\d{1,4}[/-]\d{1,2}[/-]\d{2,4})\s*$/gim,
    currency: /^\s*moneda\s*[:#]\s*(MXN|USD|EUR)\s*$/gim,
    time: /^\s*hora\s*[:#]\s*(\d{2}:\d{2}(?::\d{2})?)\s*$/gim,
    paymentMethod: /^\s*(?:m[eé]todo|forma) de pago\s*[:#]\s*(.+)$/gim,
    paymentReference: /^\s*referencia de pago\s*[:#]\s*(.+)$/gim,
  };
  for (const [key, pattern] of Object.entries(patterns)) {
    const values = [
      ...new Set(
        [...(rawText ?? "").matchAll(pattern)].map((m) => m[1].trim()),
      ),
    ];
    const field = key as ExtractionKey;
    if (values.length > 1 && ["total", "date"].includes(key)) {
      warnings.push(key === "total" ? "MULTIPLE_TOTALS" : "MULTIPLE_DATES");
      data[field] = null;
    } else if (!data[field] && values.length === 1)
      data[field] = values[0].slice(0, 250);
  }
  for (const key of ["subtotal", "tax", "total"] as const) {
    const normalized = normalizeAmount(data[key]);
    if (data[key] && normalized === null)
      warnings.push("INVALID_" + key.toUpperCase());
    data[key] = normalized;
  }
  data.dateRaw = data.date;
  data.date = data.dateRaw ? normalizeDate(data.dateRaw) : null;
  if (data.dateRaw && !data.date) warnings.push("AMBIGUOUS_DATE");
  data.timezone = input.fields.timezone?.trim().slice(0, 80) || null;
  if (
    data.time &&
    !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(data.time)
  ) {
    data.time = null;
    warnings.push("INVALID_TIME");
  }
  if (data.currency) {
    data.currency = data.currency.toUpperCase();
    if (!/^[A-Z]{3}$/.test(data.currency)) {
      data.currency = null;
      warnings.push("INVALID_CURRENCY");
    }
  }
  if (data.merchantRfc) {
    data.merchantRfc = data.merchantRfc.toUpperCase();
    if (!/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(data.merchantRfc)) {
      data.merchantRfc = null;
      warnings.push("INVALID_RFC");
    }
  }
  if (qr.payload) data.qrPayload = qr.payload;
  const printed =
    (rawText ?? "").match(
      /(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,63}(?::\d+)?(?:\/[^\s<>]*)?/gi,
    ) ?? [];
  const candidates = [
    data.billingUrl,
    data.qrPayload,
    ...printed.filter((s) => /factur|billing|invoice/i.test(s)),
  ].filter((v): v is string => Boolean(v));
  const valid: string[] = [];
  for (const value of candidates) {
    const url = normalizeBillingUrl(value.replace(/[),.;]+$/, ""));
    if (url) valid.push(url);
    else if (
      value === data.billingUrl ||
      /^(?:https?:|javascript:|data:|file:)/i.test(value)
    )
      warnings.push("SUSPICIOUS_URL");
  }
  const urls = [...new Set(valid)];
  data.billingUrl = urls.length === 1 ? urls[0] : null;
  if (urls.length > 1) warnings.push("MULTIPLE_URLS");
  if (data.billingUrl?.startsWith("http:")) warnings.push("HTTP_URL");
  if (data.billingUrl?.includes("xn--")) warnings.push("SUSPICIOUS_URL");
  const fieldConfidence = Object.fromEntries(
    Object.entries(input.fieldConfidence ?? {}).filter(
      ([key, value]) =>
        extractionKeys.includes(key as ExtractionKey) &&
        value >= 0 &&
        value <= 1,
    ),
  );
  if (
    (input.confidence != null && input.confidence < 0.7) ||
    Object.values(fieldConfidence).some((v) => v < 0.7)
  )
    warnings.push("LOW_CONFIDENCE");
  if (!data.total) warnings.push("MISSING_TOTAL");
  if (!data.date) warnings.push("MISSING_DATE");
  if (!data.merchantName) warnings.push("MISSING_MERCHANT");
  if (!data.currency) warnings.push("MISSING_CURRENCY");
  if (failed) warnings.push("OCR_FAILED");
  if (input.provider === "manual") warnings.push("OCR_NOT_CONFIGURED");
  return {
    provider: input.provider,
    detectedData: data,
    rawText,
    rawPayload: input.raw ?? null,
    confidence: input.confidence ?? null,
    fieldConfidence,
    warnings: [...new Set(warnings)],
    outcome: failed
      ? "OCR_FAILED"
      : input.provider === "manual"
        ? "NEEDS_MANUAL_INPUT"
        : "REVIEW",
  };
}
