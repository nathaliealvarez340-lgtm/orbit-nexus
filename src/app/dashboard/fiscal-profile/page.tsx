import { notFound } from "next/navigation";
import { FiscalForm } from "@/components/forms/fiscal-form";
import { PageHeader } from "@/components/dashboard/page-header";
import { requirePageTenant } from "@/lib/tenant";
import { fiscalProfileComplete, addressFields } from "@/lib/fiscal-catalogs";
import { getDb } from "@/lib/db";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ document?: string }>;
}) {
  const { organizationId, role } = await requirePageTenant();
  const { document } = await searchParams;
  const [profile, source] = await Promise.all([
    getDb().fiscalProfile.findFirst({ where: { organizationId } }),
    document
      ? getDb().uploadedFiscalDocument.findFirst({
          where: { id: document, organizationId },
        })
      : null,
  ]);
  if (document && !source) notFound();
  const current: Record<string, string> = profile
    ? {
        rfc: profile.rfc,
        legalName: profile.legalName,
        fiscalRegime: profile.fiscalRegime,
        postalCode: profile.postalCode,
        cfdiUse: profile.cfdiUse,
        email: profile.email,
        personType: profile.personType,
        ...Object.fromEntries(
          addressFields.map(([key]) => [key, profile[key] ?? ""]),
        ),
        csfDocumentId: profile.csfDocumentId ?? "",
      }
    : {};
  const extracted = source?.extractedData as Record<string, string> | null;
  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Identidad fiscal"
        title="Perfil fiscal"
        copy="Revisa y confirma la identidad fiscal de tu organización como emisor."
      />
      {source && (
        <div className="surface p-5 text-sm text-zinc-400">
          {Object.keys(extracted || {}).length
            ? "Datos extraídos del receptor del XML. Revisa cada campo antes de guardar."
            : "Documento recibido. Para leer una constancia PDF, cárgala en el flujo privado y autoriza su lectura. Puedes completar los datos manualmente."}
        </div>
      )}
      <p className="text-sm text-violet-300">
        {fiscalProfileComplete(profile)
          ? "Perfil completo · Constancia y dirección registradas"
          : "Perfil incompleto · Completa la dirección y adjunta la constancia PDF"}
      </p>
      <FiscalForm
        key={`${organizationId}:${document || "profile"}`}
        initial={current}
        sourceValues={extracted}
        documentId={document}
        readOnly={role === "MEMBER"}
      />
    </div>
  );
}
