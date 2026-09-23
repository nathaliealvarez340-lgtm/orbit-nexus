import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { authOrigin } from "@/lib/auth-origin";
import { activeMembership } from "@/lib/active-membership";
import { getDb } from "@/lib/db";
import { ApiError, apiError } from "@/lib/http";
import {
  requireUser,
  tenantCookie,
  organizationCookieOptions,
} from "@/lib/tenant";

// A full navigation verifies the newly issued session and clears stale router data.
// The destination and workspace come exclusively from server-side membership data.
export async function GET() {
  try {
    const origin = authOrigin();
    const user = await requireUser().catch((error) => {
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    });
    if (!user) return NextResponse.redirect(new URL("/login", origin));
    const memberships = await getDb().membership.findMany({
      where: { userId: user.id },
      select: { organizationId: true },
    });
    const preferred = (await cookies()).get(tenantCookie)?.value;
    const validPreference = memberships.find(
      (m) => m.organizationId === preferred,
    );
    const membership = activeMembership(
      memberships,
      validPreference?.organizationId,
    );
    const response = NextResponse.redirect(
      new URL(membership ? "/dashboard" : "/onboarding", origin),
    );
    response.cookies.set(tenantCookie, membership?.organizationId || "", {
      ...organizationCookieOptions(),
      ...(membership ? {} : { maxAge: 0 }),
    });
    return response;
  } catch (error) {
    return apiError(error);
  }
}
