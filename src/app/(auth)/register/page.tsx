import { publicMetadata } from "@/lib/web-metadata";
import { RegistrationWizard } from "@/components/experience/registration-wizard";
import { preferencesForSession } from "@/services/user-preferences";
import { ApiError } from "@/lib/http";
import { redirect } from "next/navigation";

export const metadata = publicMetadata("Crear cuenta", "/register");

export default async function RegisterPage() {
  const existing = await preferencesForSession().catch((error) => {
    if (error instanceof ApiError && error.status === 401) return undefined;
    throw error;
  });
  if (existing?.onboardingCompleted) redirect("/api/auth/continue");
  return <RegistrationWizard existing={existing} />;
}
