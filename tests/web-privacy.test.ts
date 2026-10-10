import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseConsent,
  COOKIE_POLICY_VERSION,
  CONSENT_MAX_AGE,
} from "../src/lib/consent";
import { sanitizeAnalytics } from "../src/lib/analytics-policy";
import { safeFormError, errorFields } from "../src/lib/form-errors";
import { legalContent } from "../src/lib/legal-content";
import { siteOrigin, publicPaths } from "../src/lib/web-metadata";
test("web consent expires, requires current policy/date/essential and strips arbitrary sensitive keys", () => {
  const valid = {
    version: COOKIE_POLICY_VERSION,
    necessary: true,
    analytics: true,
    chosenAt: new Date().toISOString(),
  };
  const encode = (value: unknown) => encodeURIComponent(JSON.stringify(value));
  assert.deepEqual(
    parseConsent(
      encode({
        ...valid,
        rfc: "discard",
        organizationId: "discard",
        marketing: true,
      }),
    ),
    valid,
  );
  for (const override of [
    { necessary: false },
    { version: 1 },
    { version: "old" },
    { analytics: "yes" },
    { chosenAt: "invalid" },
    { chosenAt: new Date(Date.now() + 60000).toISOString() },
    {
      chosenAt: new Date(
        Date.now() - (CONSENT_MAX_AGE + 1) * 1000,
      ).toISOString(),
    },
  ])
    assert.equal(parseConsent(encode({ ...valid, ...override })), null);
  assert.equal(parseConsent("%bad"), null);
});
test("analytics drops custom events, private IDs, foreign origins and revoked consent, strips query/hash/extra payload", () => {
  const origin = "http://localhost:3101";
  const event = {
    type: "pageview" as const,
    url: `${origin}/dashboard/reports?token=private#rfc`,
    data: { email: "private" },
  };
  assert.deepEqual(sanitizeAnalytics(event, true, origin), {
    type: "pageview",
    url: `${origin}/dashboard/reports`,
  });
  assert.equal(sanitizeAnalytics(event, false, origin), null);
  for (const path of [
    "/reset-password?token=private",
    "/api/documents/private-id",
    "/dashboard/invoices/drafts/private-id",
    "/dashboard/clients",
    "/dashboard/fiscal-profile",
  ])
    assert.equal(
      sanitizeAnalytics({ type: "pageview", url: origin + path }, true, origin),
      null,
    );
  assert.equal(
    sanitizeAnalytics({ type: "event", url: origin }, true, origin),
    null,
  );
  assert.equal(
    sanitizeAnalytics(
      { type: "pageview", url: "https://elsewhere.test/" },
      true,
      origin,
    ),
    null,
  );
});
test("legal presentation cannot imply approval or invent dates and identities", () => {
  for (const content of Object.values(legalContent)) {
    assert.equal(content.approved, false);
    assert.equal(content.version, null);
    assert.equal(content.effectiveDate, null);
    assert(content.sections.length > 0);
  }
  assert.notEqual(legalContent.privacy.title, legalContent.terms.title);
});
test("SEO uses configured origin and public sitemap allowlist, never sensitive paths", () => {
  assert.equal(
    siteOrigin({ BETTER_AUTH_URL: "https://orbitne.com/" }),
    "https://orbitne.com",
  );
  for (const value of [
    "javascript:alert(1)",
    "https://user:secret@example.test",
    "https://example.test?token=x",
  ])
    assert.equal(siteOrigin({ BETTER_AUTH_URL: value }), null);
  assert(
    publicPaths.every((path) => !/dashboard|api|reset|onboarding/.test(path)),
  );
});
test("form errors keep normalized backend messages and do not render unknown internals", () => {
  assert.equal(
    safeFormError({ error: "Revisa los campos indicados." }, "fallback"),
    "Revisa los campos indicados.",
  );
  assert.equal(
    safeFormError(
      { error: "SELECT * FROM User; Prisma stack private email" },
      "fallback",
    ),
    "fallback",
  );
  assert.deepEqual(
    errorFields({ fields: { name: ["private"], secret: ["x"] } }, ["name"]),
    ["name"],
  );
});
