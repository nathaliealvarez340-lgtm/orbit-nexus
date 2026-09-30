import { z } from "zod";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/tenant";
import { apiError, assertSameOrigin, readJson } from "@/lib/http";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const data = z
      .object({ accent: z.enum(["PURPLE", "BLUE", "ORANGE", "RED"]) })
      .parse(await readJson(request));
    return Response.json(
      await getDb().userPreference.upsert({
        where: { userId: user.id },
        create: { userId: user.id, ...data },
        update: data,
      }),
    );
  } catch (e) {
    return apiError(e);
  }
}
