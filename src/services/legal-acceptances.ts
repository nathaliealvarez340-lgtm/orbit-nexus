import "server-only";
import { z } from "zod";
import { InvoiceApiError as CodedApiError } from "@/lib/invoice-api";
import { recordAuditEvent } from "@/lib/audit";
import { currentLegalDocument, legalDocumentKinds } from "@/lib/legal/registry";
import type { PrismaClient } from "@/generated/prisma/client";
import type {
  LegalAcceptanceState,
  LegalDocument,
  LegalDocumentKind,
} from "@/types/legal";

// Fase 5C.2 §5: acceptance is personal (account level) and bound to the exact text:
// version and content hash of the current PUBLISHED document. Drafts are never
// acceptable. One acceptance per user and version; repeating it is idempotent.
type Db = Pick<PrismaClient, "legalAcceptance" | "$transaction">;
type Current = (kind: LegalDocumentKind) => LegalDocument;

export const legalAcceptanceSchema = z.object({
  document: z.enum(["TERMS", "PRIVACY_NOTICE"]),
  version: z.string().trim().min(1).max(100),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
});

export async function legalAcceptanceStates(
  db: Pick<PrismaClient, "legalAcceptance">,
  userId: string,
  current: Current = currentLegalDocument,
): Promise<LegalAcceptanceState[]> {
  const documents = legalDocumentKinds.map(current);
  const accepted = await db.legalAcceptance.findMany({
    where: {
      userId,
      OR: documents.map((d) => ({ document: d.kind, version: d.version })),
    },
    select: { document: true, version: true, acceptedAt: true },
  });
  return documents.map((d) => {
    const row = accepted.find(
      (a) => a.document === d.kind && a.version === d.version,
    );
    return {
      document: d.kind,
      version: d.version,
      status: d.status,
      contentHash: d.contentHash,
      acceptable: d.status === "PUBLISHED",
      accepted: !!row,
      acceptedAt: row?.acceptedAt.toISOString() ?? null,
    };
  });
}

export async function acceptLegalDocument(
  db: Db,
  userId: string,
  body: unknown,
  current: Current = currentLegalDocument,
) {
  const input = legalAcceptanceSchema.parse(body);
  const document = current(input.document);
  if (document.status !== "PUBLISHED")
    throw new CodedApiError(
      409,
      "Este documento aún no está vigente y no puede aceptarse.",
      "LEGAL_DOCUMENT_NOT_PUBLISHED",
    );
  if (
    input.version !== document.version ||
    input.contentHash !== document.contentHash
  )
    throw new CodedApiError(
      409,
      "El documento cambió. Revisa la versión vigente antes de aceptarla.",
      "LEGAL_VERSION_OUTDATED",
    );
  return db.$transaction(async (tx) => {
    // ON CONFLICT DO NOTHING keeps concurrent or repeated acceptances to one record.
    const { count } = await tx.legalAcceptance.createMany({
      data: [
        {
          userId,
          document: document.kind,
          version: document.version,
          contentHash: document.contentHash,
        },
      ],
      skipDuplicates: true,
    });
    const acceptance = await tx.legalAcceptance.findUniqueOrThrow({
      where: {
        userId_document_version: {
          userId,
          document: document.kind,
          version: document.version,
        },
      },
    });
    if (count)
      await recordAuditEvent(tx, {
        action:
          document.kind === "TERMS" ? "legal.accepted" : "privacy.accepted",
        organizationId: null,
        actorUserId: userId,
        targetId: acceptance.id,
        metadata: { document: document.kind, version: document.version },
      });
    return {
      document: acceptance.document,
      version: acceptance.version,
      contentHash: acceptance.contentHash,
      acceptedAt: acceptance.acceptedAt.toISOString(),
      created: count > 0,
    };
  });
}
