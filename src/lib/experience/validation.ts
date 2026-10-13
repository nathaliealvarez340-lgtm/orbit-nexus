import { z } from "zod";
import {
  SUPPORTED_LOCALES,
  THEMES,
  JOB_ROLES,
  COMMUNICATION_CATEGORIES,
  isTimezone,
} from "./catalog";
export const preferencesSchema = z
  .object({
    accent: z.enum(["PURPLE", "BLUE", "ORANGE", "RED"]).optional(),
    theme: z.enum(THEMES).nullable().optional(),
    locale: z.enum(SUPPORTED_LOCALES).nullable().optional(),
    timezone: z.string().max(64).refine(isTimezone).nullable().optional(),
    jobRole: z.enum(JOB_ROLES).nullable().optional(),
    revision: z.number().int().min(0).max(2147483646).optional(),
    completeOnboarding: z.literal(true).optional(),
    communications: z
      .object(
        Object.fromEntries(
          COMMUNICATION_CATEGORIES.map((category) => [
            category,
            z.boolean().optional(),
          ]),
        ) as Record<
          (typeof COMMUNICATION_CATEGORIES)[number],
          z.ZodOptional<z.ZodBoolean>
        >,
      )
      .strict()
      .optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).some((key) => key !== "revision"), {
    message: "No preference change",
  })
  .refine(
    (value) =>
      value.revision !== undefined ||
      Object.keys(value).every((key) => key === "accent"),
    { path: ["revision"], message: "Revision required" },
  )
  .refine(
    (value) =>
      !value.completeOnboarding ||
      (value.theme && value.locale && value.jobRole),
    { path: ["completeOnboarding"], message: "Complete preferences first" },
  );
export type PreferencesUpdate = z.infer<typeof preferencesSchema>;
