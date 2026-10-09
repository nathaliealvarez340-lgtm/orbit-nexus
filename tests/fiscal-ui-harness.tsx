// Browser-only fixture harness. Bundled in memory by the E2E runner, never served
// from an application route or included in a production component.
import { createRoot } from "react-dom/client";
import { FiscalForm } from "../src/components/forms/fiscal-form";
import { consent, extraction } from "./fiscal-ui-fixture";
import type { CsfTransport } from "../src/components/fiscal/transport";
declare global {
  interface Window {
    fiscalUiTest: {
      calls: string[];
      mode: "partial" | "unreadable" | "error" | "mismatch";
      saved?: unknown;
    };
  }
}
window.fiscalUiTest = { calls: [], mode: "partial" };
const pause = () => new Promise((resolve) => setTimeout(resolve, 200));
const transport: CsfTransport = {
  async upload() {
    window.fiscalUiTest.calls.push("upload");
    await pause();
    return { id: "test-document", fileName: "CSF sintética de prueba.pdf" };
  },
  async terms(purpose) {
    return {
      purpose,
      consentVersion: "test-terms",
      privacyNoticeVersion: "test-privacy",
      text: "Autorización sintética para esta prueba aislada de lectura.",
    };
  },
  async consent(request) {
    window.fiscalUiTest.calls.push("consent");
    if (!request.accepted) throw new Error();
    return consent;
  },
  async extract() {
    window.fiscalUiTest.calls.push("extract");
    await pause();
    if (window.fiscalUiTest.mode === "error")
      throw new Error("Synthetic internal error: must not be displayed");
    if (window.fiscalUiTest.mode === "mismatch")
      return { ...extraction, documentId: "other-document" };
    if (window.fiscalUiTest.mode === "unreadable")
      return { ...extraction, status: "UNREADABLE" };
    return extraction;
  },
};
window.fetch = async (input, init) => {
  if (input !== "/api/fiscal-profile")
    throw new Error("Unexpected fixture request");
  window.fiscalUiTest.calls.push("save");
  window.fiscalUiTest.saved = JSON.parse(String(init?.body));
  return Response.json({ id: "test-profile" });
};
createRoot(document.getElementById("fixture-root")!).render(
  <main className="orbit-app p-6">
    <h1>Prueba aislada · datos sintéticos · sin PAC</h1>
    <FiscalForm
      initial={{
        rfc: "AAA010101AAA",
        legalName: "Nombre actual de prueba",
        fiscalRegime: "601",
        cfdiUse: "G03",
        postalCode: "06000",
        email: "qa@example.test",
      }}
      catalogs={{
        fiscalRegimes: [
          { code: "601", label: "Régimen de prueba A", active: true },
        ],
        cfdiUses: [{ code: "G03", label: "Uso de prueba", active: true }],
      }}
      csfTransport={transport}
    />
  </main>,
);
