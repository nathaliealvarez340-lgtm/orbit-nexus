import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { requireTenant } from "@/lib/tenant";
import { ApiError, enforceRateLimit } from "@/lib/http";
import { fiscalProfileComplete } from "@/lib/fiscal-catalogs";
import { normalizeBillingUrl } from "@/lib/billing-url";
import { billingContextHash as contextHash } from "@/lib/billing-context-hash";
import {
  Prisma,
  type BillingAttempt,
  type BillingAttemptStatus,
  type BillingStatus,
} from "@/generated/prisma/client";
import { importInvoice } from "@/services/invoices";
import { mapBillingFields } from "@/lib/billing-fields";
import { portalAdapter } from "./runner";
import { validateNavigationUrl } from "./url-security";
import { billingErrors, type BillingContext, type RunnerResult } from "./types";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const prepareSchema = z.object({
  companyId: z.string().max(100).optional(),
  providerId: z.string().max(100).optional(),
  url: z.string().max(1000).optional(),
  name: z.string().trim().min(2).max(200).optional(),
  favorite: z.boolean().default(false),
  confirmedPortal: z.literal(true),
});
const json = (value: unknown) => value as Prisma.InputJsonValue;
const contextOf = (attempt: BillingAttempt) =>
  attempt.context as unknown as BillingContext;
const publicAttempt = (attempt: BillingAttempt) => ({
  id: attempt.id,
  ticketId: attempt.ticketId,
  status: attempt.status,
  billingUrl: attempt.billingUrl,
  fields: contextOf(attempt).fields,
  providerName: contextOf(attempt).providerName,
  errorCode: attempt.errorCode,
  error: attempt.errorCode
    ? (billingErrors[attempt.errorCode] ?? billingErrors.PROVIDER_ERROR)
    : null,
  missing: attempt.missingFields,
  createdAt: attempt.createdAt,
  submittedAt: attempt.submittedAt,
  completedAt: attempt.completedAt,
  approvedAt: attempt.approvedAt,
});
type Tx = Prisma.TransactionClient;
async function event(
  tx: Tx,
  attempt: BillingAttempt,
  type: string,
  errorCode?: string,
) {
  await tx.billingAttemptEvent.create({
    data: {
      organizationId: attempt.organizationId,
      attemptId: attempt.id,
      type,
      errorCode,
    },
  });
}
async function notify(
  tx: Tx,
  attempt: BillingAttempt,
  type: string,
  title: string,
) {
  const eventKey = `billing:${attempt.id}:${type}`;
  await tx.notification.upsert({
    where: {
      organizationId_eventKey: {
        organizationId: attempt.organizationId,
        eventKey,
      },
    },
    update: {},
    create: {
      organizationId: attempt.organizationId,
      eventKey,
      type,
      title,
      message: "Consulta los datos y el estado del ticket.",
      href: "/dashboard/tickets/" + attempt.ticketId,
    },
  });
}
async function setTicketState(
  tx: Tx,
  attempt: BillingAttempt,
  status: BillingStatus,
) {
  await tx.ticket.updateMany({
    where: {
      id: attempt.ticketId,
      organizationId: attempt.organizationId,
      billingStatus: { not: "INVOICED" },
    },
    data: { billingStatus: status },
  });
  await tx.expense.updateMany({
    where: {
      ticketId: attempt.ticketId,
      organizationId: attempt.organizationId,
      billingStatus: { not: "INVOICED" },
    },
    data: { billingStatus: status },
  });
}
async function fail(attempt: BillingAttempt, code: string) {
  const errorCode = code in billingErrors ? code : "PROVIDER_ERROR";
  await getDb().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Ticket" WHERE id=${attempt.ticketId} AND "organizationId"=${attempt.organizationId} FOR UPDATE`;
    const current = await tx.billingAttempt.findFirst({
      where: { id: attempt.id, organizationId: attempt.organizationId },
    });
    if (
      !current ||
      (attempt.status === "PREPARING" && current.status !== "PREPARING")
    )
      return;
    const claimed = await tx.billingAttempt.updateMany({
      where: {
        id: attempt.id,
        organizationId: attempt.organizationId,
        status: { notIn: ["SUCCEEDED", "CANCELLED"] },
      },
      data: {
        status: "NEEDS_MANUAL_ACTION",
        errorCode,
        errorCategory: current.submittedAt ? "RESULT" : "PREPARATION",
        approvalHash: null,
        approvalExpiresAt: null,
        completedAt: new Date(),
        activeKey: current.submittedAt ? attempt.ticketId : null,
      },
    });
    if (!claimed.count) return;
    await event(tx, attempt, "FAILED", errorCode);
    await setTicketState(tx, attempt, "NEEDS_MANUAL_ACTION");
    const failed = [
      "PORTAL_CHANGED",
      "PROVIDER_ERROR",
      "AUTOMATION_TIMEOUT",
    ].includes(errorCode);
    await notify(
      tx,
      attempt,
      failed ? "BILLING_FAILED" : "BILLING_MANUAL",
      failed
        ? "Facturación fallida: revisar ticket"
        : "Facturación requiere intervención",
    );
  });
}
async function findAttempt(id: string) {
  const tenant = await requireTenant();
  const attempt = await getDb().billingAttempt.findFirst({
    where: { id, organizationId: tenant.organizationId },
  });
  if (!attempt) throw new ApiError(404, "Intento no disponible.");
  return { ...tenant, attempt };
}
export async function billingHistory(ticketId: string) {
  const { organizationId } = await requireTenant();
  if (
    !(await getDb().ticket.findFirst({
      where: { id: ticketId, organizationId },
    }))
  )
    throw new ApiError(404, "Ticket no disponible.");
  const attempts = await getDb().billingAttempt.findMany({
    where: { organizationId, ticketId },
    orderBy: { createdAt: "desc" },
    take: 30,
    include: {
      events: {
        orderBy: { createdAt: "asc" },
        select: { type: true, errorCode: true, createdAt: true },
      },
      invoice: {
        select: {
          id: true,
          uuid: true,
          xmlDocumentId: true,
          pdfDocumentId: true,
        },
      },
    },
  });
  return attempts.map((a) => ({
    ...publicAttempt(a),
    events: a.events,
    invoice: a.invoice,
  }));
}
export async function prepareBilling(ticketId: string, input: unknown) {
  const { organizationId, userId } = await requireTenant();
  await enforceRateLimit("billing-prepare:" + userId, 15, 3600);
  const data = prepareSchema.parse(input),
    db = getDb();
  const attempt = await db.$transaction(async (tx) => {
    // Serialize prepare, references, manual import and submission against this tenant's ticket.
    await tx.$queryRaw`SELECT id FROM "Ticket" WHERE id=${ticketId} AND "organizationId"=${organizationId} FOR UPDATE`;
    const ticket = await tx.ticket.findFirst({
      where: { id: ticketId, organizationId },
      include: { expense: true },
    });
    if (!ticket) throw new ApiError(404, "Ticket no disponible.");
    if (!ticket.expense)
      throw new ApiError(
        409,
        "Confirma un gasto MXN antes de preparar su CFDI.",
      );
    if (ticket.billingStatus === "INVOICED")
      throw new ApiError(409, "Este ticket ya tiene una factura.");
    const active = await tx.billingAttempt.findFirst({
      where: { organizationId, activeKey: ticketId },
    });
    if (active) return { attempt: active, created: false, complete: true };
    let provider = data.providerId
      ? await tx.organizationBillingProvider.findFirst({
          where: { id: data.providerId, organizationId },
        })
      : null;
    if (data.providerId && !provider)
      throw new ApiError(404, "Proveedor no disponible.");
    const companyId = data.companyId ?? provider?.companyId;
    const company = companyId
      ? await tx.company.findFirst({ where: { id: companyId, active: true } })
      : null;
    if (companyId && !company)
      throw new ApiError(404, "Proveedor no disponible.");
    const url = normalizeBillingUrl(
      data.url ||
        provider?.customBillingUrl ||
        company?.portalUrl ||
        ticket.billingUrl ||
        "",
    );
    if (!url) throw new ApiError(400, billingErrors.INVALID_URL);
    const domain = new URL(url).hostname;
    const official =
      !!company && normalizeBillingUrl(company.portalUrl ?? "") === url;
    if (!provider)
      provider = await tx.organizationBillingProvider.upsert({
        where: { organizationId_domain: { organizationId, domain } },
        update: { lastUsedAt: new Date(), favorite: data.favorite },
        create: {
          organizationId,
          companyId: official ? company.id : null,
          name: data.name || company?.name || ticket.expense.merchant,
          domain,
          customBillingUrl: url,
          favorite: data.favorite,
          lastUsedAt: new Date(),
        },
      });
    else
      await tx.organizationBillingProvider.updateMany({
        where: { id: provider.id, organizationId },
        data: { lastUsedAt: new Date(), favorite: data.favorite },
      });
    const fiscal = await tx.fiscalProfile.findUnique({
      where: { organizationId },
    });
    const required = Array.isArray(company?.requiredFields)
      ? company.requiredFields.filter((v): v is string => typeof v === "string")
      : [];
    const id = randomUUID();
    const context: BillingContext = {
      organizationId,
      userId,
      ticketId,
      attemptId: id,
      providerId: provider.id,
      providerName: company?.name || provider.name,
      adapterKey:
        official && company.automationMode === "AUTOMATED"
          ? company.adapterKey
          : "manual",
      billingUrl: url,
      idempotencyKey: randomUUID(),
      fields: mapBillingFields(ticket.expense, fiscal, required),
      expectedIssuerRfc:
        String(
          (ticket.expense.details as Record<string, unknown> | null)
            ?.issuerRfc ||
            company?.merchantRfc ||
            "",
        ) || null,
    };
    const missing = portalAdapter(context.adapterKey).inspectRequirements(
      context,
    );
    if (!fiscalProfileComplete(fiscal))
      missing.push("Perfil fiscal completo con dirección y constancia");
    const credentials = !!(
      company?.rules &&
      typeof company.rules === "object" &&
      !Array.isArray(company.rules) &&
      company.rules.requiresCredentials
    );
    const attempt = await tx.billingAttempt.create({
      data: {
        id,
        organizationId,
        ticketId,
        providerId: provider.id,
        requestedById: userId,
        adapterKey: context.adapterKey,
        billingUrl: url,
        activeKey: ticketId,
        idempotencyKey: context.idempotencyKey,
        context: json(context),
        contextHash: contextHash(context),
        missingFields: missing,
        retryCount: await tx.billingAttempt.count({
          where: { organizationId, ticketId },
        }),
      },
    });
    await event(tx, attempt, "PROVIDER_MATCHED");
    await event(tx, attempt, "REQUIREMENTS_DETECTED");
    await setTicketState(tx, attempt, "PROCESSING");
    return { attempt, created: true, complete: !missing.length, credentials };
  });
  if (!attempt.created) {
    if (
      attempt.attempt.status === "PREPARING" &&
      Date.now() - attempt.attempt.startedAt.getTime() > 180000
    )
      await fail(attempt.attempt, "AUTOMATION_TIMEOUT");
    return (await billingHistory(ticketId))[0];
  }
  const a = attempt.attempt,
    context = contextOf(a);
  {
    try {
      await validateNavigationUrl(context.billingUrl);
      await db.$transaction((tx) => event(tx, a, "URL_VALIDATED"));
      if (!attempt.complete) {
        await fail(a, "PROFILE_INCOMPLETE");
        return (await billingHistory(ticketId))[0];
      }
      if (attempt.credentials) {
        await fail(a, "CREDENTIALS_REQUIRED");
        return (await billingHistory(ticketId))[0];
      }
      const adapter = portalAdapter(context.adapterKey);
      const prepared = await adapter.prepare(context);
      if (prepared.state !== "PREPARED" || !prepared.sessionId)
        await fail(a, prepared.errorCode || "PORTAL_CHANGED");
      else {
        const filled = await adapter.fill(context, prepared.sessionId);
        if (
          filled.state !== "PREPARED" ||
          !context.fields
            .filter((f) => f.required)
            .every((f) => filled.verifiedFields?.[f.key] === f.value) ||
          Object.entries(filled.verifiedFields ?? {}).some(
            ([key, value]) =>
              !context.fields.some((f) => f.key === key && f.value === value),
          )
        )
          await fail(a, filled.errorCode || "FIELD_NOT_FOUND");
        else
          await db.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM "Ticket" WHERE id=${a.ticketId} AND "organizationId"=${organizationId} FOR UPDATE`;
            const claim = await tx.billingAttempt.updateMany({
              where: { id: a.id, organizationId, status: "PREPARING" },
              data: {
                status: "AWAITING_APPROVAL",
                remoteSession: prepared.sessionId,
              },
            });
            if (!claim.count) return;
            await event(tx, a, "FORM_PREPARED");
            await setTicketState(tx, a, "BILLING_REVIEW");
            await notify(
              tx,
              a,
              "BILLING_PREPARED",
              "Factura preparada para revisión",
            );
          });
      }
    } catch {
      await fail(a, "INVALID_URL");
    }
  }
  return (await billingHistory(ticketId))[0];
}
async function currentContext(tx: Tx, a: BillingAttempt) {
  const context = contextOf(a);
  const [expense, fiscal] = await Promise.all([
    tx.expense.findFirst({
      where: { ticketId: a.ticketId, organizationId: a.organizationId },
    }),
    tx.fiscalProfile.findUnique({
      where: { organizationId: a.organizationId },
    }),
  ]);
  if (!expense || !fiscalProfileComplete(fiscal))
    throw new ApiError(409, billingErrors.PROFILE_INCOMPLETE);
  const current = {
    ...context,
    fields: mapBillingFields(
      expense,
      fiscal,
      context.fields.filter((f) => f.required).map((f) => f.key),
    ),
  };
  if (contextHash(current) !== a.contextHash)
    throw new ApiError(409, billingErrors.VALIDATION_ERROR);
  return context;
}
export async function reviewBilling(id: string) {
  const { organizationId, userId, attempt } = await findAttempt(id);
  if (attempt.requestedById !== userId)
    throw new ApiError(403, "Solo quien preparó este intento puede aprobarlo.");
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 10 * 60000);
  await getDb().$transaction(async (tx) => {
    await currentContext(tx, attempt);
    const claim = await tx.billingAttempt.updateMany({
      where: { id, organizationId, status: "AWAITING_APPROVAL" },
      data: { approvalHash: hash(token), approvalExpiresAt: expiresAt },
    });
    if (!claim.count)
      throw new ApiError(409, "Este intento no está listo para aprobación.");
  });
  return { attempt: publicAttempt(attempt), approvalToken: token, expiresAt };
}
async function acceptResult(a: BillingAttempt, result: RunnerResult) {
  if (result.state === "RESULT" && result.xmlBase64) {
    try {
      const xml = new File(
        [Buffer.from(result.xmlBase64, "base64")],
        "factura.xml",
        { type: "application/xml" },
      );
      const pdf = result.pdfBase64
        ? new File([Buffer.from(result.pdfBase64, "base64")], "factura.pdf", {
            type: "application/pdf",
          })
        : null;
      await getDb().$transaction((tx) => event(tx, a, "RESULT_RECEIVED"));
      await importInvoice(a.ticketId, xml, pdf, true, {
        attemptId: a.id,
        uuid: result.uuid,
      });
    } catch {
      await fail(a, "CFDI_MISMATCH");
    }
  } else if (["PENDING", "SUBMITTED"].includes(result.state)) {
    await getDb().$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Ticket" WHERE id=${a.ticketId} AND "organizationId"=${a.organizationId} FOR UPDATE`;
      const claim = await tx.billingAttempt.updateMany({
        where: {
          id: a.id,
          organizationId: a.organizationId,
          status: { notIn: ["SUCCEEDED", "CANCELLED"] },
        },
        data: {
          status: "WAITING_PROVIDER",
          errorCode: null,
          errorCategory: null,
          completedAt: null,
          remoteSession: result.sessionId || a.remoteSession,
        },
      });
      if (claim.count) {
        await setTicketState(tx, a, "SUBMITTED");
        await event(tx, a, "SUBMITTED");
      }
    });
  } else await fail(a, result.errorCode || "DOWNLOAD_FAILED");
}
export async function submitBilling(id: string, input: unknown) {
  const data = z
    .object({ approvalToken: z.string().regex(/^[a-f0-9]{64}$/) })
    .parse(input);
  const { organizationId, userId, attempt } = await findAttempt(id);
  if (attempt.requestedById !== userId)
    throw new ApiError(403, "Aprobación no permitida.");
  await enforceRateLimit("billing-submit:" + userId, 15, 3600);
  const claimed = await getDb().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Ticket" WHERE id=${attempt.ticketId} AND "organizationId"=${organizationId} FOR UPDATE`;
    const a = await tx.billingAttempt.findFirstOrThrow({
      where: { id, organizationId },
    });
    // Repeated submissions are reads; never re-execute a portal action.
    if (a.submittedAt) return null;
    if (
      a.status !== "AWAITING_APPROVAL" ||
      a.approvalHash !== hash(data.approvalToken)
    )
      throw new ApiError(403, "La aprobación no corresponde a este intento.");
    if (!a.approvalExpiresAt || a.approvalExpiresAt <= new Date())
      throw new ApiError(409, billingErrors.APPROVAL_EXPIRED);
    await currentContext(tx, a);
    if (!a.remoteSession)
      throw new ApiError(409, "La sesión del portal no está disponible.");
    const ticket = await tx.ticket.findFirstOrThrow({
      where: { id: a.ticketId, organizationId },
    });
    if (ticket.billingStatus === "INVOICED")
      throw new ApiError(409, "El ticket ya está facturado.");
    const updated = await tx.billingAttempt.update({
      where: { id },
      data: {
        status: "SUBMITTING",
        submittedAt: new Date(),
        approvedAt: new Date(),
        approvedBy: userId,
        approvalHash: null,
        approvalExpiresAt: null,
      },
    });
    await event(tx, a, "USER_APPROVED");
    await setTicketState(tx, a, "PROCESSING");
    return updated;
  });
  if (claimed) {
    // The immutable context reviewed by the user is the only payload sent.
    try {
      await acceptResult(
        claimed,
        await portalAdapter(claimed.adapterKey).submit(
          contextOf(claimed),
          claimed.remoteSession!,
        ),
      );
    } catch {
      await fail(claimed, "SUBMIT_AMBIGUOUS");
    }
  }
  return billingHistory(attempt.ticketId);
}
export async function collectBilling(id: string) {
  const { userId, attempt } = await findAttempt(id);
  await enforceRateLimit("billing-collect:" + userId, 20, 3600);
  if (!attempt.submittedAt || !attempt.remoteSession)
    throw new ApiError(409, "No hay una solicitud enviada que consultar.");
  if (attempt.status !== "SUCCEEDED") {
    try {
      await acceptResult(
        attempt,
        await portalAdapter(attempt.adapterKey).collectResult(
          contextOf(attempt),
          attempt.remoteSession,
        ),
      );
    } catch {
      await fail(attempt, "DOWNLOAD_FAILED");
    }
  }
  return billingHistory(attempt.ticketId);
}
export async function cancelBilling(id: string) {
  const { organizationId, attempt } = await findAttempt(id);
  await getDb().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Ticket" WHERE id=${attempt.ticketId} AND "organizationId"=${organizationId} FOR UPDATE`;
    const changed = await tx.billingAttempt.updateMany({
      where: {
        id,
        organizationId,
        submittedAt: null,
        status: {
          in: [
            "PREPARING",
            "AWAITING_APPROVAL",
            "NEEDS_MANUAL_ACTION",
            "FAILED",
          ] as BillingAttemptStatus[],
        },
      },
      data: {
        status: "CANCELLED",
        activeKey: null,
        approvalHash: null,
        approvalExpiresAt: null,
        completedAt: new Date(),
      },
    });
    if (!changed.count)
      throw new ApiError(
        409,
        "Una solicitud enviada no puede cancelarse desde ORBIT.",
      );
    await event(tx, attempt, "CANCELLED");
    await setTicketState(tx, attempt, "NOT_REQUESTED");
  });
  return billingHistory(attempt.ticketId);
}
