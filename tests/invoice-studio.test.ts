import { test } from "node:test";
import assert from "node:assert/strict";
import {
  conceptSnapshot,
  draftRequest,
  formatAmount,
  issueTarget,
  shiftDecimal,
  newDraft,
} from "../src/components/invoice-studio/model";
import {
  readDetail,
  readSaved,
  readEvaluation,
  readCatalog,
  StudioRequestError,
  studioRequest,
} from "../src/components/invoice-studio/transport";
import type {
  InvoiceStudioContext,
  SavedInvoiceConcept,
} from "@/types/invoice-studio";

test("SAT rates are converted for percent inputs without floating point or loss of precision", () => {
  assert.equal(shiftDecimal("0.106667", 2), "10.6667");
  assert.equal(shiftDecimal("10.6667", -2), "0.106667");
  assert.equal(shiftDecimal("0.000001", 2), "0.0001");
  assert.equal(shiftDecimal("0", 2), "0");
  assert.equal(shiftDecimal("", -2), "");
  assert.equal(shiftDecimal("16", -2), "0.16");
  assert.equal(shiftDecimal("1e2", -2), "1e2");
  assert.equal(formatAmount("9999999999.99", "MXN"), "9,999,999,999.99 MXN");
  assert.equal(formatAmount(undefined), "—");
});
test("saved concept selection creates an independent invoice snapshot and keeps EXENTO separate", () => {
  const original: SavedInvoiceConcept = {
    id: "sample",
    name: "Servicio",
    description: "Servicio guardado",
    productCode: "01010101",
    unitCode: "ACT",
    taxObject: "02",
    vatFactor: "EXENTO",
    active: true,
  };
  const line = conceptSnapshot(original);
  line.description = "Descripción de esta factura";
  assert.equal(original.description, "Servicio guardado");
  assert.equal(line.savedConceptId, original.id);
  assert.equal(line.vatFactor, "EXENTO");
  assert.equal(line.vatRate, undefined);
});
test("requests whitelist editable fields and never trust organization, totals or issuance supplied in detail", () => {
  const raw = {
    clientId: "client",
    invoiceDate: "2026-10-07",
    documentType: "I",
    currency: "MXN",
    cfdiUse: "G03",
    exportCode: "01",
    concepts: [
      {
        description: "Servicio",
        quantity: "1",
        unitPrice: "100",
        productCode: "01010101",
        unitCode: "ACT",
        taxObject: "02",
        vatFactor: "TASA",
        vatRate: "0.16",
        organizationId: "foreign",
        total: "900",
      },
    ],
    organizationId: "foreign",
    total: "900",
    status: "ISSUED",
    uuid: "fake",
  };
  const request = draftRequest(
    raw as unknown as Parameters<typeof draftRequest>[0],
  );
  assert.equal("organizationId" in request, false);
  assert.equal("status" in request, false);
  assert.equal("total" in request, false);
  assert.equal("uuid" in request, false);
  assert.equal("total" in request.concepts[0], false);
  assert.equal("organizationId" in request.concepts[0], false);
});
test("legacy and incomplete responses cannot be claimed as fiscal validation or a saved Fase 5 draft", () => {
  assert.throws(() =>
    readSaved({ id: "legacy", folio: "ORB-000001", status: "DRAFT" }),
  );
  assert.throws(() =>
    readEvaluation({ validation: { valid: true }, total: "116" }),
  );
  assert.throws(() => readDetail({ id: "legacy", status: "ISSUED" }));
});
test("field navigation resolves nested backend paths and explicit concept indexes", () => {
  const issue = {
    code: "TEST",
    section: "concepts",
    severity: "ERROR",
    message: "Revisa la clave",
    field: "concepts[2].productCode",
  } as const;
  assert.deepEqual(issueTarget(issue), { field: "productCode", index: 2 });
  assert.deepEqual(issueTarget({ ...issue, field: "concepts.1.unitCode" }), {
    field: "unitCode",
    index: 1,
  });
  assert.deepEqual(
    issueTarget({ ...issue, field: "description", conceptIndex: 4 }),
    { field: "description", index: 4 },
  );
});
test("new invoices do not silently select a client or invent a payment form", () => {
  const context = {
    settings: { currencyDefault: "MXN", paymentMethodDefault: "PUE" },
  } as InvoiceStudioContext;
  const draft = newDraft(context);
  assert.equal(draft.clientId, "");
  assert.equal(draft.paymentForm, undefined);
  assert.equal(draft.concepts[0].productCode, "");
});
const validation = {
  valid: false,
  canMarkReady: false,
  sections: {
    issuer: "OK",
    receiver: "OK",
    document: "OK",
    payment: "OK",
    concepts: "ERROR",
    totals: "OK",
  },
  issues: [
    {
      code: "FIELD_INVALID",
      severity: "ERROR",
      section: "concepts",
      field: "quantity",
      conceptIndex: 0,
      message: "Cantidad válida",
    },
  ],
} as const;
test("structural validation preserves backend issues when official totals are null", () => {
  const result = readEvaluation({ totals: null, validation });
  assert.equal(result.totals, null);
  assert.equal(result.validation.issues[0].field, "quantity");
  assert.throws(() =>
    readSaved({
      id: "test",
      folio: null,
      status: "DRAFT",
      updatedAt: new Date().toISOString(),
      ...result,
    }),
  );
});
test("SAT search reads the real coverage envelope rather than accepting a bare option array", () => {
  const payload = {
    catalog: "units",
    source: "CURATED_SUBSET",
    complete: false,
    results: [{ code: "E48", label: "Unidad de servicio", active: true }],
  };
  assert.deepEqual(readCatalog(payload), payload);
  assert.throws(() => readCatalog(payload.results));
});
test("transport distinguishes DRAFT_CONFLICT from configuration 409 and retains fiscal validation", async () => {
  const original = globalThis.fetch;
  try {
    for (const code of [
      "DRAFT_CONFLICT",
      "INVOICE_SETTINGS_REQUIRED",
      "NOT_READY",
    ]) {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({ code, error: "Revisa el borrador", validation }),
          { status: code === "NOT_READY" ? 422 : 409 },
        );
      await assert.rejects(
        studioRequest("/api/outgoing-invoices/test"),
        (error: unknown) => {
          assert.ok(error instanceof StudioRequestError);
          assert.equal(error.code, code);
          assert.equal(error.issues?.[0].conceptIndex, 0);
          return true;
        },
      );
    }
  } finally {
    globalThis.fetch = original;
  }
});
