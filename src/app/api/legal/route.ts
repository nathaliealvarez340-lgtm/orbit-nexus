import {
  currentLegalDocument,
  legalDocumentKinds,
  legalDocumentSummary,
} from "@/lib/legal/registry";
// GET /api/legal → LegalDocumentSummary[] of the current versions. Public.
export function GET() {
  return Response.json(
    legalDocumentKinds.map((kind) =>
      legalDocumentSummary(currentLegalDocument(kind)),
    ),
  );
}
