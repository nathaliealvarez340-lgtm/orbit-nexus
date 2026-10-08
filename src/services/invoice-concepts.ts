import "server-only";
import { getDb } from "@/lib/db";
import { ApiError, enforceRateLimit } from "@/lib/http";
import { savedConceptSchema } from "@/lib/phase3-validation";
import type { SavedInvoiceConcept } from "@/types/invoice-studio";
import type { SavedInvoiceConcept as SavedConceptRow } from "@/generated/prisma/client";
import { requireInvoicePlan } from "./plans";

const maxConceptsPerOrganization = 1000;

export function savedConceptDto(row: SavedConceptRow): SavedInvoiceConcept {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    productCode: row.productCode,
    unitCode: row.unitCode,
    ...(row.defaultQuantity
      ? { defaultQuantity: row.defaultQuantity.toString() }
      : {}),
    ...(row.unitPrice ? { unitPrice: row.unitPrice.toFixed(2) } : {}),
    taxObject: row.taxObject,
    vatFactor: row.vatFactor === "EXENTO" ? "EXENTO" : "TASA",
    ...(row.vatRate ? { vatRate: row.vatRate.toString() } : {}),
    ...(row.withholdingVatRate
      ? { withholdingVatRate: row.withholdingVatRate.toString() }
      : {}),
    ...(row.withholdingIsrRate
      ? { withholdingIsrRate: row.withholdingIsrRate.toString() }
      : {}),
    active: row.active,
  };
}

function conceptData(input: unknown) {
  const { active, ...data } = savedConceptSchema.parse(input);
  return {
    active,
    data: {
      ...data,
      defaultQuantity: data.defaultQuantity ?? null,
      unitPrice: data.unitPrice ?? null,
      vatRate: data.vatRate ?? null,
      withholdingVatRate: data.withholdingVatRate ?? null,
      withholdingIsrRate: data.withholdingIsrRate ?? null,
    },
  };
}

export async function listInvoiceConcepts(
  search = "",
  includeInactive = false,
) {
  const { organizationId } = await requireInvoicePlan();
  const q = search.trim().slice(0, 100);
  const rows = await getDb().savedInvoiceConcept.findMany({
    where: {
      organizationId,
      ...(includeInactive ? {} : { active: true }),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { description: { contains: q, mode: "insensitive" } },
              { productCode: { startsWith: q } },
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
    take: 200,
  });
  return rows.map(savedConceptDto);
}

export async function createInvoiceConcept(input: unknown) {
  const { organizationId, userId } = await requireInvoicePlan();
  await enforceRateLimit("invoice-concepts:" + userId, 60, 60);
  const { active, data } = conceptData(input);
  return getDb().$transaction(async (tx) => {
    if (
      (await tx.savedInvoiceConcept.count({ where: { organizationId } })) >=
      maxConceptsPerOrganization
    )
      throw new ApiError(409, "Alcanzaste el máximo de conceptos guardados.");
    const row = await tx.savedInvoiceConcept.create({
      data: {
        ...data,
        active: active ?? true,
        organizationId,
        createdById: userId,
      },
    });
    await tx.activityLog.create({
      data: {
        organizationId,
        userId,
        action: "INVOICE_CONCEPT_CREATED",
        entityType: "SavedInvoiceConcept",
        entityId: row.id,
      },
    });
    return savedConceptDto(row);
  });
}

export async function updateInvoiceConcept(id: string, input: unknown) {
  const { organizationId, userId } = await requireInvoicePlan();
  await enforceRateLimit("invoice-concepts:" + userId, 60, 60);
  const { active, data } = conceptData(input);
  return getDb().$transaction(async (tx) => {
    if (
      !(await tx.savedInvoiceConcept.findFirst({
        where: { id, organizationId },
      }))
    )
      throw new ApiError(404, "Concepto no disponible.");
    // Invoices keep their own line snapshots; editing the template never alters them.
    const row = await tx.savedInvoiceConcept.update({
      where: { organizationId_id: { organizationId, id } },
      data: { ...data, ...(active === undefined ? {} : { active }) },
    });
    await tx.activityLog.create({
      data: {
        organizationId,
        userId,
        action: "INVOICE_CONCEPT_UPDATED",
        entityType: "SavedInvoiceConcept",
        entityId: id,
      },
    });
    return savedConceptDto(row);
  });
}

export async function deactivateInvoiceConcept(id: string) {
  const { organizationId, userId } = await requireInvoicePlan();
  await enforceRateLimit("invoice-concepts:" + userId, 60, 60);
  return getDb().$transaction(async (tx) => {
    const result = await tx.savedInvoiceConcept.updateMany({
      where: { id, organizationId },
      data: { active: false },
    });
    if (!result.count) throw new ApiError(404, "Concepto no disponible.");
    await tx.activityLog.create({
      data: {
        organizationId,
        userId,
        action: "INVOICE_CONCEPT_DEACTIVATED",
        entityType: "SavedInvoiceConcept",
        entityId: id,
      },
    });
    return { ok: true };
  });
}
