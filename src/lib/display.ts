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
  OCR_FAILED: "No se pudo leer",
  NEEDS_MANUAL_INPUT: "Completar manualmente",
};
export const billingStatuses: Record<string, string> = {
  NOT_REQUESTED: "Sin solicitar",
  READY: "Listo",
  REQUIRES_DATA: "Faltan datos",
  REDIRECT_REQUIRED: "Continuar en portal",
  PROCESSING: "En proceso",
  BILLING_REVIEW: "Factura preparada: revisar",
  SUBMITTED: "Enviado: esperando CFDI",
  NEEDS_MANUAL_ACTION: "Requiere intervención",
  INVOICED: "Facturado",
  FAILED: "Falló",
};
export const activityLabels: Record<string, string> = {
  CLIENT_CREATED: "Cliente creado",
  CLIENT_UPDATED: "Cliente actualizado",
  CLIENT_ARCHIVED: "Cliente archivado",
  INVOICE_DRAFT_CREATED: "Borrador de factura creado",
  INVOICE_SETTINGS_UPDATED: "Configuración de facturas actualizada",
  USER_REGISTERED: "Cuenta y organización creadas",
  ORGANIZATION_CREATED: "Organización creada",
  LOGIN: "Inicio de sesión",
  TICKET_UPLOADED: "Ticket capturado",
  TICKET_ANALYZED: "Ticket preparado para revisión",
  TICKET_OCR_FAILED: "Lectura de ticket pendiente",
  TICKET_CONFIRMED: "Datos de ticket confirmados",
  EXPENSE_CONFIRMED: "Gasto confirmado",
  INVOICE_STARTED: "Facturación preparada",
  BILLING_DETAILS_UPDATED: "Referencias de facturación actualizadas",
  INVOICE_COMPLETED: "Factura incorporada",
  FISCAL_PROFILE_UPDATED: "Perfil fiscal actualizado",
  FISCAL_DOCUMENT_UPLOADED: "Documento fiscal recibido",
};
