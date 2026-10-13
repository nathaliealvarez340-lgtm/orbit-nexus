import "server-only";
import { getDb } from "@/lib/db";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  COMMUNICATION_CATEGORIES,
  resolveExperience,
  type PreferencesDto,
  type Locale,
} from "@/lib/experience/catalog";
import { preferencesSchema } from "@/lib/experience/validation";

export class PreferencesError extends Error {
  constructor(
    public code: "PREFERENCES_CONFLICT" | "COMMUNICATIONS_UNAVAILABLE",
    public status = 409,
  ) {
    super(code);
  }
}
// Server-owned policy input for future approved text; never accepted from an API body.
export type CommunicationPolicy = {
  version: string;
  contentHash: string;
  textLocale: Locale;
  jurisdiction: string | null;
};
// No commercial policy is published. DRAFT notices cannot authorize an opt-in.
export function currentCommunicationPolicy(): CommunicationPolicy | null {
  return null;
}
export async function readUserPreferences(
  db: PrismaClient,
  userId: string,
): Promise<PreferencesDto> {
  const [preference, communications] = await Promise.all([
    db.userPreference.findUnique({ where: { userId } }),
    db.communicationPreference.findMany({
      where: { userId },
      select: { category: true, enabled: true },
    }),
  ]);
  return {
    ...resolveExperience(preference ?? {}),
    accent: preference?.accent ?? "PURPLE",
    jobRole: preference?.jobRole ?? null,
    revision: preference?.revision ?? 0,
    onboardingCompleted: !!preference?.onboardingPreferencesCompletedAt,
    communicationsAvailable: !!currentCommunicationPolicy(),
    communications: Object.fromEntries(
      COMMUNICATION_CATEGORIES.map((category) => [
        category,
        communications.find((row) => row.category === category)?.enabled ??
          false,
      ]),
    ) as PreferencesDto["communications"],
  };
}
export async function updateUserPreferences(
  db: PrismaClient,
  userId: string,
  body: unknown,
  policy: CommunicationPolicy | null = currentCommunicationPolicy(),
) {
  const { revision, communications, completeOnboarding, ...values } =
    preferencesSchema.parse(body);
  if (Object.values(communications ?? {}).some(Boolean) && !policy)
    throw new PreferencesError("COMMUNICATIONS_UNAVAILABLE");
  await db.$transaction(async (tx) => {
    const prior = await tx.userPreference.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
    const source =
      completeOnboarding && !prior.onboardingPreferencesCompletedAt
        ? "REGISTRATION"
        : "SETTINGS";
    const count = await tx.userPreference.updateMany({
      where: { userId, revision: revision ?? prior.revision },
      data: {
        ...values,
        revision: { increment: 1 },
        ...(completeOnboarding && !prior.onboardingPreferencesCompletedAt
          ? { onboardingPreferencesCompletedAt: new Date() }
          : {}),
      },
    });
    if (count.count !== 1) throw new PreferencesError("PREFERENCES_CONFLICT");
    for (const category of COMMUNICATION_CATEGORIES) {
      const enabled = communications?.[category];
      if (enabled === undefined) continue;
      const previous = await tx.communicationPreference.findUnique({
        where: { userId_category: { userId, category } },
      });
      if (enabled !== (previous?.enabled ?? false)) {
        const evidence = enabled
          ? policy
          : await tx.communicationConsentRecord.findFirst({
              where: { userId, type: category, decision: "GRANTED" },
              orderBy: { recordedAt: "desc" },
              select: {
                version: true,
                contentHash: true,
                textLocale: true,
                jurisdiction: true,
              },
            });
        if (evidence)
          await tx.communicationConsentRecord.create({
            data: {
              userId,
              type: category,
              decision: enabled ? "GRANTED" : "REVOKED",
              ...evidence,
              source,
            },
          });
      }
      await tx.communicationPreference.upsert({
        where: { userId_category: { userId, category } },
        create: { userId, category, enabled },
        update: { enabled },
      });
    }
  });
  return readUserPreferences(db, userId);
}
export async function preferencesForSession() {
  const { requireUser } = await import("@/lib/tenant");
  const user = await requireUser();
  return readUserPreferences(getDb(), user.id);
}
