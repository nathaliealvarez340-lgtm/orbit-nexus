import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
test("temporary shared declarations match the canonical document verbatim", async () => {
  const contract = await readFile("docs/tasks/FASE5-CONTRACT.md", "utf8");
  const declaration = await readFile(
    "src/components/invoice-studio/pending-contract.d.ts",
    "utf8",
  );
  const normalize = (text: string) =>
    text.replace(/\s+/g, "").replace(/:\|/g, ":");
  const block = (text: string, name: string) => {
    const start = text.indexOf(`export type ${name} = {`);
    let depth = 0;
    for (
      let position = text.indexOf("{", start);
      position < text.length;
      position++
    ) {
      if (text[position] === "{") depth++;
      if (text[position] === "}" && --depth === 0)
        return text.slice(start, position + 2);
    }
    return "missing";
  };
  const names = [...declaration.matchAll(/export type (\w+) =/g)].map(
    (match) => match[1],
  );
  for (const name of names) {
    assert.equal(
      normalize(block(declaration, name)),
      normalize(block(contract, name)),
      name,
    );
  }
  assert.equal(names.length, 11);
});
