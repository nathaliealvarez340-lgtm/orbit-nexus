import "server-only";
import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { z } from "zod";
import {
  isRecentSignIn,
  resolveCustody,
  type Custody,
} from "@/lib/csd/custody";
import { csdCustodyTerms } from "@/lib/csd/custody-terms";
import { CsdError } from "@/lib/csd/errors";
import type { CsdFile } from "@/lib/csd/validate";
import { getDb } from "@/lib/db";
import { ApiError, enforceRateLimit, readBody, readJson } from "@/lib/http";
import { requireTenant } from "@/lib/tenant";
import type { CsdCustodyTerms } from "@/types/csd";
import {
  canManageCsd,
  configureCsd,
  disableCsd,
  listCsdHistory,
  readCsdState,
  recordCsdConfigurationFailure,
  type ConfigureCsdInput,
  type CsdActor,
} from "./csd-store";

// Fase 5C.3 session layer for /api/csd. The Organization, user and role always come from
// the session (requireTenant); the body never carries an organizationId. Order (§M.1,
// §D.1): role → recent sign-in → rate limit → custody availability → body. Files and the
// password are never read before the recent sign-in check passes.

const multipartLimit = 64 * 1024;

async function csdActor(): Promise<CsdActor> {
  const tenant = await requireTenant();
  return {
    organizationId: tenant.organizationId,
    userId: tenant.userId,
    role: tenant.role,
  };
}

async function rateLimit(key: string, limit: number, windowSeconds: number) {
  try {
    await enforceRateLimit(key, limit, windowSeconds);
  } catch (error) {
    if (error instanceof ApiError && error.status === 429)
      throw new CsdError("CSD_RATE_LIMITED", 1);
    throw error;
  }
}

/** Read access: OWNER/ADMIN only, 120 requests per minute (§D, §T). */
async function reader() {
  const actor = await csdActor();
  if (!canManageCsd(actor.role)) throw new CsdError("CSD_FORBIDDEN");
  await rateLimit("csd-read:" + actor.userId, 120, 60);
  return actor;
}

/**
 * §D.1: the current session must come from a sign-in at most CSD_REAUTH_WINDOW_SECONDS
 * ago, measured with Session.createdAt like Better Auth's freshAge (a renewed session is
 * not recent). Better Auth's global configuration is not changed.
 */
async function hasRecentSignIn(actor: CsdActor) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  return (
    !!session &&
    session.user.id === actor.userId &&
    isRecentSignIn(new Date(session.session.createdAt))
  );
}

/** DENIED evidence for role or missing recent sign-in, written outside the request work. */
async function denied(
  actor: CsdActor,
  action: "csd.configuration.started" | "csd.disabled",
  reason: "ROLE" | "REAUTH_REQUIRED",
) {
  try {
    await recordAuditEvent(getDb(), {
      action,
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      result: "DENIED",
      metadata: { reason },
    });
  } catch {
    // The denial itself is what the caller reports.
  }
}

async function manager(action: "csd.configuration.started" | "csd.disabled") {
  const actor = await csdActor();
  if (!canManageCsd(actor.role)) {
    await denied(actor, action, "ROLE");
    throw new CsdError("CSD_FORBIDDEN", 1);
  }
  if (!(await hasRecentSignIn(actor))) {
    await denied(actor, action, "REAUTH_REQUIRED");
    throw new CsdError("CSD_REAUTH_REQUIRED", 1);
  }
  return actor;
}

export async function getMyCsdState() {
  const actor = await reader();
  return readCsdState(getDb(), actor, resolveCustody());
}

export async function getCsdCustodyTerms(): Promise<CsdCustodyTerms> {
  await reader();
  return csdCustodyTerms;
}

export async function getMyCsdHistory() {
  const actor = await reader();
  return listCsdHistory(getDb(), actor.organizationId);
}

async function fileField(
  form: FormData,
  name: string,
): Promise<CsdFile | null> {
  const value = form.get(name);
  if (!(value instanceof File)) return null;
  return { name: value.name, bytes: Buffer.from(await value.arrayBuffer()) };
}
const textField = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value : null;
};

/** POST /api/csd: configure or replace (§K, §M, §U). */
export async function configureMyCsd(request: Request) {
  const actor = await manager("csd.configuration.started");
  const db = getDb();
  let input: ConfigureCsdInput;
  let custody: Custody;
  try {
    await rateLimit("csd-configure:" + actor.userId, 5, 15 * 60);
    await rateLimit("csd-configure-org:" + actor.organizationId, 10, 3600);
    custody = resolveCustody();
    if (!custody.available) throw new CsdError("CSD_SERVICE_UNAVAILABLE", 1);
    input = await readConfiguration(request);
  } catch (error) {
    // Failures before configureCsd runs; it records its own.
    if (error instanceof CsdError)
      await recordCsdConfigurationFailure(db, actor, error);
    throw error;
  }
  try {
    await recordAuditEvent(db, {
      action: "csd.configuration.started",
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      metadata: { replace: input.replace },
    });
    return await configureCsd(db, actor, input, custody);
  } finally {
    input.certificate?.bytes.fill(0);
    input.privateKey?.bytes.fill(0);
    input.password = null;
  }
}

async function readConfiguration(request: Request): Promise<ConfigureCsdInput> {
  let body: Awaited<ReturnType<typeof readBody>>;
  try {
    body = await readBody(request, multipartLimit);
  } catch (error) {
    if (error instanceof ApiError && error.status === 413)
      throw new CsdError("CSD_FILE_TOO_LARGE", 4);
    throw new CsdError("CSD_FILES_REQUIRED", 3);
  }
  let form: FormData;
  try {
    form = await new Response(body, {
      headers: { "Content-Type": request.headers.get("content-type") || "" },
    }).formData();
  } catch {
    throw new CsdError("CSD_FILES_REQUIRED", 3);
  } finally {
    // The raw multipart holds the password and the .key in clear: overwrite it once it is
    // parsed (best effort; the parser's own copies cannot be wiped, contract §A.3).
    body.fill(0);
  }
  const input = {
    certificate: await fileField(form, "certificate"),
    privateKey: await fileField(form, "privateKey"),
    password: textField(form, "password"),
    custodyTermsVersion: textField(form, "custodyTermsVersion"),
    accepted: textField(form, "accepted") === "true",
    replace: textField(form, "replace") === "true",
    expectedActiveCsdId: textField(form, "expectedActiveCsdId"),
  };
  // Drop the parser references to the password and the key as early as possible; the JS
  // string itself cannot be wiped (contract §A.3).
  form.delete("password");
  form.delete("privateKey");
  return input;
}

const disableSchema = z.object({
  expectedActiveCsdId: z.string().min(1).max(100),
  confirm: z.literal(true),
});

/** POST /api/csd/disable (§L). */
export async function disableMyCsd(request: Request) {
  const actor = await manager("csd.disabled");
  await rateLimit("csd-disable:" + actor.userId, 10, 3600);
  const body = disableSchema.safeParse(await readJson(request));
  if (!body.success)
    throw new ApiError(400, "Confirma qué CSD quieres deshabilitar.");
  return disableCsd(getDb(), actor, body.data, resolveCustody());
}
