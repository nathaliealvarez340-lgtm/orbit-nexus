// Test-only published document boundary. Production registry and backend stay DRAFT.
import { createRoot } from "react-dom/client";
import { LegalAcceptance } from "../src/components/privacy/legal-acceptance";
import type { LegalDocumentSummary } from "../src/types/legal";

const document: Pick<
  LegalDocumentSummary,
  "kind" | "version" | "contentHash" | "status"
> = {
  kind: "TERMS",
  version: "synthetic-test-1",
  contentHash: "1".repeat(64),
  status: "PUBLISHED",
};
const root = createRoot(window.document.getElementById("root")!);
let renderCount = 0;
declare global {
  interface Window {
    renderLegalFixture: (status?: "DRAFT" | "PUBLISHED") => void;
  }
}
window.renderLegalFixture = (status = "PUBLISHED") =>
  root.render(
    <main>
      <h1>Prueba legal aislada</h1>
      <LegalAcceptance key={++renderCount} document={{ ...document, status }} />
    </main>,
  );
window.renderLegalFixture();
