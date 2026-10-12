import { ApiError } from "@/lib/http";
import { InvoiceApiError } from "@/lib/invoice-api";
import { logSafeError } from "@/lib/security/redact";
import type { CsdApiErrorCode } from "@/types/csd";

// Fase 5C.3 §N: every CSD failure is a stable code with a curated Spanish message. No
// OpenSSL, SQL, path, stack or cryptographic content ever reaches a response or a log.
const definitions: Record<CsdApiErrorCode, [status: number, message: string]> =
  {
    CSD_CERTIFICATE_INVALID: [
      400,
      "El certificado (.cer) no es válido. Usa el archivo .cer de tu Certificado de Sello Digital.",
    ],
    CSD_KEY_INVALID: [
      400,
      "La llave privada (.key) no es válida. Usa el archivo .key de tu Certificado de Sello Digital.",
    ],
    CSD_PASSWORD_INVALID: [
      400,
      "No pudimos abrir la llave privada con la contraseña proporcionada.",
    ],
    CSD_KEY_MISMATCH: [
      422,
      "El certificado y la llave privada no corresponden entre sí.",
    ],
    CSD_EXPIRED: [422, "El Certificado de Sello Digital está vencido."],
    CSD_NOT_YET_VALID: [
      422,
      "El Certificado de Sello Digital todavía no está vigente.",
    ],
    CSD_RFC_MISMATCH: [
      422,
      "El RFC del certificado no corresponde al emisor configurado.",
    ],
    CSD_ISSUER_PROFILE_REQUIRED: [
      409,
      "Confirma primero el Perfil Fiscal de la organización con su RFC.",
    ],
    CSD_FILE_TOO_LARGE: [
      413,
      "El archivo o la solicitud exceden el tamaño permitido.",
    ],
    CSD_UNSUPPORTED: [
      422,
      "El certificado o la llave usan un formato o algoritmo no soportado.",
    ],
    CSD_FILES_REQUIRED: [
      400,
      "Selecciona el certificado (.cer), la llave privada (.key) y escribe su contraseña.",
    ],
    CSD_CUSTODY_TERMS_REQUIRED: [
      400,
      "Debes aceptar el texto vigente de custodia del CSD.",
    ],
    CSD_RFC_UNVERIFIABLE: [
      422,
      "No pudimos identificar el RFC dentro del certificado.",
    ],
    CSD_ALREADY_ACTIVE: [
      409,
      "La organización ya tiene un CSD activo. Elige sustituirlo para continuar.",
    ],
    CSD_CONFLICT: [
      409,
      "El CSD de la organización cambió mientras tanto. Actualiza la página e inténtalo de nuevo.",
    ],
    CSD_IN_USE: [
      409,
      "El CSD se está usando para sellar un comprobante. Inténtalo en unos minutos.",
    ],
    CSD_FORBIDDEN: [
      403,
      "Solo un propietario o administrador puede administrar el CSD.",
    ],
    CSD_REAUTH_REQUIRED: [
      401,
      "Por seguridad, vuelve a iniciar sesión antes de administrar el CSD.",
    ],
    CSD_ENVIRONMENT_MISMATCH: [
      422,
      "El certificado no corresponde al ambiente de facturación configurado.",
    ],
    CSD_RATE_LIMITED: [
      429,
      "Demasiados intentos. Espera un momento antes de volver a intentarlo.",
    ],
    CSD_SERVICE_UNAVAILABLE: [
      503,
      "La custodia del CSD no está disponible en este momento.",
    ],
    CSD_ENCRYPTION_FAILED: [
      503,
      "No pudimos proteger la llave privada. No se guardó ningún cambio.",
    ],
    CSD_NOT_FOUND: [404, "No hay un CSD activo con ese identificador."],
  };

/** Validation stage of §M (1–13, plus "8b") where a configuration attempt stopped. */
export type CsdStage = number | "8b";

export class CsdError extends InvoiceApiError {
  constructor(
    public csdCode: CsdApiErrorCode,
    public stage: CsdStage | null = null,
  ) {
    const [status, message] = definitions[csdCode];
    super(status, message, csdCode);
    this.name = "CsdError";
  }
}

export const csdErrorStatus = (code: CsdApiErrorCode) => definitions[code][0];
export const csdErrorCodes = Object.keys(definitions) as CsdApiErrorCode[];

/**
 * §R: CSD routes answer coded errors; session/origin errors keep their message; anything
 * unexpected is logged as class and code only and answered as CSD_SERVICE_UNAVAILABLE.
 */
export function csdApiError(error: unknown) {
  if (error instanceof InvoiceApiError)
    return Response.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  if (error instanceof ApiError)
    return Response.json({ error: error.message }, { status: error.status });
  logSafeError("api/csd", error);
  const [status, message] = definitions.CSD_SERVICE_UNAVAILABLE;
  return Response.json(
    { error: message, code: "CSD_SERVICE_UNAVAILABLE" },
    { status },
  );
}
