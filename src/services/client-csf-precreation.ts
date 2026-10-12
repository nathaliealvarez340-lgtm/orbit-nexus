import "server-only";
import { getDb } from "@/lib/db";
import { InvoiceApiError as CodedApiError } from "@/lib/invoice-api";
import { recordAuditEvent } from "@/lib/audit";
import { logSafeError } from "@/lib/security/redact";
import {
  precreationCsfDocumentId,
  precreationCsfExpired,
  precreationCsfTtlMs,
} from "@/lib/csf/precreation";
import type { Prisma } from "@/generated/prisma/client";

// Client CSF read before the client exists (docs/tasks/CLIENT-CSF-PRECREATION.md).
//
// Lifecycle of the temporary resource, which is the private Document itself:
//   PENDING   kind CLIENT_CSF, uploaded by this user, linked to no client, < 24 h old.
//             Only its uploader may read it, authorize its reading or link it.
//   LINKED    a new client was created with its reference (Client.csfDocumentId), or it
//             was used for an existing client. It is a normal client document from then on.
//   EXPIRED   PENDING older than 24 h: unusable, then deleted with its consents and
//             extractions by purgeAbandonedClientCsf.
// No new table: Document, FiscalDocumentConsent and FiscalDocumentExtraction already carry
// Organization, user, creation time and a nullable clientId.

type Db = Prisma.TransactionClient;

const notAvailable = () =>
  new CodedApiError(
    404,
    "La constancia no está disponible para crear un cliente. Cárgala de nuevo.",
    "PRECREATION_CSF_NOT_AVAILABLE",
  );
const expired = () =>
  new CodedApiError(
    410,
    "La constancia cargada venció. Cárgala de nuevo o guarda el cliente sin ella.",
    "PRECREATION_CSF_EXPIRED",
  );
const consumed = () =>
  new CodedApiError(
    409,
    "Esta constancia ya está asociada a un cliente.",
    "PRECREATION_CSF_CONSUMED",
  );

/** Whether a client CSF Document already belongs to a client. */
export async function clientCsfLinked(
  db: Db,
  organizationId: string,
  documentId: string,
) {
  const [client, consent, extraction] = [
    await db.client.findFirst({
      where: { organizationId, csfDocumentId: documentId },
      select: { id: true },
    }),
    await db.fiscalDocumentConsent.findFirst({
      where: { organizationId, documentId, clientId: { not: null } },
      select: { id: true },
    }),
    await db.fiscalDocumentExtraction.findFirst({
      where: { organizationId, documentId, clientId: { not: null } },
      select: { id: true },
    }),
  ];
  return !!(client || consent || extraction);
}

/** A PENDING pre-creation CSF of this user, or a coded error saying why it is not. */
export async function assertPendingClientCsf(
  db: Db,
  session: { organizationId: string; userId: string },
  documentId: string,
  now = new Date(),
) {
  const document = await db.document.findFirst({
    where: {
      id: documentId,
      organizationId: session.organizationId,
      kind: "CLIENT_CSF",
      uploadedById: session.userId,
    },
    select: { id: true, createdAt: true },
  });
  if (!document) throw notAvailable();
  if (await clientCsfLinked(db, session.organizationId, documentId))
    throw consumed();
  if (precreationCsfExpired(document.createdAt, now)) throw expired();
  return document;
}

/**
 * Inside the client-creation transaction: resolves the reference, locks its Document so
 * two creations cannot both take it, and checks the optional extraction belongs to it.
 */
export async function claimPrecreationCsf(
  tx: Db,
  session: { organizationId: string; userId: string },
  reference: string,
  extractionId: string | undefined,
  now = new Date(),
) {
  const documentId = precreationCsfDocumentId(reference, session);
  if (!documentId) throw notAvailable();
  await tx.$queryRaw`SELECT "id" FROM "Document" WHERE "id" = ${documentId} AND "organizationId" = ${session.organizationId} FOR UPDATE`;
  await assertPendingClientCsf(tx, session, documentId, now);
  if (!extractionId) return { documentId, extractionId: null };
  const extraction = await tx.fiscalDocumentExtraction.findFirst({
    where: {
      id: extractionId,
      organizationId: session.organizationId,
      documentId,
      purpose: "CLIENT_FISCAL_PREFILL",
      createdById: session.userId,
      clientId: null,
    },
    select: { id: true },
  });
  if (!extraction)
    throw new CodedApiError(
      404,
      "La lectura no corresponde a esta constancia.",
      "EXTRACTION_NOT_AVAILABLE",
    );
  return { documentId, extractionId: extraction.id };
}

/** Records which client the pre-creation reading ended in; a second use fails. */
export async function consumePrecreationExtraction(
  tx: Db,
  organizationId: string,
  extractionId: string,
  clientId: string,
) {
  const { count } = await tx.fiscalDocumentExtraction.updateMany({
    where: { id: extractionId, organizationId, clientId: null },
    data: { clientId },
  });
  if (count !== 1) throw consumed();
}

/**
 * Deletes abandoned pre-creation CSF (EXPIRED and never linked) with their consents and
 * extractions, oldest first and bounded per call. It runs on every client CSF upload, so
 * no abandoned PDF outlives the next upload of any Organization; a scheduled job can call
 * it too. Each deletion is audited without file contents.
 */
export async function purgeAbandonedClientCsf(now = new Date(), limit = 20) {
  const db = getDb();
  const abandoned = (cutoff: Date) =>
    ({
      kind: "CLIENT_CSF",
      createdAt: { lte: cutoff },
      csfClients: { none: {} },
      fiscalConsents: { none: { clientId: { not: null } } },
      fiscalExtractions: { none: { clientId: { not: null } } },
    }) satisfies Prisma.DocumentWhereInput;
  const cutoff = new Date(now.getTime() - precreationCsfTtlMs);
  const candidates = await db.document.findMany({
    where: abandoned(cutoff),
    select: { id: true, organizationId: true },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  let purged = 0;
  for (const { id, organizationId } of candidates) {
    try {
      const deleted = await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Document" WHERE "id" = ${id} FOR UPDATE`;
        // Re-checked under the lock: a concurrent link wins and the file stays.
        const still = await tx.document.findFirst({
          where: { id, ...abandoned(cutoff) },
          select: { id: true },
        });
        if (!still) return false;
        await tx.fiscalDocumentExtraction.deleteMany({
          where: { organizationId, documentId: id },
        });
        await tx.fiscalDocumentConsent.deleteMany({
          where: { organizationId, documentId: id },
        });
        await tx.document.delete({ where: { id } });
        await recordAuditEvent(tx, {
          action: "sensitive_asset.deleted",
          organizationId,
          actorUserId: null,
          targetId: id,
          metadata: { kind: "CLIENT_CSF", reason: "PRECREATION_EXPIRED" },
        });
        return true;
      });
      if (deleted) purged++;
    } catch (error) {
      logSafeError("client-csf-purge", error);
    }
  }
  return purged;
}
