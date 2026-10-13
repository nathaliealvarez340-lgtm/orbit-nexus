import { serverExperience } from "@/lib/experience/server";
import { translate } from "@/lib/i18n";
import { privateRobots } from "@/lib/web-metadata";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/tenant";
import { ApiError } from "@/lib/http";
import { getDb } from "@/lib/db";
import { OrganizationForm } from "@/components/forms/organization-form";
import { OrganizationSwitcher } from "@/components/dashboard/organization-switcher";
export const metadata = { title: "Tu organización", robots: privateRobots };

export default async function Page() {
  const user = await requireUser().catch((e) => {
    if (e instanceof ApiError && e.status === 401) redirect("/login");
    throw e;
  });
  const experience = await serverExperience();
  const t = (key: Parameters<typeof translate<"onboarding">>[2]) =>
    translate(experience.locale, "onboarding", key);
  const memberships = await getDb().membership.findMany({
    where: { userId: user.id },
    include: { organization: { select: { id: true, name: true } } },
  });
  return (
    <section className="surface p-8">
      <p className="text-xs uppercase tracking-widest text-violet-400">
        {t("workspace")}
      </p>
      <h1 className="mt-4 text-3xl font-semibold">{t("organizationTitle")}</h1>
      <p className="mt-3 text-sm leading-6 text-zinc-400">
        {t("organizationHelp")}
      </p>
      <OrganizationForm next="/dashboard/fiscal-profile" />
      {memberships.length > 0 && (
        <div className="mt-6 space-y-3 border-t border-white/10 pt-5">
          <p className="text-sm text-zinc-400">{t("existingOrganization")}</p>
          <OrganizationSwitcher memberships={memberships} />
          <Link className="text-xs text-violet-300" href="/dashboard">
            {t("dashboard")}
          </Link>
        </div>
      )}
    </section>
  );
}
