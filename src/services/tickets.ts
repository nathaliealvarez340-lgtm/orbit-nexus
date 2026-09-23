import "server-only";
import { getDb } from "@/lib/db";
import { requireTenant } from "@/lib/tenant";
import { ApiError, enforceRateLimit } from "@/lib/http";
import { validateUpload, UploadValidationError } from "@/lib/upload-validation";
import { expenseSchema, billingDetailsSchema } from "@/lib/validation";
import { getTicketOcrAdapter } from "@/services/ocr/adapter";
import { resolveInvoiceProvider } from "@/services/invoice-provider/assisted";
import { Prisma } from "@/generated/prisma/client";

export async function listTickets(query = "", page = 1) {
  const { organizationId } = await requireTenant();
  const where = {
    organizationId,
    ...(query
      ? {
          OR: [
            {
              merchant: {
                contains: query.slice(0, 100),
                mode: "insensitive" as const,
              },
            },
            {
              fileName: {
                contains: query.slice(0, 100),
                mode: "insensitive" as const,
              },
            },
          ],
        }
      : {}),
  };
  const [tickets, count] = await Promise.all([
    getDb().ticket.findMany({
      where,
      include: {
        expense: true,
        user: { select: { name: true } },
        extractedData: { select: { provider: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 25,
      skip: (page - 1) * 25,
    }),
    getDb().ticket.count({ where }),
  ]);
  return { tickets, count };
}
export async function getTicket(id: string) {
  const { organizationId } = await requireTenant();
  const ticket = await getDb().ticket.findFirst({
    where: { id, organizationId },
    include: {
      expense: true,
      user: { select: { name: true } },
      extractedData: true,
      invoice: true,
    },
  });
  if (!ticket) throw new ApiError(404, "Ticket no disponible.");
  return ticket;
}
export async function uploadTicket(file: File) {
  const { organizationId, userId } = await requireTenant();
  await enforceRateLimit("upload:" + userId, 20, 3600);
  let data;
  try {
    data = await validateUpload(file);
  } catch (e) {
    throw new ApiError(
      e instanceof UploadValidationError ? e.status : 400,
      (e as Error).message,
    );
  }
  return getDb().$transaction(async (tx) => {
    const doc = await tx.document.create({
      data: { ...data, organizationId, uploadedById: userId, kind: "TICKET" },
    });
    const ticket = await tx.ticket.create({
      data: {
        organizationId,
        userId,
        documentId: doc.id,
        fileName: doc.fileName,
        mimeType: doc.mimeType,
        storageKey: "db:" + doc.id,
      },
    });
    await tx.activityLog.create({
      data: {
        organizationId,
        userId,
        action: "TICKET_UPLOADED",
        entityType: "Ticket",
        entityId: ticket.id,
      },
    });
    return { id: ticket.id };
  });
}
export async function analyzeTicket(id: string) {
  const { organizationId, userId } = await requireTenant();
  await enforceRateLimit("ocr:" + userId, 20, 3600);
  const ticket = await getDb().ticket.findFirst({
    where: { id, organizationId },
  });
  if (!ticket) throw new ApiError(404, "Ticket no disponible.");
  const claim = await getDb().ticket.updateMany({
    where: {
      id,
      organizationId,
      OR: [
        { status: { in: ["UPLOADED", "ERROR"] } },
        {
          status: "ANALYZING",
          updatedAt: { lt: new Date(Date.now() - 5 * 60 * 1000) },
        },
      ],
    },
    data: { status: "ANALYZING" },
  });
  if (!claim.count)
    throw new ApiError(409, "El ticket ya fue analizado o está en proceso.");
  try {
    const document = await getDb().document.findFirst({
      where: { id: ticket.documentId || "", organizationId },
    });
    if (!document) throw new Error("DOCUMENT_UNAVAILABLE");
    const result = await getTicketOcrAdapter().analyze(document);
    await getDb().$transaction(async (tx) => {
      await tx.ticketExtractedData.upsert({
        where: { organizationId_ticketId: { organizationId, ticketId: id } },
        create: {
          organizationId,
          ticketId: id,
          provider: result.provider,
          confidence: result.confidence ?? null,
          fields: result.fields,
          rawResult: result.raw
            ? JSON.parse(JSON.stringify(result.raw))
            : Prisma.JsonNull,
        },
        update: {
          provider: result.provider,
          confidence: result.confidence ?? null,
          fields: result.fields,
          rawResult: result.raw
            ? JSON.parse(JSON.stringify(result.raw))
            : Prisma.JsonNull,
        },
      });
      await tx.ticket.updateMany({
        where: { id, organizationId, status: "ANALYZING" },
        data: { status: "REVIEW", merchant: result.fields.merchant ?? null },
      });
      await tx.activityLog.create({
        data: {
          organizationId,
          userId,
          action: "TICKET_ANALYZED",
          entityType: "Ticket",
          entityId: id,
        },
      });
    });
    return { ok: true, manual: result.provider === "manual" };
  } catch {
    await getDb().ticket.updateMany({
      where: { id, organizationId, status: "ANALYZING" },
      data: { status: "ERROR" },
    });
    throw new ApiError(
      502,
      "No se pudo analizar. Puedes reintentar o completar los datos manualmente.",
    );
  }
}
export async function confirmExpense(id: string, input: unknown) {
  const { organizationId, userId } = await requireTenant();
  await enforceRateLimit("confirm:" + userId, 30, 60);
  const data = expenseSchema.parse(input);
  return getDb().$transaction(async (tx) => {
    const ticket = await tx.ticket.findFirst({ where: { id, organizationId } });
    if (!ticket) throw new ApiError(404, "Ticket no disponible.");
    const claim = await tx.ticket.updateMany({
      where: {
        id,
        organizationId,
        status: { in: ["REVIEW", "READY", "ERROR"] },
      },
      data: { status: "REGISTERED", merchant: data.merchant },
    });
    if (!claim.count) {
      const existing = await tx.expense.findFirst({
        where: { organizationId, ticketId: id },
      });
      if (existing) return { id: existing.id };
      throw new ApiError(409, "Espera a que termine el análisis del ticket.");
    }
    const { merchant, purchaseDate, total, subtotal, tax, folio, ...details } =
      data;
    const expense = await tx.expense.create({
      data: {
        organizationId,
        ticketId: id,
        capturedById: ticket.userId,
        merchant,
        purchaseDate: new Date(purchaseDate + "T00:00:00Z"),
        total,
        subtotal: subtotal || null,
        tax: tax || null,
        folio,
        details,
      },
    });
    await tx.activityLog.create({
      data: {
        organizationId,
        userId,
        action: "EXPENSE_CONFIRMED",
        entityType: "Expense",
        entityId: expense.id,
      },
    });
    return { id: expense.id };
  });
}
export async function updateBillingDetails(id: string, input: unknown) {
  const { organizationId, userId } = await requireTenant();
  await enforceRateLimit("billing-details:" + userId, 20, 60);
  const { folio, ...details } = billingDetailsSchema.parse(input);
  return getDb().$transaction(async (tx) => {
    const expense = await tx.expense.findFirst({
      where: { organizationId, ticketId: id },
    });
    if (!expense) throw new ApiError(404, "Gasto no disponible.");
    const claim = await tx.ticket.updateMany({
      where: { id, organizationId, billingStatus: { not: "INVOICED" } },
      data: { billingStatus: "NOT_REQUESTED" },
    });
    if (!claim.count)
      throw new ApiError(409, "El ticket ya tiene una factura incorporada.");
    await tx.expense.updateMany({
      where: { organizationId, ticketId: id },
      data: {
        folio,
        details: {
          ...((expense.details as Record<string, string>) || {}),
          ...details,
        },
        billingStatus: "NOT_REQUESTED",
      },
    });
    await tx.activityLog.create({
      data: {
        organizationId,
        userId,
        action: "BILLING_DETAILS_UPDATED",
        entityType: "Ticket",
        entityId: id,
      },
    });
    return { ok: true };
  });
}
export async function prepareInvoice(id: string) {
  const { organizationId, userId } = await requireTenant();
  await enforceRateLimit("invoice:" + userId, 20, 60);
  const ticket = await getDb().ticket.findFirst({
    where: { id, organizationId },
    include: { expense: true },
  });
  if (!ticket) throw new ApiError(404, "Ticket no disponible.");
  if (!ticket.expense)
    throw new ApiError(409, "Confirma el gasto antes de facturar.");
  if (ticket.billingStatus === "INVOICED")
    throw new ApiError(409, "Este ticket ya tiene una factura registrada.");
  const expense = ticket.expense;
  const adapter = resolveInvoiceProvider(expense.merchant);
  const fiscal = await getDb().fiscalProfile.findFirst({
    where: { organizationId },
  });
  const details = (expense.details || {}) as Record<string, string>;
  const values = {
    ...details,
    merchant: expense.merchant,
    purchaseDate: expense.purchaseDate.toISOString().slice(0, 10),
    total: expense.total.toFixed(2),
    folio: expense.folio || "",
  };
  const missing = [
    ...(!fiscal ? ["Perfil fiscal confirmado"] : []),
    ...(adapter
      ? adapter.validate(values)
      : ["Portal de facturación verificado para este comercio"]),
  ];
  const status = missing.length ? "REQUIRES_DATA" : "REDIRECT_REQUIRED";
  await getDb().$transaction(async (tx) => {
    await tx.ticket.updateMany({
      where: { id, organizationId, billingStatus: { not: "INVOICED" } },
      data: { billingStatus: status },
    });
    await tx.expense.updateMany({
      where: {
        ticketId: id,
        organizationId,
        billingStatus: { not: "INVOICED" },
      },
      data: { billingStatus: status },
    });
    await tx.activityLog.create({
      data: {
        organizationId,
        userId,
        action: "INVOICE_STARTED",
        entityType: "Ticket",
        entityId: id,
      },
    });
  });
  return {
    status,
    missing,
    portalUrl: adapter?.portalUrl ?? null,
    provider: adapter?.name ?? null,
    values,
    fiscal: fiscal
      ? {
          rfc: fiscal.rfc,
          legalName: fiscal.legalName,
          fiscalRegime: fiscal.fiscalRegime,
          postalCode: fiscal.postalCode,
          cfdiUse: fiscal.cfdiUse,
          email: fiscal.email,
        }
      : null,
  };
}
