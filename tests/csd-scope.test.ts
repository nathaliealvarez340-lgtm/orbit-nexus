import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { Cfdi40Error } from "../src/lib/cfdi40/errors";
import { pacSubmission } from "../src/lib/cfdi40/schema";
import { verifyActiveCsdEnvelope } from "../src/services/csd-store";

// Product rule: a CSD is needed only to seal and stamp. Clients, client CSF and invoice
// drafts (create, save, edit, validate, READY) never depend on it; the end-to-end proof
// with no CSD configured is tests/client-csf-e2e.mjs.

const independentOfCsd = [
  "src/services/outgoing-invoices.ts",
  "src/services/clients.ts",
  "src/services/private-assets.ts",
  "src/services/fiscal-documents.ts",
  "src/app/api/outgoing-invoices/route.ts",
  "src/app/api/outgoing-invoices/[id]/route.ts",
  "src/app/api/outgoing-invoices/[id]/ready/route.ts",
  "src/app/api/outgoing-invoices/validate/route.ts",
  "src/app/api/clients/route.ts",
  "src/app/api/clients/[id]/route.ts",
  "src/app/api/private-assets/route.ts",
  "src/app/api/fiscal-consents/route.ts",
  "src/app/api/fiscal-extractions/route.ts",
  "src/components/forms/outgoing-invoice-form.tsx",
  "src/components/forms/client-editor.tsx",
  "src/components/fiscal/client-fiscal-form.tsx",
  "src/components/fiscal/csf-prefill.tsx",
];

test("clients, client CSF and invoice drafts never depend on a CSD", async () => {
  for (const file of independentOfCsd)
    assert(
      !/csd/i.test(await readFile(file, "utf8")),
      `${file} must not read or require a CSD`,
    );
});

test("sealing and stamping still require an active CSD and a sealed, XSD-validated CFDI", async () => {
  const noActiveCsd = { csdCertificate: { findFirst: async () => null } };
  assert.equal(
    await verifyActiveCsdEnvelope(noActiveCsd as never, "org-a", {}),
    "NOT_CONFIGURED",
  );
  assert.throws(
    () => pacSubmission({ stage: "UNSIGNED", xml: "<cfdi:Comprobante/>" }),
    (error: unknown) =>
      error instanceof Cfdi40Error &&
      error.issues[0].code === "XSD_VALIDATED_CFDI_REQUIRED",
  );
});
