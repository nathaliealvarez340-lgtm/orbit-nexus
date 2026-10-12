import { LegalPage } from "@/components/privacy/legal-page";
import { currentLegalDocument } from "@/lib/legal/registry";
import { legalMetadata } from "@/lib/legal-web";
export const metadata = legalMetadata(currentLegalDocument("TERMS"), "/terms");
export default function Page() {
  return <LegalPage document={currentLegalDocument("TERMS")} />;
}
