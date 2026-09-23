import { createHash } from "node:crypto";
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export class UploadValidationError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const formats: Record<
  string,
  { extensions: string[]; test: (b: Buffer) => boolean }
> = {
  "image/jpeg": {
    extensions: ["jpg", "jpeg"],
    test: (b) => b[0] === 255 && b[1] === 216 && b[2] === 255,
  },
  "image/png": {
    extensions: ["png"],
    test: (b) =>
      b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  },
  "image/webp": {
    extensions: ["webp"],
    test: (b) =>
      b.subarray(0, 4).toString() === "RIFF" &&
      b.subarray(8, 12).toString() === "WEBP",
  },
  "application/pdf": {
    extensions: ["pdf"],
    test: (b) => b.subarray(0, 5).toString() === "%PDF-",
  },
};
export async function validateUpload(file: File, allowXml = false) {
  if (file.size > MAX_UPLOAD_BYTES)
    throw new UploadValidationError(413, "El archivo debe pesar hasta 10 MB.");
  if (!file.size)
    throw new UploadValidationError(400, "El archivo está vacío.");
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  const bytes = Buffer.from(await file.arrayBuffer());
  const xml =
    allowXml &&
    extension === "xml" &&
    ["text/xml", "application/xml"].includes(file.type);
  if (xml) {
    const text = bytes
      .toString("utf8")
      .replace(/^\uFEFF/, "")
      .trim();
    if (!text.startsWith("<") || /<!DOCTYPE|<!ENTITY/i.test(text))
      throw new Error("XML no permitido.");
  } else {
    const format = formats[file.type];
    if (
      !format ||
      !format.extensions.includes(extension) ||
      !format.test(bytes)
    )
      throw new Error(
        "El contenido, formato y extensión del archivo no coinciden.",
      );
  }
  const fileName =
    file.name.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(-120) ||
    "documento." + extension;
  return {
    fileName,
    mimeType: xml ? "application/xml" : file.type,
    size: bytes.length,
    content: bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
