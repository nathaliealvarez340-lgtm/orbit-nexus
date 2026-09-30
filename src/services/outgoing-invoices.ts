import "server-only";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/tenant";
import { ApiError, enforceRateLimit } from "@/lib/http";
import { draftSchema, settingsSchema } from "@/lib/phase3-validation";
import { fiscalProfileComplete } from "@/lib/fiscal-catalogs";
import { invoiceTotals } from "@/lib/invoice-totals";
import { requireInvoicePlan } from "./plans";
export async function outgoingContext() {
  const tenant = await requireInvoicePlan();
  const db = getDb(),
    organizationId = tenant.organizationId;
  const [profile, settings, clients, drafts] = await Promise.all([
    db.fiscalProfile.findUnique({ where: { organizationId } }),
    db.invoiceSettings.findUnique({ where: { organizationId } }),
    db.client.findMany({
      where: { organizationId, archivedAt: null },
      orderBy: { legalName: "asc" },
      take: 500,
    }),
    db.stampedInvoice.findMany({
      where: { organizationId, status: "DRAFT" },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);
  return { tenant, profile, settings, clients, drafts };
}
export async function saveInvoiceSettings(input: unknown) {
  const { organizationId, userId, role } = await requireInvoicePlan();
  requireAdmin(role);
  const data = settingsSchema.parse(input);
  return getDb().$transaction(async (tx) => {
    if (
      !(await tx.document.findFirst({
        where: {
          id: data.logoDocumentId,
          organizationId,
          kind: "INVOICE_LOGO",
        },
      }))
    )
      throw new ApiError(400, "Carga un logo válido de esta empresa.");
    const settings = await tx.invoiceSettings.upsert({
      where: { organizationId },
      create: { organizationId, ...data },
      update: data,
    });
    await tx.activityLog.create({
      data: {
        organizationId,
        userId,
        action: "INVOICE_SETTINGS_UPDATED",
        entityType: "InvoiceSettings",
      },
    });
    return settings;
  });
}
export async function createInvoiceDraft(input: unknown) {
  const { organizationId, userId } = await requireInvoicePlan();
  await enforceRateLimit("draft:" + userId, 30, 60);
  const data = draftSchema.parse(input),
    totals = invoiceTotals(data.concepts);
  if (totals.total.greaterThanOrEqualTo("10000000000"))
    throw new ApiError(400, "Importe fuera de rango.");
  return getDb().$transaction(async (tx) => {
    const profile = await tx.fiscalProfile.findUnique({
      where: { organizationId },
    });
    if (!profile || !fiscalProfileComplete(profile))
      throw new ApiError(
        409,
        "Completa el perfil fiscal, dirección y constancia PDF.",
      );
    const client = await tx.client.findFirst({
      where: { id: data.clientId, organizationId, archivedAt: null },
    });
    if (!client) throw new ApiError(404, "Cliente no disponible.");
    const configured = await tx.invoiceSettings.findUnique({
      where: { organizationId },
    });
    if (!configured?.logoDocumentId)
      throw new ApiError(
        409,
        "Configura el logo y la administración de facturas.",
      );
    // Atomic row update allocates one sequence per tenant, even for simultaneous requests.
    const settings = await tx.invoiceSettings.update({
      where: { organizationId },
      data: { nextNumber: { increment: 1 } },
    });
    const sequence = settings.nextNumber - 1;
    if (sequence > 999999999) throw new ApiError(409, "Secuencia agotada.");
    const result = await tx.stampedInvoice.create({
      data: {
        organizationId,
        userId,
        clientId: client.id,
        status: "DRAFT",
        sequence,
        folio: settings.prefix + "-" + String(sequence).padStart(6, "0"),
        issuerRfc: profile.rfc,
        receiverRfc: client.rfc,
        invoiceDate: new Date(data.invoiceDate + "T00:00:00Z"),
        currency: data.currency,
        documentType: data.documentType,
        cfdiUse: data.cfdiUse,
        paymentForm: data.paymentForm,
        paymentMethod: data.paymentMethod,
        issuerSnapshot: JSON.parse(JSON.stringify(profile)),
        receiverSnapshot: JSON.parse(JSON.stringify(client)),
        templateSnapshot: {
          color: settings.color,
          template: settings.template,
          logoDocumentId: settings.logoDocumentId,
        },
        subtotal: totals.subtotal,
        tax: totals.tax,
        total: totals.total,
        concepts: {
          create: data.concepts.map((c, i) => ({
            ...c,
            total: totals.lines[i].total,
          })),
        },
      },
    });
    await tx.activityLog.create({
      data: {
        organizationId,
        userId,
        action: "INVOICE_DRAFT_CREATED",
        entityType: "StampedInvoice",
        entityId: result.id,
      },
    });
    return { id: result.id, folio: result.folio, status: result.status };
  });
}
export async function getOutgoingInvoice(id: string) {
  const { organizationId } = await requireInvoicePlan();
  const result = await getDb().stampedInvoice.findFirst({
    where: { id, organizationId },
    include: { concepts: true },
  });
  if (!result) throw new ApiError(404, "Factura no disponible.");
  return result;
}
export async function issuedInvoices() {
  const { organizationId } = await requireInvoicePlan();
  return getDb().stampedInvoice.findMany({
    where: {
      organizationId,
      status: "ISSUED",
      uuid: { not: null },
      issuedAt: { not: null },
    },
    orderBy: { issuedAt: "desc" },
    take: 500,
  });
}
