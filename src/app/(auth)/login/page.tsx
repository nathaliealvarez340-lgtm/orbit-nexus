import { serverExperience } from "@/lib/experience/server";
import { translate } from "@/lib/i18n";
import { publicMetadata } from "@/lib/web-metadata";
import Link from "next/link";
import { AuthForm } from "@/components/forms/auth-form";

export const metadata = publicMetadata("Iniciar sesión", "/login");

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const experience = await serverExperience();
  const t = (key: Parameters<typeof translate<"auth">>[2]) =>
    translate(experience.locale, "auth", key);
  const { returnTo } = await searchParams;
  return (
    <section className="surface p-7 sm:p-9">
      <p className="text-xs font-semibold uppercase tracking-[.18em] text-violet-400">
        {t("welcome")}
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-[-.04em]">
        {t("loginTitle")}
      </h1>
      <p className="mt-2 text-sm text-zinc-500">{t("loginIntro")}</p>
      <AuthForm
        mode="login"
        returnTo={
          returnTo === "/dashboard/stamping" ? "/dashboard/stamping" : undefined
        }
      />
      <p className="mt-6 text-center text-sm text-zinc-500">
        {t("newAccount")}{" "}
        <Link href="/register" className="text-white">
          {t("create")}
        </Link>
      </p>
    </section>
  );
}
