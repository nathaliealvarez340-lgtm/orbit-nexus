export const extractionKeys = [
  "merchantName",
  "merchantRfc",
  "ticketNumber",
  "folio",
  "transactionNumber",
  "storeNumber",
  "terminalNumber",
  "date",
  "time",
  "subtotal",
  "tax",
  "total",
  "currency",
  "paymentMethod",
  "paymentReference",
  "billingCode",
  "billingUrl",
  "qrPayload",
] as const;
export type ExtractionKey = (typeof extractionKeys)[number];
export type TicketDetectedData = Record<ExtractionKey, string | null> & {
  dateRaw: string | null;
  timezone: string | null;
};
export type TicketExtractionResult = {
  provider: string;
  detectedData: TicketDetectedData;
  rawText: string | null;
  rawPayload: unknown;
  confidence: number | null;
  fieldConfidence: Partial<Record<ExtractionKey, number>>;
  warnings: string[];
  outcome: "REVIEW" | "OCR_FAILED" | "NEEDS_MANUAL_INPUT";
};
export interface TicketOcrProvider {
  analyzeTicket(document: {
    content: Uint8Array;
    mimeType: string;
  }): Promise<TicketExtractionResult>;
}
