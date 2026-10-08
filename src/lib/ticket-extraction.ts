export const extractionWarnings: Record<string, string> = {
  MISSING_TOTAL: "No se detectó el total. Escríbelo desde el ticket.",
  MISSING_DATE: "No se detectó una fecha válida. Revísala en el original.",
  MISSING_MERCHANT: "No se identificó el comercio.",
  MISSING_CURRENCY:
    "No se detectó la moneda. Confirma la selección antes de guardar.",
  LOW_CONFIDENCE:
    "El proveedor indicó baja confianza. Revisa especialmente los importes y la fecha.",
  SUSPICIOUS_URL:
    "La URL requiere revisión; se descartaron direcciones no permitidas.",
  HTTP_URL:
    "El portal usa HTTP sin cifrar. Verifica si existe una dirección HTTPS oficial.",
  MULTIPLE_URLS:
    "Hay varias direcciones posibles. Introduce el portal oficial del ticket.",
  QR_NOT_DECODED:
    "No se pudo decodificar un QR. Si hay uno en el ticket, revisa la imagen o escribe la URL.",
  PDF_QR_PROVIDER_REQUIRED:
    "El QR dentro del PDF depende del proveedor OCR. Puedes subir una imagen del QR o escribir la URL.",
  IMAGE_NOT_DECODED:
    "No se pudo decodificar la imagen para buscar QR. Prueba otra captura.",
  AMBIGUOUS_DATE:
    "La fecha es ambigua o inválida. Selecciona la fecha correcta sin asumir su formato.",
  MULTIPLE_TOTALS:
    "Se encontraron varios totales posibles. Confirma cuál corresponde.",
  MULTIPLE_DATES:
    "Se encontraron varias fechas posibles. Confirma la fecha de compra.",
  INVALID_TOTAL: "El total detectado no tiene un formato monetario válido.",
  INVALID_SUBTOTAL: "Revisa el subtotal detectado.",
  INVALID_TAX: "Revisa el impuesto detectado.",
  INVALID_TIME: "La hora detectada no es válida.",
  INVALID_RFC: "El RFC detectado no tiene un formato válido.",
  INVALID_CURRENCY: "La moneda detectada no tiene un formato válido.",
  OCR_FAILED:
    "No pudimos leer este ticket. Puedes reintentar o introducir los datos manualmente.",
  OCR_NOT_CONFIGURED:
    "El OCR aún no está conectado. Completa los datos manualmente; la lectura local de QR sigue disponible.",
};
export function reviewFields(data: unknown): Record<string, string> {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  const fields = Object.fromEntries(
    Object.entries(data).filter(([, v]) => typeof v === "string"),
  ) as Record<string, string>;
  const aliases = {
    merchant: "merchantName",
    issuerRfc: "merchantRfc",
    purchaseDate: "date",
    operationNumber: "transactionNumber",
    branch: "storeNumber",
    billingReference: "billingCode",
  };
  for (const [key, canonical] of Object.entries(aliases))
    if (fields[canonical] !== undefined) fields[key] = fields[canonical];
  return fields;
}
