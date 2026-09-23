import "server-only";
import { getDb } from "@/lib/db";
import { requireTenant } from "@/lib/tenant";
import { ApiError, enforceRateLimit } from "@/lib/http";
import { validateUpload, UploadValidationError } from "@/lib/upload-validation";
import { parseCfdi } from "@/lib/cfdi";
import { Prisma } from "@/generated/prisma/client";
export async function importInvoice(
  ticketId: string,
  xml: File,
  pdf: File | null,
  confirmed: boolean,
) {
  const { organizationId, userId } = await requireTenant();
  await enforceRateLimit("invoice-import:" + userId, 15, 3600);
  if (!confirmed)
    throw new ApiError(400, "Confirma que el CFDI corresponde al ticket.");
  let file, data;
  let pdfFile: Awaited<ReturnType<typeof validateUpload>> | undefined;
  try {
    file = await validateUpload(xml, true);
    if (file.mimeType !== "application/xml")
      throw new Error("Selecciona el XML del CFDI.");
    data = parseCfdi(file.content.toString("utf8"));
    if (pdf) {
      pdfFile = await validateUpload(pdf);
      if (pdfFile.mimeType !== "application/pdf")
        throw new Error("El archivo adicional debe ser PDF.");
    }
  } catch (e) {
    throw new ApiError(
      e instanceof UploadValidationError ? e.status : 400,
      (e as Error).message,
    );
  }
  return getDb().$transaction(async (tx) => {
    const ticket = await tx.ticket.findFirst({
      where: { id: ticketId, organizationId },
      include: { expense: true },
    });
    if (!ticket) throw new ApiError(404, "Ticket no disponible.");
    if (!ticket.expense) throw new ApiError(409, "Confirma el gasto primero.");
    const fiscal = await tx.fiscalProfile.findFirst({
      where: { organizationId },
    });
    if (!fiscal || fiscal.rfc !== data.receiverRfc)
      throw new ApiError(
        400,
        "El RFC receptor no coincide con el perfil fiscal de la organización.",
      );
    if (!ticket.expense.total.equals(new Prisma.Decimal(data.total)))
      throw new ApiError(
        400,
        "El total del CFDI no coincide con el gasto confirmado.",
      );
    const claim = await tx.ticket.updateMany({
      where: {
        id: ticketId,
        organizationId,
        billingStatus: { not: "INVOICED" },
      },
      data: { billingStatus: "INVOICED" },
    });
    if (!claim.count)
      throw new ApiError(409, "El ticket ya tiene una factura incorporada.");
    if (
      await tx.invoice.findFirst({ where: { organizationId, uuid: data.uuid } })
    )
      throw new ApiError(409, "Este UUID ya está registrado.");
    const doc = await tx.document.create({
      data: {
        ...file,
        organizationId,
        uploadedById: userId,
        kind: "INVOICE_XML",
      },
    });
    const pdfDoc = pdfFile
      ? await tx.document.create({
          data: {
            ...pdfFile,
            organizationId,
            uploadedById: userId,
            kind: "INVOICE_PDF",
          },
        })
      : null;
    const invoice = await tx.invoice.create({
      data: {
        organizationId,
        userId,
        ticketId,
        uuid: data.uuid,
        issuerName: data.issuerName,
        receiverRfc: data.receiverRfc,
        issuedAt: new Date(
          data.issuedAt.endsWith("Z") ? data.issuedAt : data.issuedAt + "Z",
        ),
        subtotal: data.subtotal,
        tax: data.tax,
        total: data.total,
        status: "ISSUED",
        xmlDocumentId: doc.id,
        pdfDocumentId: pdfDoc?.id,
      },
    });
    await tx.expense.updateMany({
      where: { organizationId, ticketId },
      data: { billingStatus: "INVOICED" },
    });
    await tx.activityLog.create({
      data: {
        organizationId,
        userId,
        action: "INVOICE_COMPLETED",
        entityType: "Invoice",
        entityId: invoice.id,
        metadata: { source: "USER_UPLOAD", satVerification: "PENDING" },
      },
    });
    return { id: invoice.id };
  });
}
