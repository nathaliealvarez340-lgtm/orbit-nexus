import "server-only";
import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "./auth";
import { getDb } from "./db";
import { ApiError } from "./http";

export const tenantCookie = "orbit.organization";
export async function requireUser() {
  const h = await headers();
  if (!h.get("cookie")?.includes("session_token="))
    throw new ApiError(401, "Inicia sesión para continuar.");
  const session = await getAuth().api.getSession({ headers: h });
  if (!session) throw new ApiError(401, "Inicia sesión para continuar.");
  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
  };
}
export async function requireTenant() {
  const user = await requireUser();
  const memberships = await getDb().membership.findMany({
    where: { userId: user.id },
    include: { organization: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const active = (await cookies()).get(tenantCookie)?.value;
  // The cookie is a preference only. Membership always authorizes the tenant.
  const membership = active
    ? memberships.find((m) => m.organizationId === active)
    : memberships[0];
  if (!membership)
    throw new ApiError(409, "Selecciona o crea una organización.");
  return {
    organizationId: membership.organizationId,
    userId: user.id,
    role: membership.role,
    user,
    organization: membership.organization,
    memberships,
  };
}
export async function requirePageTenant() {
  try {
    return await requireTenant();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect("/login");
    if (error instanceof ApiError && error.status === 409)
      redirect("/onboarding");
    throw error;
  }
}
export function requireAdmin(role: string) {
  if (!["OWNER", "ADMIN"].includes(role))
    throw new ApiError(
      403,
      "Solo un administrador puede cambiar el perfil fiscal.",
    );
}
export function organizationCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  };
}
