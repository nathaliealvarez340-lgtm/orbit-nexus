import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/tenant";
import { ApiError } from "@/lib/http";
import { getDb } from "@/lib/db";
import { OrganizationForm } from "@/components/forms/organization-form";
import { OrganizationSwitcher } from "@/components/dashboard/organization-switcher";
export default async function Page() {
  const user = await requireUser().catch((e) => {
    if (e instanceof ApiError && e.status === 401) redirect("/login");
    throw e;
  });
  const memberships = await getDb().membership.findMany({
    where: { userId: user.id },
    include: { organization: { select: { id: true, name: true } } },
  });
  return (
    <section className="surface p-8">
      <p className="text-xs uppercase tracking-widest text-violet-400">
        Tu espacio de trabajo
      </p>
      <h1 className="mt-4 text-3xl font-semibold">
        Todo comienza con tu organización
      </h1>
      <p className="mt-3 text-sm leading-6 text-zinc-400">
        Serás propietario de este espacio. Podrás completar los datos fiscales
        después.
      </p>
      <OrganizationForm />
      {memberships.length > 0 && (
        <div className="mt-6 space-y-3 border-t border-white/10 pt-5">
          <p className="text-sm text-zinc-400">
            O continúa en una organización existente:
          </p>
          <OrganizationSwitcher memberships={memberships} />
          <Link className="text-xs text-violet-300" href="/dashboard">
            Volver al dashboard
          </Link>
        </div>
      )}
    </section>
  );
}
