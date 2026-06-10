export interface StampRequest {
  receiverRfc: string;
  concepts: Array<{ description: string; quantity: number; unitPrice: number }>;
}

export interface InvoiceProvider {
  stamp(request: StampRequest): Promise<{ uuid: string; xmlUrl: string; pdfUrl: string }>;
}

