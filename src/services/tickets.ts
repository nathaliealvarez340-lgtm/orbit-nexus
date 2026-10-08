import "server-only";
import { getDb } from "@/lib/db";
import { requireTenant } from "@/lib/tenant";
import { ApiError, enforceRateLimit } from "@/lib/http";
import { validateUpload, UploadValidationError } from "@/lib/upload-validation";
import { expenseSchema, billingDetailsSchema } from "@/lib/validation";
import { getTicketOcrProvider } from "@/services/ocr/adapter";
import { randomUUID } from "node:crypto";
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
  const token = randomUUID();
  const ticket = await getDb().$transaction(async (tx) => {
    const current = await tx.ticket.findFirst({
      where: { id, organizationId },
    });
    if (!current) throw new ApiError(404, "Ticket no disponible.");
    const claim = await tx.ticket.updateMany({
      where: {
        id,
        organizationId,
        confirmedAt: null,
        OR: [
          {
            status: {
              in: ["UPLOADED", "ERROR", "OCR_FAILED", "NEEDS_MANUAL_INPUT"],
            },
          },
          {
            status: "ANALYZING",
            updatedAt: { lt: new Date(Date.now() - 5 * 60 * 1000) },
          },
        ],
      },
      data: {
        status: "ANALYZING",
        analysisToken: token,
        analysisStartedAt: new Date(),
      },
    });
    if (!claim.count)
      throw new ApiError(409, "El ticket ya fue analizado o está en proceso.");
    // An expired worker can never overwrite the replacement worker's result.
    await tx.ticketOcrAttempt.updateMany({
      where: { organizationId, ticketId: id, outcome: "ANALYZING" },
      data: { outcome: "SUPERSEDED", finishedAt: new Date() },
    });
    await tx.ticketOcrAttempt.create({
      data: { id: token, organizationId, ticketId: id },
    });
    return current;
  });
  try {
    const document = await getDb().document.findFirst({
      where: { id: ticket.documentId || "", organizationId },
    });
    if (!document) throw new Error("DOCUMENT_UNAVAILABLE");
    const result = await getTicketOcrProvider().analyzeTicket(document);
    const stored = await getDb().$transaction(async (tx) => {
      const claim = await tx.ticket.updateMany({
        where: {
          id,
          organizationId,
          status: "ANALYZING",
          analysisToken: token,
        },
        data: {
          status: result.outcome,
          analysisToken: null,
          analysisStartedAt: null,
          merchant: result.detectedData.merchantName,
          billingUrl: result.detectedData.billingUrl,
          qrPayload: result.detectedData.qrPayload,
        },
      });
      if (!claim.count) return false;
      const raw =
        result.rawPayload == null
          ? Prisma.JsonNull
          : JSON.parse(JSON.stringify(result.rawPayload));
      const extracted = {
        provider: result.provider,
        confidence: result.confidence,
        fields: result.detectedData,
        rawResult: raw,
        rawText: result.rawText,
        warnings: result.warnings,
        fieldConfidence: result.fieldConfidence,
      };
      await tx.ticketExtractedData.upsert({
        where: { organizationId_ticketId: { organizationId, ticketId: id } },
        create: { organizationId, ticketId: id, ...extracted },
        update: extracted,
      });
      await tx.ticketOcrAttempt.updateMany({
        where: {
          id: token,
          organizationId,
          ticketId: id,
          outcome: "ANALYZING",
        },
        data: {
          provider: result.provider,
          outcome: result.outcome,
          rawPayload: raw,
          rawText: result.rawText,
          detectedData: result.detectedData,
          confidence: result.confidence,
          warnings: result.warnings,
          finishedAt: new Date(),
        },
      });
      await tx.activityLog.create({
        data: {
          organizationId,
          userId,
          action:
            result.outcome === "OCR_FAILED"
              ? "TICKET_OCR_FAILED"
              : "TICKET_ANALYZED",
          entityType: "Ticket",
          entityId: id,
        },
      });
      return true;
    });
    if (!stored)
      throw new ApiError(
        409,
        "Otro intento de análisis reemplazó este proceso.",
      );
    if (result.outcome === "OCR_FAILED")
      throw new ApiError(
        502,
        "No pudimos leer este ticket. Puedes reintentar o introducir datos manualmente.",
      );
    return {
      ok: true,
      manual: result.provider === "manual",
      status: result.outcome,
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    await getDb().$transaction(async (tx) => {
      const claim = await tx.ticket.updateMany({
        where: {
          id,
          organizationId,
          status: "ANALYZING",
          analysisToken: token,
        },
        data: {
          status: "OCR_FAILED",
          analysisToken: null,
          analysisStartedAt: null,
        },
      });
      if (claim.count)
        await tx.ticketOcrAttempt.updateMany({
          where: { id: token, organizationId },
          data: { outcome: "OCR_FAILED", finishedAt: new Date() },
        });
    });
    throw new ApiError(
      502,
      "No pudimos leer este ticket. Puedes reintentar o introducir datos manualmente.",
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
    const confirmed = {
      ...data,
      total: new Prisma.Decimal(data.total).toFixed(2),
      subtotal: data.subtotal
        ? new Prisma.Decimal(data.subtotal).toFixed(2)
        : null,
      tax: data.tax ? new Prisma.Decimal(data.tax).toFixed(2) : null,
      confirmedById: userId,
    };
    const claim = await tx.ticket.updateMany({
      where: {
        id,
        organizationId,
        status: {
          in: [
            "UPLOADED",
            "REVIEW",
            "READY",
            "ERROR",
            "OCR_FAILED",
            "NEEDS_MANUAL_INPUT",
          ],
        },
      },
      data: {
        status: "REGISTERED",
        merchant: data.merchant,
        total: confirmed.total,
        purchaseDate: new Date(data.purchaseDate + "T00:00:00Z"),
        confirmedData: confirmed,
        confirmedAt: new Date(),
        billingUrl: data.billingUrl || null,
      },
    });
    if (!claim.count) {
      const existing = await tx.expense.findFirst({
        where: { organizationId, ticketId: id },
      });
      if (existing) return { id: existing.id };
      if (
        (await tx.ticket.findFirst({ where: { id, organizationId } }))
          ?.confirmedAt
      )
        return { id: ticket.id, expenseCreated: false };
      throw new ApiError(409, "Espera a que termine el análisis del ticket.");
    }
    const { merchant, purchaseDate, total, subtotal, tax, folio, ...details } =
      data;
    // Existing expense reports are MXN-only. Preserve foreign-currency tickets
    // without falsely adding their nominal amount to peso expenses.
    if (data.currency !== "MXN") {
      await tx.activityLog.create({
        data: {
          organizationId,
          userId,
          action: "TICKET_CONFIRMED",
          entityType: "Ticket",
          entityId: id,
        },
      });
      return { id, expenseCreated: false };
    }
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
    await tx.$queryRaw`SELECT id FROM "Ticket" WHERE id=${id} AND "organizationId"=${organizationId} FOR UPDATE`;
    if (
      await tx.billingAttempt.findFirst({
        where: { organizationId, ticketId: id, activeKey: id },
      })
    )
      throw new ApiError(
        409,
        "Cancela el intento preparado antes de cambiar referencias. Si ya fue enviado, consulta su resultado.",
      );
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
  if (
    await getDb().billingAttempt.findFirst({
      where: { organizationId, activeKey: id },
    })
  )
    throw new ApiError(
      409,
      "Ya existe un intento de facturación. Consulta su estado en este ticket.",
    );
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
    await tx.$queryRaw`SELECT id FROM "Ticket" WHERE id=${id} AND "organizationId"=${organizationId} FOR UPDATE`;
    if (
      await tx.billingAttempt.findFirst({
        where: { organizationId, activeKey: id },
      })
    )
      throw new ApiError(
        409,
        "Ya existe un intento de facturación. Consulta su estado en este ticket.",
      );
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
