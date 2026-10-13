import "server-only";
import { cache } from "react";
import { ApiError } from "@/lib/http";
import { preferencesForSession } from "@/services/user-preferences";
import { resolveExperience } from "./catalog";
export const serverExperience = cache(async () => {
  try {
    return await preferencesForSession();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      return resolveExperience();
    throw error;
  }
});
