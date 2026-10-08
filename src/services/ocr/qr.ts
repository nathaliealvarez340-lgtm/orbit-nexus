import "server-only";
import sharp from "sharp";
import jsQR from "jsqr";
export async function readTicketQr(document: {
  content: Uint8Array;
  mimeType: string;
}) {
  if (document.mimeType === "application/pdf")
    return { payload: null, warnings: ["PDF_QR_PROVIDER_REQUIRED"] };
  try {
    const { data, info } = await sharp(document.content, {
      limitInputPixels: 40000000,
    })
      .rotate()
      .resize({
        width: 1800,
        height: 1800,
        fit: "inside",
        withoutEnlargement: true,
      })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const qr = jsQR(new Uint8ClampedArray(data), info.width, info.height, {
      inversionAttempts: "attemptBoth",
    });
    return {
      payload: qr?.data.slice(0, 4096) ?? null,
      warnings: qr ? [] : ["QR_NOT_DECODED"],
    };
  } catch {
    return { payload: null, warnings: ["IMAGE_NOT_DECODED"] };
  }
}
