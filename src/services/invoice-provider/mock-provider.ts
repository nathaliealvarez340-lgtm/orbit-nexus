import type { InvoiceProvider } from "./types";

export const mockInvoiceProvider: InvoiceProvider = {
  async stamp() {
    throw new Error("Pendiente de integración PAC");
  },
};

