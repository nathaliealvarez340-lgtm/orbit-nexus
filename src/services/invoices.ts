import "server-only";
import { getDb } from "@/lib/db";
import { requireTenant } from "@/lib/tenant";
import { ApiError, enforceRateLimit } from "@/lib/http";
import { validateUpload, UploadValidationError } from "@/lib/upload-validation";
import { parseCfdi } from "@/lib/cfdi";
import { Prisma } from "@/generated/prisma/client";
import type { BillingContext } from "./billing/types";
export async function importInvoice(
  ticketId: string,
  xml: File,
  pdf: File | null,
  confirmed: boolean,
  evidence?: { attemptId: string; uuid?: string },
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
    await tx.$queryRaw`SELECT id FROM "Ticket" WHERE id=${ticketId} AND "organizationId"=${organizationId} FOR UPDATE`;
    const ticket = await tx.ticket.findFirst({
      where: { id: ticketId, organizationId },
      include: { expense: true },
    });
    if (!ticket) throw new ApiError(404, "Ticket no disponible.");
    if (!ticket.expense) throw new ApiError(409, "Confirma el gasto primero.");
    const attempt = await tx.billingAttempt.findFirst({
      where: {
        organizationId,
        ticketId,
        ...(evidence
          ? { id: evidence.attemptId }
          : {
              OR: [{ activeKey: ticketId }, { status: "NEEDS_MANUAL_ACTION" }],
            }),
      },
      orderBy: { createdAt: "desc" },
    });
    if (evidence && (!attempt || !attempt.submittedAt))
      throw new ApiError(409, "No existe un envío aprobado para este CFDI.");
    if (!evidence && attempt?.status === "SUBMITTING")
      throw new ApiError(
        409,
        "El envío al portal sigue en curso. Consulta su resultado antes de incorporar otro XML.",
      );
    const existing = await tx.invoice.findFirst({
      where: { organizationId, ticketId },
    });
    if (
      evidence &&
      existing?.billingAttemptId === evidence.attemptId &&
      existing.uuid === data.uuid
    )
      return { id: existing.id };
    const context = attempt?.context as unknown as BillingContext | undefined;
    const fiscal = await tx.fiscalProfile.findFirst({
      where: { organizationId },
    });
    const expectedRfc = evidence
      ? context?.fields.find((f) => f.key === "rfc")?.value
      : fiscal?.rfc;
    if (!expectedRfc || expectedRfc !== data.receiverRfc)
      throw new ApiError(
        400,
        "El RFC receptor no coincide con el perfil fiscal de la organización.",
      );
    const expectedIssuer =
      (evidence ? context?.expectedIssuerRfc : null) ||
      (ticket.expense.details as Record<string, unknown> | null)?.issuerRfc;
    if (expectedIssuer && expectedIssuer !== data.issuerRfc)
      throw new ApiError(
        400,
        "El RFC emisor no coincide con el comercio confirmado.",
      );
    if (evidence?.uuid && evidence.uuid.toLowerCase() !== data.uuid)
      throw new ApiError(400, "El UUID anunciado no coincide con el XML.");
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
      data: { billingStatus: "INVOICED", status: "INVOICED" },
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
        billingAttemptId: attempt?.id,
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
    if (attempt) {
      await tx.billingAttempt.updateMany({
        where: { id: attempt.id, organizationId },
        data: {
          status: "SUCCEEDED",
          activeKey: null,
          errorCode: null,
          errorCategory: null,
          approvalHash: null,
          approvalExpiresAt: null,
          completedAt: new Date(),
        },
      });
      await tx.billingAttemptEvent.createMany({
        data: ["CFDI_VALIDATED", "COMPLETED"].map((type) => ({
          organizationId,
          attemptId: attempt.id,
          type,
        })),
      });
    }
    await tx.activityLog.create({
      data: {
        organizationId,
        userId,
        action: "INVOICE_COMPLETED",
        entityType: "Invoice",
        entityId: invoice.id,
        metadata: {
          source: evidence ? "PORTAL_XML" : "USER_UPLOAD",
          satVerification: "PENDING",
        },
      },
    });
    return { id: invoice.id };
  });
}
