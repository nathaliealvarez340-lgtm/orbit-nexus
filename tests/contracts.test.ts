import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCfdi, readCfdiReceiver } from "../src/lib/cfdi";
import { readBody, ApiError } from "../src/lib/http";
import { getTicketOcrAdapter } from "../src/services/ocr/adapter";
const xml = `<c:Comprobante xmlns:c="http://www.sat.gob.mx/cfd/4" xmlns:t="http://www.sat.gob.mx/TimbreFiscalDigital" Version="4.0" Moneda="MXN" TipoDeComprobante="I" Fecha="2026-09-15T12:00:00" SubTotal="100" Total="116"><c:Emisor Rfc="AAA010101AAA" Nombre="Fixture"/><c:Receptor Rfc="XAXX010101000"/><c:Impuestos TotalImpuestosTrasladados="16"/><c:Complemento><t:TimbreFiscalDigital UUID="550E8400-E29B-41D4-A716-446655440000"/></c:Complemento></c:Comprobante>`;
test("CFDI namespaces are resolved at each element; UUID is canonical and duplicate receivers are rejected", () => {
  const data = parseCfdi(xml);
  assert.equal(data.uuid, "550e8400-e29b-41d4-a716-446655440000");
  assert.equal(data.total, "116");
  assert.equal(readCfdiReceiver(xml).Rfc, "XAXX010101000");
  assert.throws(() =>
    parseCfdi(xml.replace("<c:Receptor", '<c:Receptor xmlns:c="urn:fake"')),
  );
  assert.throws(() =>
    parseCfdi(
      xml.replace(
        "<t:TimbreFiscalDigital",
        '<t:TimbreFiscalDigital xmlns:t="urn:fake"',
      ),
    ),
  );
  assert.throws(() =>
    parseCfdi(
      xml.replace(
        '<c:Receptor Rfc="XAXX010101000"/>',
        '<c:Receptor Rfc="XAXX010101000"/><c:Receptor Rfc="XEXX010101000"/>',
      ),
    ),
  );
  assert.throws(() =>
    readCfdiReceiver(xml.replace("http://www.sat.gob.mx/cfd/4", "urn:fake")),
  );
  assert.throws(() => parseCfdi(xml.replace("2026-09-15", "2026-02-30")));
});
test("body limits reject both declared and streamed oversize requests", async () => {
  await assert.rejects(
    () =>
      readBody(
        new Request("http://localhost", {
          method: "POST",
          headers: { "Content-Length": "100" },
          body: "x",
        }),
        10,
      ),
    (e) => e instanceof ApiError && e.status === 413,
  );
  await assert.rejects(
    () =>
      readBody(
        new Request("http://localhost", {
          method: "POST",
          body: "12345678901",
        }),
        10,
      ),
    (e) => e instanceof ApiError && e.status === 413,
  );
  assert.equal(
    Buffer.from(
      await readBody(
        new Request("http://localhost", { method: "POST", body: "123" }),
        10,
      ),
    ).toString(),
    "123",
  );
});
test("configured OCR adapter enforces its response contract and surfaces provider failures", async () => {
  const previousUrl = process.env.OCR_API_URL;
  const original = globalThis.fetch;
  process.env.OCR_API_URL = "https://ocr.example.test/analyze";
  try {
    globalThis.fetch = async () =>
      Response.json({
        provider: "contract-fixture",
        fields: { merchant: "Fixture", total: "20.00" },
        confidence: 0.8,
      });
    assert.equal(
      (
        await getTicketOcrAdapter().analyze({
          content: new Uint8Array([1]),
          mimeType: "image/png",
        })
      ).fields.total,
      "20.00",
    );
    globalThis.fetch = async () =>
      Response.json({ provider: "bad", fields: { total: 20 }, confidence: 5 });
    await assert.rejects(() =>
      getTicketOcrAdapter().analyze({
        content: new Uint8Array([1]),
        mimeType: "image/png",
      }),
    );
    globalThis.fetch = async () => new Response("unavailable", { status: 503 });
    await assert.rejects(
      () =>
        getTicketOcrAdapter().analyze({
          content: new Uint8Array([1]),
          mimeType: "image/png",
        }),
      /OCR_UNAVAILABLE/,
    );
  } finally {
    globalThis.fetch = original;
    if (previousUrl === undefined) delete process.env.OCR_API_URL;
    else process.env.OCR_API_URL = previousUrl;
  }
});
