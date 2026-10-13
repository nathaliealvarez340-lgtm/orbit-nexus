import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { startDatabase } from "../scripts/local-database.mjs";
import {
  resolveExperience,
  JOB_ROLES,
  isTimezone,
  type Locale,
} from "../src/lib/experience/catalog";
import { preferencesSchema } from "../src/lib/experience/validation";
import {
  messages,
  translate,
  formatMoney,
  type Namespace,
} from "../src/lib/i18n";
import {
  readUserPreferences,
  updateUserPreferences,
  currentCommunicationPolicy,
} from "../src/services/user-preferences";

test("preference boundaries use stable allowlists and independent dimensions", () => {
  assert.deepEqual(resolveExperience(), {
    theme: "DARK",
    locale: "es-MX",
    timezone: "UTC",
  });
  assert.deepEqual(
    resolveExperience(
      { locale: "en-US" },
      { theme: "LIGHT", timezone: "Europe/Madrid" },
    ),
    { theme: "LIGHT", locale: "en-US", timezone: "Europe/Madrid" },
  );
  assert.equal(
    resolveExperience({ locale: "unknown", timezone: "+06:00" }).locale,
    "es-MX",
  );
  for (const jobRole of JOB_ROLES)
    assert(preferencesSchema.safeParse({ jobRole, revision: 0 }).success);
  for (const body of [
    { locale: "en" },
    { theme: "SYSTEM" },
    { jobRole: "CEO" },
    { timezone: "UTC+6" },
    { userId: "b", theme: "LIGHT" },
    { country: "MX" },
    { currency: "USD" },
    { communications: { ESSENTIAL: false } },
    { communications: { NEWS_UPDATES: "true" } },
  ])
    assert.equal(
      preferencesSchema.safeParse({ revision: 0, ...body }).success,
      false,
    );
  assert.equal(preferencesSchema.safeParse({ theme: "LIGHT" }).success, false);
  assert(
    preferencesSchema.safeParse({ accent: "BLUE" }).success,
    "legacy accent transport remains supported",
  );
  for (const timezone of ["America/Mexico_City", "Europe/Madrid", "UTC"])
    assert(isTimezone(timezone));
  assert.equal(isTimezone("MadeUp/Zone"), false);
  assert.equal(formatMoney(12, "en-US", "EUR"), "€12.00");
});

test("dictionary parity and controlled fallback cover all critical namespaces", () => {
  for (const namespace of Object.keys(messages) as Namespace[]) {
    assert.deepEqual(
      Object.keys(messages[namespace]["es-MX"]).sort(),
      Object.keys(messages[namespace]["en-US"]).sort(),
      namespace,
    );
    assert(
      Object.values(messages[namespace]["en-US"]).every(
        (value) => value.length,
      ),
    );
  }
  assert.equal(
    translate("unsupported" as Locale, "common", "continue"),
    "Continuar",
  );
  assert.equal(
    translate("en-US", "onboarding", "step", { current: 2, total: 5 }),
    "Step 2 of 5",
  );
});

test("additive migration preserves legacy accounts/accent without positive consent", async () => {
  const db = await PGlite.create();
  const migration = "20261012000000_user_experience";
  try {
    for (const directory of (await readdir("prisma/migrations"))
      .filter((name) => /^\d/.test(name) && name < migration)
      .sort())
      await db.exec(
        await readFile(`prisma/migrations/${directory}/migration.sql`, "utf8"),
      );
    await db.exec(
      `INSERT INTO "User" (id,name,email,"updatedAt") VALUES ('legacy','Legacy','legacy@example.test',NOW()); INSERT INTO "UserPreference" ("userId",accent) VALUES ('legacy','ORANGE');`,
    );
    await db.exec(
      await readFile(`prisma/migrations/${migration}/migration.sql`, "utf8"),
    );
    const preference = (
      await db.query(
        `SELECT accent,theme,locale,timezone,"jobRole",revision FROM "UserPreference"`,
      )
    ).rows[0];
    assert.deepEqual(preference, {
      accent: "ORANGE",
      theme: null,
      locale: null,
      timezone: null,
      jobRole: null,
      revision: 0,
    });
    assert.equal(
      (
        await db.query<{ count: number }>(
          `SELECT COUNT(*)::int AS count FROM "CommunicationConsentRecord"`,
        )
      ).rows[0].count,
      0,
    );
    assert.equal(
      (await db.query<{ name: string }>(`SELECT name FROM "User"`)).rows[0]
        .name,
      "Legacy",
    );
  } finally {
    await db.close();
  }
});

test("real local Prisma preferences isolate users, detect concurrent revisions and preserve consent evidence", async () => {
  const database = await startDatabase();
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: database.url, max: 3 }),
  });
  try {
    await db.user.createMany({
      data: [
        { id: "experience-a", name: "A", email: "a@example.test" },
        { id: "experience-b", name: "B", email: "b@example.test" },
      ],
    });
    const initial = await readUserPreferences(db, "experience-a");
    assert.equal(initial.jobRole, null);
    assert.deepEqual(initial.communications, {
      NEWS_UPDATES: false,
      PRODUCT_NEWS: false,
      COMMERCIAL_OFFERS: false,
    });
    assert.equal(currentCommunicationPolicy(), null);
    await assert.rejects(
      updateUserPreferences(db, "experience-a", {
        communications: { COMMERCIAL_OFFERS: true },
        revision: 0,
      }),
      /COMMUNICATIONS_UNAVAILABLE/,
    );
    assert.equal(await db.communicationConsentRecord.count(), 0);
    await updateUserPreferences(db, "experience-a", {
      theme: "LIGHT",
      locale: "en-US",
      jobRole: "PRODUCT",
      completeOnboarding: true,
      revision: 0,
    });
    assert.equal((await readUserPreferences(db, "experience-b")).theme, "DARK");
    const races = await Promise.allSettled([
      updateUserPreferences(db, "experience-a", { theme: "DARK", revision: 1 }),
      updateUserPreferences(db, "experience-a", {
        locale: "es-MX",
        revision: 1,
      }),
    ]);
    assert.equal(
      races.filter((result) => result.status === "fulfilled").length,
      1,
    );
    assert.equal(
      races.filter(
        (result) =>
          result.status === "rejected" &&
          /PREFERENCES_CONFLICT/.test(String(result.reason)),
      ).length,
      1,
    );
    // Isolated server-owned evidence fixture only. The HTTP API never accepts this
    // policy and production has no approved commercial text; no real opt-in enabled.
    const fixturePolicy = {
      version: "isolated-test-only",
      contentHash: "a".repeat(64),
      textLocale: "en-US" as const,
      jurisdiction: "MX",
    };
    await updateUserPreferences(
      db,
      "experience-a",
      { communications: { NEWS_UPDATES: true }, revision: 2 },
      fixturePolicy,
    );
    const granted = await db.communicationConsentRecord.findFirstOrThrow();
    assert.equal(granted.decision, "GRANTED");
    assert.equal(granted.source, "SETTINGS");
    assert.equal(
      (await readUserPreferences(db, "experience-a")).communications
        .PRODUCT_NEWS,
      false,
    );
    await updateUserPreferences(db, "experience-a", {
      communications: { NEWS_UPDATES: false },
      revision: 3,
    });
    const evidence = await db.communicationConsentRecord.findMany({
      orderBy: { recordedAt: "asc" },
    });
    assert.deepEqual(
      evidence.map((row) => row.decision),
      ["GRANTED", "REVOKED"],
    );
    assert(
      evidence.every(
        (row) =>
          row.contentHash === fixturePolicy.contentHash &&
          row.version === fixturePolicy.version,
      ),
    );
    await assert.rejects(
      db.communicationConsentRecord.update({
        where: { id: granted.id },
        data: { version: "changed" },
      }),
    );
    await assert.rejects(
      db.communicationConsentRecord.delete({ where: { id: granted.id } }),
    );
    assert.equal(await db.communicationConsentRecord.count(), 2);
    await assert.rejects(
      updateUserPreferences(db, "experience-b", {
        userId: "experience-a",
        theme: "LIGHT",
        revision: 0,
      }),
    );
    assert.equal((await readUserPreferences(db, "experience-b")).revision, 0);
  } finally {
    await db.$disconnect();
    await database.close();
  }
});
