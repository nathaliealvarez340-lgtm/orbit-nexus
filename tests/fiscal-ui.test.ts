import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractAuthorizedCsf,
  issuerCsfTransport,
  clientCsfTransport,
  type CsfTransport,
} from "../src/components/fiscal/transport";
import { consent, consentRequest, extraction } from "./fiscal-ui-fixture";

test("production capabilities only expose the existing issuer upload; no fictitious extraction or client upload", () => {
  assert.equal(typeof issuerCsfTransport.upload, "function");
  assert.equal(issuerCsfTransport.extract, undefined);
  assert.equal(issuerCsfTransport.consent, undefined);
  assert.deepEqual(clientCsfTransport, {});
});
test("missing acceptance, privacy version, or client identity prevent all processing", async () => {
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
    { ...consentRequest, privacyNoticeVersion: null },
    { ...consentRequest, purpose: "CLIENT_FISCAL_PREFILL" },
  ]) {
    await assert.rejects(
      extractAuthorizedCsf(transport, request as typeof consentRequest),
    );
  }
  assert.equal(requests, 0);
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
