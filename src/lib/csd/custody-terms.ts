import type { CsdCustodyTerms } from "@/types/csd";

// Fase 5C.3 §AB.2: versioned custody consent that an OWNER/ADMIN accepts when configuring
// the CSD; its version is stored in CsdCertificate.custodyConsentVersion. PROVISIONAL
// wording pending legal review: it is never presented as approved and the version name
// says so. Changing the text requires a new version.
export const csdCustodyTerms: CsdCustodyTerms = {
  version: "custodia-csd-2026-10-borrador-1",
  text: [
    "Versión preliminar sujeta a revisión jurídica.",
    "Al configurar el Certificado de Sello Digital (CSD) de la organización autorizo a ORBIT NEXUS a custodiar su certificado (.cer) y su llave privada (.key) con la única finalidad de sellar los comprobantes fiscales que un propietario o administrador autorice uno por uno.",
    "La contraseña de la llave privada se usa una sola vez para abrirla durante esta configuración; no se guarda ni se registra.",
    "La llave privada se guarda cifrada y la llave maestra que la protege se mantiene separada de la base de datos. Nadie en ORBIT NEXUS puede verla ni descargarla.",
    "Configurar el CSD no emite ni autoriza ninguna factura. Cada timbrado requiere una autorización explícita.",
    "Puedo sustituir o deshabilitar el CSD en cualquier momento; al hacerlo, la llave privada cifrada se elimina. La información pública del certificado se conserva para la auditoría y la verificación de comprobantes ya emitidos.",
    "ORBIT NEXUS nunca solicita la e.firma. Si el archivo entregado no es un CSD, la validación final corresponde al SAT y al proveedor de certificación.",
  ].join("\n\n"),
};
