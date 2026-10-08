export const billingErrors: Record<string, string> = {
  INVALID_URL:
    "La dirección no pasó la validación de seguridad. Usa el portal público oficial.",
  UNSUPPORTED_PROVIDER: "Este portal requiere el flujo manual.",
  AUTOMATION_NOT_CONFIGURED:
    "La automatización no está conectada. Puedes completar la solicitud manualmente.",
  PROFILE_INCOMPLETE: "Completa el perfil fiscal antes de preparar la factura.",
  VALIDATION_ERROR:
    "Faltan datos o los datos preparados ya cambiaron. Revisa el intento.",
  PORTAL_CHANGED:
    "El portal cambió. Revisa la solicitud manualmente; no se improvisaron campos.",
  FIELD_NOT_FOUND: "No se encontró un campo requerido en el portal.",
  AUTOMATION_TIMEOUT:
    "El portal no respondió a tiempo. Revisa el estado antes de continuar.",
  PROVIDER_ERROR: "El proveedor no pudo completar la operación.",
  SUBMIT_AMBIGUOUS:
    "No podemos confirmar si el portal recibió la solicitud. No la enviaremos de nuevo. Consulta el resultado o incorpora el XML.",
  CFDI_MISMATCH:
    "El CFDI no coincide con el ticket o receptor esperado. Requiere revisión manual.",
  DOWNLOAD_FAILED:
    "No se pudo recuperar un comprobante válido. Puedes incorporarlo manualmente.",
  CREDENTIALS_REQUIRED:
    "El portal requiere una cuenta. Inicia sesión directamente en su sitio; ORBIT no guarda esas credenciales.",
  APPROVAL_EXPIRED:
    "La aprobación venció. Revisa nuevamente los datos preparados.",
};
export type FieldMapping = {
  key: string;
  label: string;
  value: string;
  source: "TICKET_CONFIRMED" | "FISCAL_PROFILE" | "USER_INPUT";
  required: boolean;
};
export type BillingContext = {
  organizationId: string;
  userId: string;
  ticketId: string;
  attemptId: string;
  providerId: string;
  providerName: string;
  adapterKey: string;
  billingUrl: string;
  idempotencyKey: string;
  fields: FieldMapping[];
  expectedIssuerRfc: string | null;
};
export type RunnerResult = {
  state: "PREPARED" | "SUBMITTED" | "PENDING" | "RESULT" | "MANUAL" | "FAILED";
  sessionId?: string;
  verifiedFields?: Record<string, string>;
  errorCode?: string;
  xmlBase64?: string;
  pdfBase64?: string;
  uuid?: string;
};
export interface BillingAutomationRunner {
  run(
    action: "prepare" | "fill" | "submit" | "collect",
    context: BillingContext,
    sessionId?: string,
  ): Promise<RunnerResult>;
}
export interface BillingPortalAdapter {
  canHandle(context: BillingContext): boolean;
  inspectRequirements(context: BillingContext): string[];
  prepare(context: BillingContext): Promise<RunnerResult>;
  fill(context: BillingContext, sessionId: string): Promise<RunnerResult>;
  submit(context: BillingContext, sessionId: string): Promise<RunnerResult>;
  collectResult(
    context: BillingContext,
    sessionId: string,
  ): Promise<RunnerResult>;
}
