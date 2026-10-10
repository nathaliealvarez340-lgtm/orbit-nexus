import { LegalPage } from "@/components/privacy/legal-page";
import { legalContent } from "@/lib/legal-content";
import { publicMetadata } from "@/lib/web-metadata";
export const metadata = publicMetadata("Términos del servicio", "/terms");
export default function Page() {
  return <LegalPage content={legalContent.terms} />;
}
