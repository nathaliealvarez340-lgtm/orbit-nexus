import { legalDocumentBySlug } from "@/lib/legal/registry";
// GET /api/legal/terminos | /api/legal/aviso-de-privacidad → LegalDocument. Public.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const document = legalDocumentBySlug((await params).slug);
  return document
    ? Response.json(document)
    : Response.json({ error: "Documento no disponible." }, { status: 404 });
}
