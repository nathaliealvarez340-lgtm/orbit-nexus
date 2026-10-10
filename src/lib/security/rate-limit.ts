import type { PrismaClient } from "@/generated/prisma/client";

// Fase 5C.2 §11: rate limits must hold across serverless instances, so counters live in
// shared storage, never in process memory. The store increments a fixed window
// atomically and returns the count for the current window.
export type RateLimitStore = {
  hit(key: string, windowSeconds: number, now?: Date): Promise<number>;
};

/** PostgreSQL (Neon in production): one atomic upsert per hit on "RequestLimit". */
export function postgresRateLimitStore(
  db: Pick<PrismaClient, "$queryRaw">,
): RateLimitStore {
  return {
    async hit(key, windowSeconds, now = new Date()) {
      const expires = new Date(now.getTime() + windowSeconds * 1000);
      const rows = await db.$queryRaw<Array<{ count: number }>>`
        INSERT INTO "RequestLimit" ("key", "count", "expiresAt") VALUES (${key}, 1, ${expires})
        ON CONFLICT ("key") DO UPDATE SET "count" = CASE WHEN "RequestLimit"."expiresAt" <= ${now} THEN 1 ELSE "RequestLimit"."count" + 1 END,
        "expiresAt" = CASE WHEN "RequestLimit"."expiresAt" <= ${now} THEN ${expires} ELSE "RequestLimit"."expiresAt" END RETURNING "count"`;
      return rows[0].count;
    },
  };
}
