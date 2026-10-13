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
import {
  pendingCsfExpired,
  prefillClientValues,
} from "../src/components/fiscal/client-csf-prefill";

test("pre-creation consent uses newClient exclusively and correlates a null client result", async () => {
  const request = {
    ...consentRequest,
    purpose: "CLIENT_FISCAL_PREFILL" as const,
    newClient: true as const,
  };
  const result = {
    ...extraction,
    purpose: request.purpose,
    precreationCsfReference: "test-opaque-reference",
  };
  const transport: CsfTransport = {
    consent: async (body) => {
      assert.equal(body.newClient, true);
      assert.equal(body.clientId, undefined);
      return { ...consent, purpose: request.purpose };
    },
    extract: async () => result,
  };
  assert.equal(await extractAuthorizedCsf(transport, request), result);
  await assert.rejects(
    extractAuthorizedCsf(transport, {
      ...request,
      clientId: "existing-client",
    }),
  );
});

test("client prefill leaves null fields and non-extractable/contact values intact, choosing no regime", () => {
  const values = {
    rfc: "old",
    legalName: "old",
    street: "manual street",
    personType: "COMPANY",
    fiscalRegime: "601",
    cfdiUse: "G03",
    email: "manual@example.test",
    phone: "manual",
    defaultPaymentForm: "99",
  };
  const result = prefillClientValues(values, {
    ...extraction,
    fields: {
      ...extraction.fields,
      email: { value: "untrusted@example.test" },
      cfdiUse: { value: "untrusted" },
    } as typeof extraction.fields,
  });
  assert.equal(result.rfc, extraction.fields.rfc.value);
  assert.equal(result.legalName, extraction.fields.legalName.value);
  for (const field of [
    "street",
    "fiscalRegime",
    "cfdiUse",
    "email",
    "phone",
    "defaultPaymentForm",
  ])
    assert.equal(result[field], values[field as keyof typeof values]);
  assert.equal(values.rfc, "old");
});

test("pending CSF expiry treats missing or malformed expiration/reference as unavailable", () => {
  const now = Date.now();
  const base = {
    id: "document",
    fileName: "synthetic.pdf",
    precreationCsfReference: "opaque",
  };
  assert(pendingCsfExpired(base, now));
  assert(pendingCsfExpired({ ...base, expiresAt: "invalid" }, now));
  assert(
    pendingCsfExpired({ ...base, expiresAt: new Date(now).toISOString() }, now),
  );
  assert.equal(
    pendingCsfExpired(
      { ...base, expiresAt: new Date(now + 1000).toISOString() },
      now,
    ),
    false,
  );
});

test("real client upload preserves only safe pre-creation metadata", async () => {
  const originalFetch = globalThis.fetch;
  const asset = {
    id: "document",
    fileName: "synthetic.pdf",
    precreationCsfReference: "opaque",
    expiresAt: "2026-10-13T00:00:00Z",
  };
  try {
    globalThis.fetch = async () =>
      Response.json({ ...asset, storagePath: "never-expose" });
    assert.deepEqual(
      await clientCsfTransport.upload!(new File(["test"], "synthetic.pdf")),
      asset,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

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
