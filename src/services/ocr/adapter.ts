import "server-only";
import { z } from "zod";
const fieldsSchema = z.object({
  merchant: z.string().max(150).optional(),
  issuerRfc: z.string().max(20).optional(),
  purchaseDate: z.string().max(20).optional(),
  time: z.string().max(20).optional(),
  total: z.string().max(30).optional(),
  subtotal: z.string().max(30).optional(),
  tax: z.string().max(30).optional(),
  folio: z.string().max(250).optional(),
  ticketNumber: z.string().max(250).optional(),
  operationNumber: z.string().max(250).optional(),
  branch: z.string().max(250).optional(),
  paymentMethod: z.string().max(250).optional(),
  billingReference: z.string().max(250).optional(),
  billingUrl: z.string().max(1000).optional(),
});
const resultSchema = z.object({
  provider: z.string().max(80),
  confidence: z.number().min(0).max(1).nullable().optional(),
  fields: fieldsSchema,
  raw: z.unknown().optional(),
});
export interface TicketOcrAdapter {
  analyze(file: {
    content: Uint8Array;
    mimeType: string;
  }): Promise<z.infer<typeof resultSchema>>;
}
export function getTicketOcrAdapter(): TicketOcrAdapter {
  if (!process.env.OCR_API_URL)
    return {
      async analyze() {
        return {
          provider: "manual",
          confidence: null,
          fields: {},
          raw: { reason: "provider_not_configured" },
        };
      },
    };
  return {
    async analyze(file) {
      const response = await fetch(process.env.OCR_API_URL!, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(process.env.OCR_API_TOKEN
            ? { Authorization: "Bearer " + process.env.OCR_API_TOKEN }
            : {}),
        },
        body: JSON.stringify({
          mimeType: file.mimeType,
          base64: Buffer.from(file.content).toString("base64"),
        }),
        signal: AbortSignal.timeout(30000),
        redirect: "error",
      });
      if (!response.ok) throw new Error("OCR_UNAVAILABLE");
      const reader = response.body?.getReader();
      if (!reader) throw new Error("OCR_EMPTY");
      let size = 0;
      const chunks: Uint8Array[] = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 1024 * 1024) {
          await reader.cancel();
          throw new Error("OCR_RESPONSE_TOO_LARGE");
        }
        chunks.push(value);
      }
      return resultSchema.parse(
        JSON.parse(Buffer.concat(chunks).toString("utf8")),
      );
    },
  };
}
