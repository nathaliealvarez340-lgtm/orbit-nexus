import { createHash } from "node:crypto";
import {
  malwareScanner,
  type MalwareScanner,
  type MalwareScanStatus,
} from "./security/malware-scan";
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export class UploadValidationError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
type UploadType =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "application/pdf"
  | "application/xml";
// Content is identified by its bytes; the declared type and the extension must agree.
// No active formats (SVG, HTML, scripts, archives) are accepted anywhere.
const formats: Record<
  UploadType,
  { extensions: string[]; declared: string[]; test: (b: Buffer) => boolean }
> = {
  "image/jpeg": {
    extensions: ["jpg", "jpeg"],
    declared: ["image/jpeg"],
    test: (b) => b[0] === 255 && b[1] === 216 && b[2] === 255,
  },
  "image/png": {
    extensions: ["png"],
    declared: ["image/png"],
    test: (b) =>
      b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  },
  "image/webp": {
    extensions: ["webp"],
    declared: ["image/webp"],
    test: (b) =>
      b.subarray(0, 4).toString() === "RIFF" &&
      b.subarray(8, 12).toString() === "WEBP",
  },
  "application/pdf": {
    extensions: ["pdf"],
    declared: ["application/pdf"],
    test: (b) => b.subarray(0, 5).toString() === "%PDF-",
  },
  "application/xml": {
    extensions: ["xml"],
    declared: ["text/xml", "application/xml"],
    test: safeXml,
  },
};
// Fase 5C.2 §8: explicit limits per category. XML is data only: UTF-8, no DTD or
// entity declarations, and parsed later without entity resolution.
const MB = 1024 * 1024;
export const uploadPolicies = {
  TICKET: {
    types: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
    maxBytes: 10 * MB,
  },
  // Kept compatible with the current fiscal-document UI, which also accepts images.
  FISCAL_DOCUMENT: {
    types: [
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/pdf",
      "application/xml",
    ],
    maxBytes: 10 * MB,
    xmlMaxBytes: 1 * MB,
  },
  CSF: { types: ["application/pdf"], maxBytes: 10 * MB },
  CLIENT_CSF: { types: ["application/pdf"], maxBytes: 10 * MB },
  INVOICE_LOGO: { types: ["image/png", "image/webp"], maxBytes: 2 * MB },
  RECEIVED_CFDI_XML: { types: ["application/xml"], maxBytes: 10 * MB },
  RECEIVED_CFDI_PDF: { types: ["application/pdf"], maxBytes: 10 * MB },
} satisfies Record<
  string,
  { types: UploadType[]; maxBytes: number; xmlMaxBytes?: number }
>;
export type UploadCategory = keyof typeof uploadPolicies;

function safeXml(bytes: Buffer) {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return false;
  }
  text = text.replace(/^\uFEFF/, "").trim();
  return (
    text.startsWith("<") &&
    !text.includes("\u0000") &&
    !/<!DOCTYPE|<!ENTITY|<!ELEMENT|<!ATTLIST/i.test(text)
  );
}

const megabytes = (bytes: number) => `${bytes / MB} MB`;

/** Display name only: storage uses the random Document id, never this value. */
export function safeFileName(name: string, extension: string) {
  return (
    name
      .replace(/[^\p{L}\p{N}._ -]/gu, "_")
      .replace(/^[.\s]+/, "")
      .slice(-120) || "documento." + extension
  );
}

export async function validateUpload(
  file: File,
  category: UploadCategory,
  scanner: MalwareScanner = malwareScanner(),
) {
  const policy: {
    types: UploadType[];
    maxBytes: number;
    xmlMaxBytes?: number;
  } = uploadPolicies[category];
  if (file.size > policy.maxBytes)
    throw new UploadValidationError(
      413,
      `El archivo debe pesar hasta ${megabytes(policy.maxBytes)}.`,
    );
  if (!file.size)
    throw new UploadValidationError(400, "El archivo está vacío.");
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  const type = policy.types.find(
    (candidate) =>
      formats[candidate].declared.includes(file.type) &&
      formats[candidate].extensions.includes(extension),
  );
  let bytes: Buffer<ArrayBuffer>;
  try {
    bytes = Buffer.from(await file.arrayBuffer());
  } catch {
    throw new UploadValidationError(400, "No pudimos leer el archivo.");
  }
  if (!type || !formats[type].test(bytes))
    throw new UploadValidationError(
      400,
      type === "application/xml"
        ? "XML no permitido."
        : "El contenido, formato y extensión del archivo no coinciden.",
    );
  if (
    type === "application/xml" &&
    policy.xmlMaxBytes &&
    bytes.length > policy.xmlMaxBytes
  )
    throw new UploadValidationError(
      400,
      `El XML debe pesar hasta ${megabytes(policy.xmlMaxBytes)}.`,
    );
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const malwareScan: MalwareScanStatus = await scanner.scan({
    category,
    mimeType: type,
    sha256,
    content: bytes,
  });
  if (malwareScan === "INFECTED")
    throw new UploadValidationError(
      422,
      "El archivo fue rechazado por el análisis de seguridad.",
    );
  if (malwareScan === "ERROR")
    throw new UploadValidationError(
      503,
      "No pudimos analizar el archivo. Intenta nuevamente.",
    );
  return {
    fileName: safeFileName(file.name, extension),
    mimeType: type,
    size: bytes.length,
    content: bytes,
    sha256,
    malwareScan,
  };
}
export type ValidatedUpload = Awaited<ReturnType<typeof validateUpload>>;

/** The fields stored in Document; the scan status goes to the audit trail instead. */
export function documentFields(upload: ValidatedUpload) {
  return {
    fileName: upload.fileName,
    mimeType: upload.mimeType,
    size: upload.size,
    content: upload.content,
    sha256: upload.sha256,
  };
}
