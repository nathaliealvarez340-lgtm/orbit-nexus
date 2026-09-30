import "server-only";
import { getDb } from "@/lib/db";
import { requireTenant } from "@/lib/tenant";
import { ApiError, enforceRateLimit } from "@/lib/http";
import { clientSchema } from "@/lib/phase3-validation";
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
  const data = clientSchema.parse(input);
  return getDb().$transaction(async (tx) => {
    if (
      id &&
      !(await tx.client.findFirst({
        where: { id, organizationId, archivedAt: null },
      }))
    )
      throw new ApiError(404, "Cliente no disponible.");
    const result = id
      ? await tx.client.update({
          where: { organizationId_id: { organizationId, id } },
          data,
        })
      : await tx.client.create({ data: { ...data, organizationId } });
    await tx.activityLog.create({
      data: {
        organizationId,
        userId,
        action: id ? "CLIENT_UPDATED" : "CLIENT_CREATED",
        entityType: "Client",
        entityId: result.id,
      },
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
    return { ok: true };
  });
}
