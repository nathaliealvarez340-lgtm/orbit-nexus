import { z } from "zod";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/tenant";
import {
  apiError,
  assertSameOrigin,
  readJson,
  enforceRateLimit,
} from "@/lib/http";
import {
  preferencesForSession,
  updateUserPreferences,
  PreferencesError,
} from "@/services/user-preferences";
function preferenceError(error: unknown) {
  if (error instanceof PreferencesError)
    return Response.json({ code: error.code }, { status: error.status });
  if (error instanceof z.ZodError)
    return Response.json(
      { code: "PREFERENCES_INVALID", fields: error.flatten().fieldErrors },
      { status: 400 },
    );
  return apiError(error);
}
export async function GET() {
  try {
    return Response.json(await preferencesForSession(), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return preferenceError(error);
  }
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    await enforceRateLimit(`preferences:${user.id}`, 60, 60);
    return Response.json(
      await updateUserPreferences(getDb(), user.id, await readJson(request)),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return preferenceError(e);
  }
}
