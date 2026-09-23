export const money = (value: number | string) =>
  new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 2,
  }).format(Number(value));
export const ticketStatuses: Record<string, string> = {
  UPLOADED: "Capturado",
  ANALYZING: "Analizando",
  READY: "Por revisar",
  REVIEW: "Por revisar",
  REGISTERED: "Registrado",
  INVOICED: "Facturado",
  ERROR: "Requiere revisión",
};
export const billingStatuses: Record<string, string> = {
  NOT_REQUESTED: "Sin solicitar",
  READY: "Listo",
  REQUIRES_DATA: "Faltan datos",
  REDIRECT_REQUIRED: "Continuar en portal",
  PROCESSING: "En proceso",
  INVOICED: "Facturado",
  FAILED: "Falló",
};
export const activityLabels: Record<string, string> = {
  USER_REGISTERED: "Cuenta y organización creadas",
  ORGANIZATION_CREATED: "Organización creada",
  LOGIN: "Inicio de sesión",
  TICKET_UPLOADED: "Ticket capturado",
  TICKET_ANALYZED: "Ticket preparado para revisión",
  EXPENSE_CONFIRMED: "Gasto confirmado",
  INVOICE_STARTED: "Facturación preparada",
  BILLING_DETAILS_UPDATED: "Referencias de facturación actualizadas",
  INVOICE_COMPLETED: "Factura incorporada",
  FISCAL_PROFILE_UPDATED: "Perfil fiscal actualizado",
  FISCAL_DOCUMENT_UPLOADED: "Documento fiscal recibido",
};
