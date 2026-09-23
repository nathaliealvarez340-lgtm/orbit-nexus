import Link from "next/link";
import { PageHeader } from "@/components/dashboard/page-header";
import { UploadZone } from "@/components/dashboard/upload-zone";
import { requirePageTenant } from "@/lib/tenant";
import { getDb } from "@/lib/db";
export default async function Page() {
  const { organizationId, role } = await requirePageTenant();
  const docs = await getDb().uploadedFiscalDocument.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Extracción asistida"
        title="Documentos fiscales"
        copy="Sube XML, PDF o tu Constancia de Situación Fiscal. Confirma cada dato antes de guardar."
      />
      {role !== "MEMBER" && (
        <section className="surface p-6">
          <UploadZone fiscal />
        </section>
      )}
      <section className="surface p-6">
        <h2 className="text-sm font-medium">Documentos de la organización</h2>
        <div className="mt-4 divide-y divide-white/5">
          {docs.map((d) => (
            <div
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-3 py-4"
            >
              <div>
                <p className="text-sm">{d.fileName}</p>
                <p className="mt-1 text-xs text-zinc-500">
                  {d.isConfirmed
                    ? "Datos confirmados"
                    : "Pendiente de revisión"}
                </p>
              </div>
              <div className="flex gap-4 text-sm text-violet-300">
                <Link href={"/dashboard/fiscal-profile?document=" + d.id}>
                  Revisar
                </Link>
                {d.documentId && (
                  <a href={"/api/documents/" + d.documentId}>Descargar</a>
                )}
              </div>
            </div>
          ))}
          {!docs.length && (
            <p className="py-6 text-sm text-zinc-500">
              Aún no has subido documentos fiscales.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
