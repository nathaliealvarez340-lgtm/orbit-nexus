import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractAuthorizedCsf,
  issuerCsfTransport,
  clientCsfTransport,
  type CsfTransport,
  FiscalUiError,
  fiscalErrorMessage,
} from "../src/components/fiscal/transport";
import { consent, consentRequest, extraction } from "./fiscal-ui-fixture";

test("both purposes expose real upload, terms, consent and extraction transports", () => {
  for (const transport of [issuerCsfTransport, clientCsfTransport])
    for (const key of ["upload", "terms", "consent", "extract"] as const)
      assert.equal(typeof transport[key], "function");
});
test("missing acceptance or client identity prevent all processing", async () => {
  let requests = 0;
  const transport: CsfTransport = {
    consent: async () => {
      requests++;
      return consent;
    },
    extract: async () => {
      requests++;
      return extraction;
    },
  };
  for (const request of [
    { ...consentRequest, accepted: false },
    { ...consentRequest, purpose: "CLIENT_FISCAL_PREFILL" },
  ]) {
    await assert.rejects(
      extractAuthorizedCsf(transport, request as typeof consentRequest),
    );
  }
  assert.equal(requests, 0);
});
test("null privacy version is passed unchanged; backend remains production authority", async () => {
  const result = await extractAuthorizedCsf(
    {
      consent: async (request) => {
        assert.equal(request.privacyNoticeVersion, null);
        return { ...consent, privacyNoticeVersion: null };
      },
      extract: async () => extraction,
    },
    { ...consentRequest, privacyNoticeVersion: null },
  );
  assert.equal(result.id, extraction.id);
});
test("normalized errors never display raw provider responses or stack traces", () => {
  for (const code of [
    "CONSENT_REQUIRED",
    "CONSENT_VERSION_OUTDATED",
    "PRIVACY_NOTICE_OUTDATED",
    "PRIVACY_NOTICE_MISSING",
    "DOCUMENT_NOT_AVAILABLE",
    "DOCUMENT_NOT_SUPPORTED",
    "CLIENT_REQUIRED",
    "CLIENT_NOT_AVAILABLE",
    "EXTRACTION_NOT_AVAILABLE",
  ])
    assert.notEqual(
      fiscalErrorMessage(new FiscalUiError(code, 409), "fallback"),
      "fallback",
    );
  assert.equal(
    fiscalErrorMessage(new Error("private stack trace"), "safe"),
    "safe",
  );
});
test("mismatched consent document, purpose, client or versions prevent extraction", async () => {
  let extracts = 0;
  for (const wrong of [
    { documentId: "other" },
    { purpose: "CLIENT_FISCAL_PREFILL" as const },
    { clientId: "other" },
    { consentVersion: "other" },
    { privacyNoticeVersion: "other" },
  ]) {
    await assert.rejects(
      extractAuthorizedCsf(
        {
          consent: async () => ({ ...consent, ...wrong }),
          extract: async () => {
            extracts++;
            return extraction;
          },
        },
        consentRequest,
      ),
    );
  }
  assert.equal(extracts, 0);
});
test("a result from another document, consent or client is never accepted", async () => {
  for (const wrong of [
    { documentId: "other" },
    { consentId: "other" },
    { clientId: "other" },
    { purpose: "CLIENT_FISCAL_PREFILL" as const },
  ]) {
    await assert.rejects(
      extractAuthorizedCsf(
        {
          consent: async () => consent,
          extract: async () => ({ ...extraction, ...wrong }),
        },
        consentRequest,
      ),
    );
  }
});
test("authorized extraction preserves uncertainty, all regimes, absent fields and comparisons", async () => {
  const result = await extractAuthorizedCsf(
    { consent: async () => consent, extract: async () => extraction },
    consentRequest,
  );
  assert.equal(result, extraction);
  assert.equal(result.fields.legalName.status, "LOW_CONFIDENCE");
  assert.equal(result.regimes.length, 2);
  assert.equal(result.fields.street.value, null);
  assert.equal("cfdiUse" in result.fields, false);
});
test("consent failure never initiates extraction", async () => {
  let extracts = 0;
  await assert.rejects(
    extractAuthorizedCsf(
      {
        consent: async () => {
          throw new Error("test failure");
        },
        extract: async () => {
          extracts++;
          return extraction;
        },
      },
      consentRequest,
    ),
  );
  assert.equal(extracts, 0);
});
