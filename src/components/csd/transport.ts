import type {
  CsdApiErrorCode,
  CsdState,
  CsdCustodyTerms,
  CsdHistoryItem,
  ConfigureCsdResponse,
  DisableCsdRequest,
} from "@/types/csd";
import { safeFormError } from "@/lib/form-errors";

export const csdMessages: Record<CsdApiErrorCode, string> = {
  CSD_FILES_REQUIRED:
    "Selecciona el .cer, el .key y escribe la contraseña de la llave.",
  CSD_CUSTODY_TERMS_REQUIRED:
    "Debes aceptar el texto vigente de custodia del CSD.",
  CSD_CERTIFICATE_INVALID: "El archivo .cer no es un certificado válido.",
  CSD_KEY_INVALID: "El archivo .key no es una llave privada válida.",
  CSD_PASSWORD_INVALID:
    "No pudimos abrir la llave privada con la contraseña proporcionada.",
  CSD_KEY_MISMATCH:
    "El certificado y la llave privada no corresponden entre sí.",
  CSD_EXPIRED: "El Certificado de Sello Digital está vencido.",
  CSD_NOT_YET_VALID: "El certificado todavía no está vigente.",
  CSD_RFC_MISMATCH:
    "El RFC del certificado no corresponde al emisor configurado.",
  CSD_RFC_UNVERIFIABLE: "No pudimos confirmar el RFC del certificado.",
  CSD_ISSUER_PROFILE_REQUIRED:
    "Completa y confirma tu Perfil Fiscal antes de configurar el CSD.",
  CSD_FILE_TOO_LARGE: "Cada archivo debe pesar como máximo 16 KiB.",
  CSD_UNSUPPORTED:
    "Este certificado o llave usa un formato que ORBIT no admite.",
  CSD_ALREADY_ACTIVE:
    "Ya tienes un CSD activo. Revisa el estado actual antes de sustituirlo.",
  CSD_CONFLICT:
    "El CSD cambió mientras trabajabas. Revisa el estado actualizado y vuelve a cargar antes de repetir.",
  CSD_IN_USE: "Hay un sellado en curso. Intenta en unos minutos.",
  CSD_FORBIDDEN: "Solo un administrador puede ver y gestionar el CSD.",
  CSD_REAUTH_REQUIRED:
    "Por seguridad, vuelve a iniciar sesión antes de modificar tu CSD.",
  CSD_ENVIRONMENT_MISMATCH:
    "Este certificado no corresponde al ambiente configurado. En pruebas solo se aceptan CSD de prueba.",
  CSD_RATE_LIMITED: "Demasiados intentos. Espera unos minutos.",
  CSD_SERVICE_UNAVAILABLE:
    "La custodia de CSD no está disponible en este entorno.",
  CSD_ENCRYPTION_FAILED:
    "No pudimos completar la operación. Consulta el estado antes de volver a intentarlo.",
  CSD_NOT_FOUND:
    "No hay un CSD activo. Actualiza el estado antes de continuar.",
};
export class CsdUiError extends Error {
  constructor(
    public status: number,
    public code?: CsdApiErrorCode,
    message?: string,
  ) {
    super(
      code
        ? csdMessages[code]
        : (message ??
            "No pudimos confirmar la operación. Consulta el estado antes de continuar."),
    );
  }
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const nullableText = (value: unknown) =>
  value === null || typeof value === "string";
const date = (value: unknown) =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
export function readCsdState(value: unknown): CsdState {
  if (
    !object(value) ||
    !["NOT_CONFIGURED", "VALID", "EXPIRED", "INVALID"].includes(
      String(value.status),
    ) ||
    !["id", "certificateNumber", "rfc"].every((key) =>
      nullableText(value[key]),
    ) ||
    !["validFrom", "validTo", "updatedAt"].every(
      (key) => value[key] === null || date(value[key]),
    ) ||
    ![null, "SANDBOX", "PRODUCTION"].includes(
      value.environment as string | null,
    ) ||
    ![
      null,
      "NOT_YET_VALID",
      "RFC_CHANGED",
      "KEY_UNAVAILABLE",
      "INTEGRITY",
    ].includes(value.invalidReason as string | null) ||
    !["expiresSoon", "canManage", "serviceAvailable"].every(
      (key) => typeof value[key] === "boolean",
    ) ||
    !(
      value.verification === null ||
      (object(value.verification) &&
        [
          "keyMatchesCertificate",
          "rfcMatchesIssuer",
          "withinValidity",
          "csdTypeVerifiedLocally",
        ].every(
          (key) =>
            typeof (value.verification as Record<string, unknown>)[key] ===
            "boolean",
        ))
    ) ||
    (value.status !== "NOT_CONFIGURED" &&
      (!value.id ||
        !value.certificateNumber ||
        !value.rfc ||
        !value.validFrom ||
        !value.validTo ||
        !value.verification))
  )
    throw new CsdUiError(503);
  // Keep only the published safe DTO; unexpected server fields never become UI state.
  return {
    id: value.id,
    status: value.status,
    environment: value.environment,
    invalidReason: value.invalidReason,
    expiresSoon: value.expiresSoon,
    canManage: value.canManage,
    serviceAvailable: value.serviceAvailable,
    certificateNumber: value.certificateNumber,
    rfc: value.rfc,
    validFrom: value.validFrom,
    validTo: value.validTo,
    updatedAt: value.updatedAt,
    verification: value.verification && {
      keyMatchesCertificate: value.verification.keyMatchesCertificate,
      rfcMatchesIssuer: value.verification.rfcMatchesIssuer,
      withinValidity: value.verification.withinValidity,
      csdTypeVerifiedLocally: value.verification.csdTypeVerifiedLocally,
    },
  } as CsdState;
}
export function readCsdTerms(value: unknown): CsdCustodyTerms {
  if (
    !object(value) ||
    typeof value.version !== "string" ||
    !value.version ||
    typeof value.text !== "string" ||
    !value.text
  )
    throw new CsdUiError(503);
  return { version: value.version, text: value.text };
}
export function readCsdHistory(value: unknown): CsdHistoryItem[] {
  if (
    !Array.isArray(value) ||
    value.length > 50 ||
    !value.every(
      (item) =>
        object(item) &&
        ["id", "certificateNumber", "rfc"].every(
          (key) => typeof item[key] === "string",
        ) &&
        ["ACTIVE", "REPLACED", "DISABLED"].includes(String(item.status)) &&
        ["SANDBOX", "PRODUCTION"].includes(String(item.environment)) &&
        ["validFrom", "validTo", "configuredAt"].every((key) =>
          date(item[key]),
        ) &&
        (item.endedAt === null || date(item.endedAt)) &&
        nullableText(item.configuredBy),
    )
  )
    throw new CsdUiError(503);
  return value.map((item) => ({
    id: item.id,
    status: item.status,
    certificateNumber: item.certificateNumber,
    rfc: item.rfc,
    environment: item.environment,
    validFrom: item.validFrom,
    validTo: item.validTo,
    configuredAt: item.configuredAt,
    configuredBy: item.configuredBy,
    endedAt: item.endedAt,
  }));
}
async function request(path: string, init?: RequestInit) {
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
    signal: init?.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(60000)])
      : AbortSignal.timeout(60000),
  });
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const raw = object(value) ? value.code : undefined;
    const code =
      typeof raw === "string" && Object.hasOwn(csdMessages, raw)
        ? (raw as CsdApiErrorCode)
        : undefined;
    throw new CsdUiError(
      response.status,
      code,
      response.status === 403
        ? csdMessages.CSD_FORBIDDEN
        : response.status === 401
          ? csdMessages.CSD_REAUTH_REQUIRED
          : safeFormError(
              value,
              "No pudimos confirmar la operación. Consulta el estado antes de continuar.",
            ),
    );
  }
  return value;
}
// Client adapter only. Shared response/request contracts are imported, never recreated.
export const csdTransport = {
  state: async (signal?: AbortSignal) =>
    readCsdState(await request("/api/csd", { signal })),
  terms: async (signal?: AbortSignal) =>
    readCsdTerms(await request("/api/csd/custody-terms", { signal })),
  history: async (signal?: AbortSignal) =>
    readCsdHistory(await request("/api/csd/history", { signal })),
  configure: async (
    body: FormData,
    signal?: AbortSignal,
  ): Promise<ConfigureCsdResponse> => {
    const value = await request("/api/csd", { method: "POST", body, signal });
    if (!object(value) || typeof value.created !== "boolean")
      throw new CsdUiError(503);
    return { ...readCsdState(value), created: value.created };
  },
  disable: async (body: DisableCsdRequest, signal?: AbortSignal) =>
    readCsdState(
      await request("/api/csd/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      }),
    ),
};
export type CsdTransport = typeof csdTransport;
