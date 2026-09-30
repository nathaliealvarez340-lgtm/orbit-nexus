import { z } from "zod";
import { apiError, assertSameOrigin, readJson } from "@/lib/http";
import { notifications, markNotificationsRead } from "@/services/notifications";
export async function GET() {
  try {
    return Response.json(await notifications());
  } catch (e) {
    return apiError(e);
  }
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { id } = z
      .object({ id: z.string().min(1).max(100).optional() })
      .parse(await readJson(request));
    return Response.json(await markNotificationsRead(id));
  } catch (e) {
    return apiError(e);
  }
}
