import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { authOrigin } from "../src/lib/auth-origin";
import { activeMembership } from "../src/lib/active-membership";
import { registerSchema } from "../src/lib/validation";

test("production auth origin is explicit, HTTPS and identical to the trusted origin", () => {
  assert.throws(() => authOrigin({ NODE_ENV: "production" }));
  assert.equal(
    authOrigin({ NODE_ENV: "development" }),
    "http://localhost:3000",
  );
  assert.equal(
    authOrigin({
      NODE_ENV: "production",
      VERCEL: "1",
      BETTER_AUTH_URL: "https://orbitne.com",
    }),
    "https://orbitne.com",
  );
  assert.equal(
    authOrigin({
      NODE_ENV: "production",
      BETTER_AUTH_URL: "https://orbit.example.test/",
    }),
    "https://orbit.example.test",
  );
  for (const value of [
    "http://orbit.example.test",
    "https://user:secret@orbit.example.test",
    "https://orbit.example.test/api/auth",
    "https://orbit.example.test?redirect=elsewhere",
    "https://orbit.example.test#fragment",
    "javascript:alert(1)",
    "https://*.orbitne.com",
    "not-a-url",
  ])
    assert.throws(() =>
      authOrigin({ NODE_ENV: "production", BETTER_AUTH_URL: value }),
    );
  assert.throws(() =>
    authOrigin({
      NODE_ENV: "production",
      VERCEL: "1",
      BETTER_AUTH_URL: "http://localhost:3000",
    }),
  );
  assert.throws(() =>
    authOrigin({
      NODE_ENV: "production",
      VERCEL: "1",
      BETTER_AUTH_URL: "https://127.0.0.1",
    }),
  );
});
test("workspace selection never implicitly chooses between multiple memberships or trusts a foreign cookie", () => {
  const memberships = [
    { organizationId: "a", role: "OWNER" },
    { organizationId: "b", role: "MEMBER" },
  ];
  assert.equal(activeMembership([], "a"), undefined);
  assert.equal(activeMembership(memberships), undefined);
  assert.equal(activeMembership(memberships, "foreign"), undefined);
  assert.equal(activeMembership(memberships, "b")?.role, "MEMBER");
  assert.equal(activeMembership([memberships[0]])?.organizationId, "a");
});
test("registration requires matching confirmation and valid account fields", () => {
  const valid = {
    name: "Usuario",
    email: "test@example.test",
    password: "OrbitSecure2026!",
    confirm: "OrbitSecure2026!",
  };
  assert(registerSchema.safeParse(valid).success);
  for (const overrides of [
    { confirm: "different" },
    { confirm: "" },
    { name: "x" },
    { email: "invalid" },
    { password: "short", confirm: "short" },
  ])
    assert(!registerSchema.safeParse({ ...valid, ...overrides }).success);
});
test("auth entrypoints use the real auth client and contain no demo success path", async () => {
  const form = await readFile("src/components/forms/auth-form.tsx", "utf8");
  assert.match(form, /authClient\.signUp\.email/);
  assert.match(form, /authClient\.signIn\.email/);
  for (const file of [
    "src/components/forms/auth-form.tsx",
    "src/lib/auth-client.ts",
    "src/app/(auth)/login/page.tsx",
    "src/app/(auth)/register/page.tsx",
  ]) {
    assert.doesNotMatch(
      await readFile(file, "utf8"),
      /Demo validada|autenticación real se conectará|isSubmitSuccessful|setTimeout|mock.?login|mock.?register/i,
    );
  }
});
