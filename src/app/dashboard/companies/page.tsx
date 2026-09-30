import { PageHeader } from "@/components/dashboard/page-header";
import { requirePageTenant } from "@/lib/tenant";
import { OrganizationForm } from "@/components/forms/organization-form";
import { OrganizationSwitcher } from "@/components/dashboard/organization-switcher";
export default async function Page() {
  const tenant = await requirePageTenant();
  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Administración"
        title="Empresas"
        copy="Organizaciones a las que perteneces. Cada empresa conserva sus propios datos."
      />
      <section className="surface p-6">
        <h2 className="mb-4 font-medium">Empresa activa</h2>
        <OrganizationSwitcher
          memberships={tenant.memberships}
          active={tenant.organizationId}
        />
        <ul className="mt-5 space-y-3">
          {tenant.memberships.map((m) => (
            <li
              key={m.organizationId}
              className="flex flex-wrap justify-between gap-2 border-t border-white/10 pt-3 text-sm"
            >
              <span>
                {m.organization.name}
                {m.organizationId === tenant.organizationId ? " · Activa" : ""}
              </span>
              <span className="text-zinc-400">{m.role}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="surface max-w-xl p-6">
        <h2 className="font-medium">Crear empresa</h2>
        <p className="mt-2 text-sm text-zinc-400">
          Serás propietario de la nueva organización. No hay un límite por plan.
        </p>
        <OrganizationForm />
      </section>
    </div>
  );
}
