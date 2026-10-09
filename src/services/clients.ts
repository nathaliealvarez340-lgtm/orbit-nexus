import "server-only";
import { getDb } from "@/lib/db";
import { requireTenant } from "@/lib/tenant";
import { ApiError, enforceRateLimit } from "@/lib/http";
import { clientSchema } from "@/lib/phase3-validation";
import type { Prisma } from "@/generated/prisma/client";
import { revertReadyInvoices } from "./outgoing-invoices";

// Receiver data copied into invoice snapshots; changing any of them invalidates READY.
const receiverFiscalFields = [
  "rfc",
  "legalName",
  "personType",
  "fiscalRegime",
  "postalCode",
  "foreignTaxId",
  "country",
] as const;

/**
 * The server-side rule that allows editing a client: an authorized member of the active
 * Organization (requireTenant) acting on a non-archived client of that Organization.
 * Every client CSF operation (upload, consent, extraction, confirmation) reuses it.
 */
export function findEditableClient(
  db: Prisma.TransactionClient,
  organizationId: string,
  clientId: string,
) {
  return db.client.findFirst({
    where: { id: clientId, organizationId, archivedAt: null },
  });
}

export async function listClients(search = "", archived = false) {
  const { organizationId } = await requireTenant();
  return getDb().client.findMany({
    where: {
      organizationId,
      archivedAt: archived ? undefined : null,
      OR: [
        { legalName: { contains: search.slice(0, 100), mode: "insensitive" } },
        { rfc: { contains: search.slice(0, 100), mode: "insensitive" } },
      ],
    },
    orderBy: { legalName: "asc" },
    take: 500,
  });
}
export async function saveClient(input: unknown, id?: string) {
  const { organizationId, userId } = await requireTenant();
  await enforceRateLimit("clients:" + userId, 60, 60);
  const { confirmed, extractionId, ...data } = clientSchema.parse(input);
  return getDb().$transaction(async (tx) => {
    const previous = id
      ? await findEditableClient(tx, organizationId, id)
      : null;
    if (id && !previous) throw new ApiError(404, "Cliente no disponible.");
    // Fase 5C §10.9: reviewed data from a client CSF extraction of this same client.
    let provenance = {};
    if (extractionId) {
      const extraction = id
        ? await tx.fiscalDocumentExtraction.findFirst({
            where: {
              id: extractionId,
              organizationId,
              purpose: "CLIENT_FISCAL_PREFILL",
              clientId: id,
            },
            select: { documentId: true },
          })
        : null;
      if (!extraction)
        throw new ApiError(404, "Extracción no disponible para este cliente.");
      provenance = {
        csfDocumentId: extraction.documentId,
        sourceExtractionId: extractionId,
      };
    }
    if (confirmed)
      provenance = {
        ...provenance,
        confirmedAt: new Date(),
        confirmedById: userId,
      };
    const result = id
      ? await tx.client.update({
          where: { organizationId_id: { organizationId, id } },
          data: { ...data, ...provenance },
        })
      : await tx.client.create({
          data: { ...data, ...provenance, organizationId },
        });
    await tx.activityLog.create({
      data: {
        organizationId,
        userId,
        action: id ? "CLIENT_UPDATED" : "CLIENT_CREATED",
        entityType: "Client",
        entityId: result.id,
      },
    });
    // Contract §11.3: READY invoices for this receiver must be revalidated.
    if (
      previous &&
      receiverFiscalFields.some(
        (key) => (previous[key] ?? "") !== (result[key] ?? ""),
      )
    )
      await revertReadyInvoices(tx, {
        organizationId,
        userId,
        clientId: result.id,
        reason: "CLIENT_UPDATED",
      });
    return result;
  });
}
export async function archiveClient(id: string) {
  const { organizationId, userId } = await requireTenant();
  return getDb().$transaction(async (tx) => {
    const result = await tx.client.updateMany({
      where: { id, organizationId, archivedAt: null },
      data: { archivedAt: new Date() },
    });
    if (!result.count) throw new ApiError(404, "Cliente no disponible.");
    await tx.activityLog.create({
      data: {
        organizationId,
        userId,
        action: "CLIENT_ARCHIVED",
        entityType: "Client",
        entityId: id,
      },
    });
    await revertReadyInvoices(tx, {
      organizationId,
      userId,
      clientId: id,
      reason: "CLIENT_ARCHIVED",
    });
    return { ok: true };
  });
}
