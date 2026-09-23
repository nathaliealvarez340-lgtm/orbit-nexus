import { cookies } from "next/headers";
import { z } from "zod";
import { getDb } from "@/lib/db";
import {
  requireUser,
  tenantCookie,
  organizationCookieOptions,
} from "@/lib/tenant";
import {
  apiError,
  assertSameOrigin,
  enforceRateLimit,
  readJson,
} from "@/lib/http";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    await enforceRateLimit(`organization:${user.id}`, 5, 3600);
    const { name } = z
      .object({ name: z.string().trim().min(2).max(100) })
      .parse(await readJson(request));
    const org = await getDb().$transaction(async (tx) => {
      const first =
        (await tx.membership.count({ where: { userId: user.id } })) === 0;
      const org = await tx.organization.create({
        data: {
          name,
          memberships: { create: { userId: user.id, role: "OWNER" } },
        },
      });
      await tx.activityLog.create({
        data: {
          organizationId: org.id,
          userId: user.id,
          action: first ? "USER_REGISTERED" : "ORGANIZATION_CREATED",
          entityType: "Organization",
          entityId: org.id,
        },
      });
      return org;
    });
    (await cookies()).set(tenantCookie, org.id, organizationCookieOptions());
    return Response.json({ id: org.id }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
