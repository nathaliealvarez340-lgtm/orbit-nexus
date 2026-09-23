import { getAuth } from "@/lib/auth";
import { apiError, readBody } from "@/lib/http";
import { tenantCookie, organizationCookieOptions } from "@/lib/tenant";

async function handle(request: Request) {
  try {
    if (request.method === "POST") {
      const body = await readBody(request, 32768);
      request = new Request(request.url, {
        method: "POST",
        headers: request.headers,
        body,
      });
    }
    const response = await getAuth().handler(request);
    if (
      response.ok &&
      request.method === "POST" &&
      new URL(request.url).pathname === "/api/auth/sign-out"
    ) {
      // Keep Better Auth's raw Set-Cookie headers: Next's mutable-cookie merge
      // in 16.3.5 drops Max-Age=0 while parsing provider deletion cookies.
      const headers = new Headers(response.headers);
      headers.append(
        "Set-Cookie",
        `${tenantCookie}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax${organizationCookieOptions().secure ? "; Secure" : ""}`,
      );
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }
    return response;
  } catch (error) {
    // Log only known configuration codes; never credentials, URLs or provider errors.
    if (
      error instanceof Error &&
      [
        "AUTH_NOT_CONFIGURED",
        "DATABASE_NOT_CONFIGURED",
        "BETTER_AUTH_URL_REQUIRED",
        "BETTER_AUTH_URL_INVALID",
      ].includes(error.message)
    ) {
      console.error("[orbit/auth] configuration:", error.message);
    }
    return apiError(error);
  }
}
export const GET = handle;
export const POST = handle;
