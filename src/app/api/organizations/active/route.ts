import { cookies } from "next/headers";
import { z } from "zod";
import { getDb } from "@/lib/db";
import {
  requireUser,
  tenantCookie,
  organizationCookieOptions,
} from "@/lib/tenant";
import { ApiError, apiError, assertSameOrigin, readJson } from "@/lib/http";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { organizationId } = z
      .object({ organizationId: z.string().max(100) })
      .parse(await readJson(request));
    const membership = await getDb().membership.findUnique({
      where: { organizationId_userId: { organizationId, userId: user.id } },
    });
    if (!membership) throw new ApiError(404, "Organización no disponible.");
    (await cookies()).set(
      tenantCookie,
      organizationId,
      organizationCookieOptions(),
    );
    return Response.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
