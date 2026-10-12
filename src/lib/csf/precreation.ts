import "server-only";
import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

// Client CSF before the client exists (docs/tasks/CLIENT-CSF-PRECREATION.md). The
// uploaded Document is the temporary private resource; this reference is the only way to
// link it to a new client. It is an HMAC over Organization + user + Document, keyed by a
// value derived from BETTER_AUTH_SECRET for this single purpose: unpredictable, useless
// outside the session that uploaded it, never a file URL and never stored. The database
// state (owner, expiry, not yet linked) is still checked on every use.

/** A pre-creation CSF can be read and linked to a new client for 24 hours. */
export const precreationCsfTtlMs = 24 * 60 * 60 * 1000;

export const precreationCsfExpiresAt = (createdAt: Date) =>
  new Date(createdAt.getTime() + precreationCsfTtlMs);

export const precreationCsfExpired = (createdAt: Date, now = new Date()) =>
  now.getTime() >= precreationCsfExpiresAt(createdAt).getTime();

type Binding = { organizationId: string; userId: string; documentId: string };

const version = "v1";
const documentIdPattern = /^[A-Za-z0-9_-]{1,100}$/;

function key(env: Record<string, string | undefined> = process.env) {
  const secret = env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("AUTH_NOT_CONFIGURED");
  return Buffer.from(
    hkdfSync(
      "sha256",
      secret,
      "orbit-nexus",
      "client-csf-precreation-reference/" + version,
      32,
    ),
  );
}

function mac(binding: Binding, env?: Record<string, string | undefined>) {
  return createHmac("sha256", key(env))
    .update(
      [
        version,
        binding.organizationId,
        binding.userId,
        binding.documentId,
      ].join("\n"),
    )
    .digest();
}

export function precreationCsfReference(
  binding: Binding,
  env?: Record<string, string | undefined>,
) {
  if (!documentIdPattern.test(binding.documentId))
    throw new Error("INVALID_DOCUMENT_ID");
  return `${version}.${binding.documentId}.${mac(binding, env).toString("base64url")}`;
}

/**
 * The Document id the reference was issued for, or null when it is malformed, forged,
 * or belongs to another Organization or user.
 */
export function precreationCsfDocumentId(
  reference: string,
  session: { organizationId: string; userId: string },
  env?: Record<string, string | undefined>,
): string | null {
  const [prefix, documentId, signature, ...rest] = reference.split(".");
  if (
    prefix !== version ||
    rest.length ||
    !documentId ||
    !documentIdPattern.test(documentId) ||
    !signature ||
    !/^[A-Za-z0-9_-]{43}$/.test(signature)
  )
    return null;
  const expected = mac({ ...session, documentId }, env);
  const received = Buffer.from(signature, "base64url");
  return received.length === expected.length &&
    timingSafeEqual(received, expected)
    ? documentId
    : null;
}
