import "server-only";
import { ApiError } from "@/lib/http";
import type { PrismaClient } from "@/generated/prisma/client";
import type { AuditEventDto, AuditEventPage } from "@/types/audit";

const pageSize = { default: 50, max: 100 };

/** `organizationId` must come from a server-validated tenant. */
export async function listAuditEvents(
  db: Pick<PrismaClient, "auditEvent">,
  organizationId: string,
  options: { limit?: string | null; before?: string | null } = {},
): Promise<AuditEventPage> {
  const requested = Math.floor(Number(options.limit ?? pageSize.default));
  const limit =
    Number.isFinite(requested) && requested > 0
      ? Math.min(requested, pageSize.max)
      : pageSize.default;
  const before = options.before ? new Date(options.before) : null;
  if (before && Number.isNaN(before.getTime()))
    throw new ApiError(400, "Fecha de consulta inválida.");
  const rows = await db.auditEvent.findMany({
    where: {
      organizationId,
      ...(before ? { createdAt: { lt: before } } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: {
      id: true,
      action: true,
      targetType: true,
      targetId: true,
      result: true,
      metadata: true,
      createdAt: true,
      actor: { select: { id: true, name: true } },
    },
  });
  const events: AuditEventDto[] = rows.slice(0, limit).map((row) => ({
    id: row.id,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    result: row.result,
    actor: row.actor,
    metadata: (row.metadata as AuditEventDto["metadata"]) ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
  return {
    events,
    nextBefore: rows.length > limit ? (events.at(-1)?.createdAt ?? null) : null,
  };
}
