export type TicketStatus = "Pendiente" | "Analizando" | "Listo" | "Facturado";
export type Compatibility = "Automática" | "Asistida" | "Próximamente";

export interface Ticket {
  id: string;
  company: string;
  date: string;
  total: number;
  category: string;
  status: TicketStatus;
}

export interface Company {
  id: string;
  name: string;
  portalUrl: string;
  compatibility: Compatibility;
  requiredFields: string[];
  rule: string;
}

export interface OcrResult {
  provider: string;
  confidence: number;
  fields: Record<string, string | number>;
}

