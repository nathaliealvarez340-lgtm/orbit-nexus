import assert from "node:assert/strict";
import { before, test } from "node:test";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Cfdi40Error } from "../src/lib/cfdi40/errors";
import { pacSubmission } from "../src/lib/cfdi40/schema";
import type { XsdValidatedCfdi40 } from "../src/lib/cfdi40/types";
import {
  createSwPacAdapter,
  swMaxRequestBytes,
} from "../src/lib/pac/sw/adapter";
import {
  resolveSwPacConfiguration,
  swHostAllowed,
  swOrigins,
  swStampPath,
} from "../src/lib/pac/sw/config";
import { classifySwResponse, swMessageParts } from "../src/lib/pac/sw/response";
import { customIdFor, type PacStampOutcome } from "../src/lib/pac/types";
import {
  readMultipart,
  simulateStamp,
  stampingKit,
  swJson,
  type StampingKit,
} from "./fixtures/stamping";

// Fase 5C.8: the real SW adapter against a SIMULATED transport (no network). The adapter
// code, the request it builds and the classification are the production ones; only fetch
// is replaced. Responses imitate the shapes documented by SW; they are not real PAC output.

const b64url = () => randomBytes(24).toString("base64url");
// A runtime test value with the JWT shape SW requires; never a real credential, never sent.
const token = `${b64url()}.${b64url()}.${b64url()}`;
const sandboxEnv = { PAC_ENVIRONMENT: "SANDBOX", SW_SANDBOX_TOKEN: token };
const customId = customIdFor("2f1c6c2a-8a8e-4c43-9d5e-0b1f0c7e9a11");

let kit: StampingKit;
let sent: XsdValidatedCfdi40;
before(async () => {
  kit = await stampingKit();
  sent = kit.validate(kit.seal("ingreso-pue-iva16"));
});

type Call = { url: string; init: RequestInit };
function adapterWith(
  respond: (call: Call, index: number) => Promise<Response> | Response,
  options: Parameters<typeof createSwPacAdapter>[1] = {},
) {
  const calls: Call[] = [];
  const configuration = resolveSwPacConfiguration(sandboxEnv);
  const adapter = createSwPacAdapter(configuration, {
    transport: async (url, init) => {
      const call = { url, init };
      calls.push(call);
      return respond(call, calls.length - 1);
    },
    sleep: async () => undefined,
    ...options,
  });
  return { adapter, calls };
}
const stamp = (adapter: ReturnType<typeof adapterWith>["adapter"]) =>
  adapter.stamp({ submission: pacSubmission(sent), customId });
const assertNoSecret = (value: unknown) => {
  const text = JSON.stringify(value, (_k, v) =>
    v instanceof Uint8Array ? Buffer.from(v).toString("utf8") : v,
  );
  assert(!text.includes(token), "token leaked");
  assert(!text.includes(token.split(".")[1]), "token part leaked");
};

test("configuration: SANDBOX only, token from SW_SANDBOX_TOKEN, PRODUCTION blocked, nothing invented", () => {
  const configured = resolveSwPacConfiguration(sandboxEnv);
  assert(configured.available && configured.token === token);
  assert.deepEqual(
    [configured.available, configured.environment, configured.origin],
    [true, "SANDBOX", "https://services.test.sw.com.mx"],
  );
  assert.equal(swStampPath, "/v4/cfdi33/stamp/v4");
  // Malformed values are built at runtime (no literal credential-like strings in the repo).
  const notJwt = ["not", "a", "jwt"].join("-");
  const spaced = ["a b", "c", "d"].join(".");
  for (const [env, code] of [
    [{ PAC_ENVIRONMENT: "SANDBOX" }, "PAC_SANDBOX_UNAVAILABLE"],
    [{}, "PAC_SANDBOX_UNAVAILABLE"],
    [{ SW_SANDBOX_TOKEN: notJwt }, "PAC_SANDBOX_UNAVAILABLE"],
    [
      { SW_SANDBOX_TOKEN: token + "\r\nX-Injected: 1" },
      "PAC_SANDBOX_UNAVAILABLE",
    ],
    [{ SW_SANDBOX_TOKEN: spaced }, "PAC_SANDBOX_UNAVAILABLE"],
    [
      { PAC_ENVIRONMENT: "PRODUCTION", SW_SANDBOX_TOKEN: token },
      "PAC_PRODUCTION_BLOCKED",
    ],
    [
      { PAC_ENVIRONMENT: "PRODUCTION", SW_PRODUCTION_TOKEN: token },
      "PAC_PRODUCTION_BLOCKED",
    ],
    [
      { PAC_ENVIRONMENT: "staging", SW_SANDBOX_TOKEN: token },
      "PAC_SANDBOX_UNAVAILABLE",
    ],
  ] as const) {
    const result = resolveSwPacConfiguration(env);
    assert.equal(result.available, false, JSON.stringify(env));
    assert.equal(!result.available && result.code, code);
    assert(!JSON.stringify(result).includes(token));
  }
  assert.throws(() =>
    createSwPacAdapter(
      resolveSwPacConfiguration({ PAC_ENVIRONMENT: "SANDBOX" }),
    ),
  );
  assert.throws(() =>
    createSwPacAdapter({
      available: false,
      environment: "PRODUCTION",
      code: "PAC_PRODUCTION_BLOCKED",
    }),
  );
});

test("network boundary: only https://services.test.sw.com.mx in SANDBOX; production host refused in this phase", () => {
  const ok = new URL(swStampPath, swOrigins.SANDBOX);
  assert.equal(swHostAllowed(ok, "SANDBOX"), true);
  for (const href of [
    "http://services.test.sw.com.mx/v4/cfdi33/stamp/v4",
    "https://services.test.sw.com.mx:8443/v4/cfdi33/stamp/v4",
    "https://user:pass@services.test.sw.com.mx/v4/cfdi33/stamp/v4",
    "https://services.test.sw.com.mx.evil.example/v4/cfdi33/stamp/v4",
    "https://localhost/v4/cfdi33/stamp/v4",
    "https://127.0.0.1/v4/cfdi33/stamp/v4",
    "https://10.0.0.1/v4/cfdi33/stamp/v4",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/",
    "https://services.sw.com.mx/v4/cfdi33/stamp/v4",
  ])
    assert.equal(swHostAllowed(new URL(href), "SANDBOX"), false, href);
  assert.equal(
    swHostAllowed(new URL(swStampPath, swOrigins.PRODUCTION), "PRODUCTION"),
    false,
  );
});

test("request: one POST of the exact XsdValidatedCfdi40 bytes, Bearer token, customid, multipart xml, no redirects, timeout signal", async () => {
  const stamped = simulateStamp(kit, sent);
  const { adapter, calls } = adapterWith(() =>
    swJson(200, { data: stamped.data, status: "success" }),
  );
  const outcome = await stamp(adapter);
  assert.equal(calls.length, 1);
  const [{ url, init }] = calls;
  assert.equal(url, "https://services.test.sw.com.mx/v4/cfdi33/stamp/v4");
  assert.equal(init.method, "POST");
  assert.equal(init.redirect, "manual");
  assert(init.signal instanceof AbortSignal);
  const parts = readMultipart(init);
  assert(parts.wellFormed);
  assert(Buffer.from(parts.xml).equals(Buffer.from(sent.bytes)), "exact bytes");
  assert.equal(parts.authorization, "Bearer " + token);
  assert.equal(parts.customId, customId);
  assert(customId.length <= 100 && !/\s/.test(customId));
  assert.equal(outcome.kind, "EVIDENCE");
  assert.equal(outcome.kind === "EVIDENCE" && outcome.code, "PAC_STAMPED");
  assert(
    outcome.kind === "EVIDENCE" &&
      Buffer.from(outcome.evidence.cfdi!).toString("utf8") === stamped.cfdi,
  );
  assertNoSecret(outcome);
});

test("only an XsdValidatedCfdi40 can leave ORBIT; CustomID and size are checked before any request", async () => {
  const { adapter, calls } = adapterWith(() => swJson(200, {}));
  const forged = { ...sent } as XsdValidatedCfdi40;
  await assert.rejects(
    adapter.stamp({ submission: { cfdi: forged }, customId }),
    (error: unknown) =>
      error instanceof Cfdi40Error &&
      error.issues[0].code === "XSD_VALIDATED_CFDI_REQUIRED",
  );
  await assert.rejects(
    adapter.stamp({
      submission: pacSubmission(sent),
      customId: "orbit-RFC-SCA010101AB1",
    }),
    /PAC_CUSTOM_ID_INVALID/,
  );
  assert.equal(calls.length, 0);
  assert(swMaxRequestBytes >= 64 * 1024);
});

const outcomeOf = async (response: () => Response | Promise<Response>) => {
  const { adapter, calls } = adapterWith(() => response());
  const outcome = await stamp(adapter);
  assertNoSecret(outcome);
  return { outcome, calls };
};
const summary = (outcome: PacStampOutcome) => ({
  kind: outcome.kind,
  code: outcome.code,
  ...(outcome.kind === "REJECTED" ? { retryable: outcome.retryable } : {}),
  providerCode: outcome.providerCode,
});

test("documented SW answers are classified: success, 307, CFDI3307, CFDI40xxx, 301, AU2001, 401, 429", async () => {
  const stamped = simulateStamp(kit, sent);
  const cases: [string, () => Response, ReturnType<typeof summary>][] = [
    [
      "success v4",
      () => swJson(200, { data: stamped.data, status: "success" }),
      { kind: "EVIDENCE", code: "PAC_STAMPED", providerCode: null },
    ],
    [
      "307 previously stamped (same Sello) with the stamp",
      () =>
        swJson(400, {
          message: "307. El comprobante contiene un timbre previo.",
          messageDetail: null,
          data: stamped.data,
          status: "error",
        }),
      { kind: "EVIDENCE", code: "PAC_PREVIOUSLY_STAMPED", providerCode: "307" },
    ],
    [
      "CFDI3307 duplicate CustomID with only the TFD",
      () =>
        swJson(400, {
          message:
            "CFDI3307 - Timbre duplicado. El customId proporcionado está duplicado.",
          messageDetail: null,
          data: { tfd: stamped.tfdXml, cfdi: "" },
          status: "error",
        }),
      {
        kind: "UNKNOWN",
        code: "PAC_DUPLICATE_CUSTOM_ID",
        providerCode: "CFDI3307",
      },
    ],
    [
      "CFDI3307 duplicate CustomID with only the UUID (v4)",
      () =>
        swJson(400, {
          message:
            "CFDI3307 - Timbre duplicado. El customId proporcionado está duplicado.",
          messageDetail: null,
          data: { uuid: stamped.uuid },
          status: "error",
        }),
      {
        kind: "UNKNOWN",
        code: "PAC_DUPLICATE_CUSTOM_ID",
        providerCode: "CFDI3307",
      },
    ],
    [
      "CFDI3307 duplicate CustomID with the full stamp",
      () =>
        swJson(400, {
          message:
            "CFDI3307 - Timbre duplicado. El customId proporcionado está duplicado.",
          messageDetail: null,
          data: stamped.data,
          status: "error",
        }),
      {
        kind: "EVIDENCE",
        code: "PAC_DUPLICATE_CUSTOM_ID",
        providerCode: "CFDI3307",
      },
    ],
    [
      "CFDI40119 SAT validation",
      () =>
        swJson(400, {
          message:
            "CFDI40119 - El campo Total no corresponde con la suma del subtotal, menos los descuentos aplicables, más las contribuciones recibidas.",
          messageDetail: ". ValorEsperado: 4016.22 ValorReportado: 4016.24",
          data: null,
          status: "error",
        }),
      {
        kind: "REJECTED",
        code: "PAC_CFDI_REJECTED",
        retryable: false,
        providerCode: "CFDI40119",
      },
    ],
    [
      "301 structure",
      () =>
        swJson(400, {
          message: "301 - La estructura del comprobante es incorrecta.",
          messageDetail:
            "Error al leer el documento XML. Line 1, position 1363.",
          data: null,
          status: "error",
        }),
      {
        kind: "REJECTED",
        code: "PAC_CFDI_REJECTED",
        retryable: false,
        providerCode: "301",
      },
    ],
    [
      "AU2001 no balance",
      () =>
        swJson(401, {
          message: "AU2001 - El usuario no tiene saldo en timbres.",
          messageDetail: "",
          data: null,
          status: "error",
        }),
      {
        kind: "REJECTED",
        code: "PAC_NO_BALANCE",
        retryable: true,
        providerCode: "AU2001",
      },
    ],
    [
      "401 token",
      () =>
        swJson(401, {
          message: "El token debe contener 3 partes",
          messageDetail: "",
          data: null,
          status: "error",
        }),
      {
        kind: "REJECTED",
        code: "PAC_AUTH_FAILED",
        retryable: true,
        providerCode: null,
      },
    ],
    [
      "429",
      () =>
        new Response("slow down", {
          status: 429,
          headers: { "Content-Type": "text/plain" },
        }),
      {
        kind: "REJECTED",
        code: "PAC_RATE_LIMITED",
        retryable: true,
        providerCode: null,
      },
    ],
    [
      "404 other explicit refusal",
      () => new Response("", { status: 404 }),
      {
        kind: "REJECTED",
        code: "PAC_REQUEST_REJECTED",
        retryable: false,
        providerCode: null,
      },
    ],
  ];
  for (const [label, response, expected] of cases) {
    const { outcome, calls } = await outcomeOf(response);
    assert.equal(calls.length, 1, label);
    assert.deepEqual(summary(outcome), expected, label);
    // messageDetail (values) is never kept; catalog text only when it has no digits.
    if (outcome.kind === "REJECTED") {
      assert(!JSON.stringify(outcome).includes("4016.22"), label);
      assert(!JSON.stringify(outcome).includes("1363"), label);
      assert(!/[0-9]/.test(outcome.providerMessage ?? ""), label);
    }
  }
  const rejected = (await outcomeOf(cases[5][1])).outcome;
  assert.equal(
    rejected.kind === "REJECTED" && rejected.providerMessage,
    "El campo Total no corresponde con la suma del subtotal, menos los descuentos aplicables, más las contribuciones recibidas.",
  );
  assert.deepEqual(swMessageParts("El token debe contener 3 partes"), {
    code: null,
    text: null,
  });
});

test("ambiguous answers are UNKNOWN, never failures: 5xx, redirect, malformed, wrong type, oversized, truncated, success without CFDI", async () => {
  const stamped = simulateStamp(kit, sent);
  const cases: [string, () => Response | Promise<Response>, string][] = [
    [
      "500",
      () => swJson(500, { message: "Error", status: "error" }),
      "PAC_SERVER_ERROR",
    ],
    [
      "502 html",
      () => new Response("<html>bad gateway</html>", { status: 502 }),
      "PAC_SERVER_ERROR",
    ],
    [
      "302 redirect to another host",
      () =>
        new Response(null, {
          status: 302,
          headers: { Location: "https://evil.example/steal" },
        }),
      "PAC_REDIRECT",
    ],
    [
      "malformed JSON",
      () =>
        new Response('{"data":', {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      "PAC_RESPONSE_INVALID",
    ],
    [
      "text/html 200",
      () =>
        new Response(
          JSON.stringify({ status: "success", data: stamped.data }),
          { status: 200, headers: { "Content-Type": "text/html" } },
        ),
      "PAC_RESPONSE_INVALID",
    ],
    ["JSON array", () => swJson(200, [stamped.data]), "PAC_RESPONSE_INVALID"],
    [
      "success without cfdi",
      () => swJson(200, { status: "success", data: { uuid: stamped.uuid } }),
      "PAC_RESPONSE_INVALID",
    ],
    [
      "success with only a UUID field (contract §19.2)",
      () => swJson(200, { success: true, uuid: stamped.uuid }),
      "PAC_RESPONSE_INVALID",
    ],
    [
      "error status on 200",
      () => swJson(200, { status: "error", message: "Algo", data: null }),
      "PAC_RESPONSE_INVALID",
    ],
    [
      "declared oversized",
      () =>
        new Response("{}", {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Content-Length": String(6 * 1024 * 1024),
          },
        }),
      "PAC_RESPONSE_TOO_LARGE",
    ],
    [
      "streamed oversized",
      () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(new Uint8Array(1024 * 1024).fill(0x20));
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      "PAC_RESPONSE_TOO_LARGE",
    ],
    [
      "truncated body (connection cut after headers)",
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode('{"data":{"cfdi":"<cfdi:Comp'),
              );
              controller.error(
                Object.assign(new Error("socket hang up"), {
                  code: "ECONNRESET",
                }),
              );
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      "PAC_CONNECTION_LOST",
    ],
  ];
  for (const [label, response, code] of cases) {
    const { outcome, calls } = await outcomeOf(response);
    assert.equal(calls.length, 1, label + ": never followed or retried");
    assert.equal(outcome.kind, "UNKNOWN", label);
    assert.equal(outcome.code, code, label);
  }
});

test("timeout and connection loss after sending are UNKNOWN; a POST is never retried blindly", async () => {
  const hang = adapterWith(
    (call) =>
      new Promise<Response>((_resolve, reject) =>
        call.init.signal!.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
        ),
      ),
    { timeoutMs: 30 },
  );
  const timedOut = await stamp(hang.adapter);
  assert.deepEqual(summary(timedOut), {
    kind: "UNKNOWN",
    code: "PAC_TIMEOUT",
    providerCode: null,
  });
  assert.equal(hang.calls.length, 1);
  const slowBody = adapterWith(
    (call) =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("{"));
            call.init.signal!.addEventListener("abort", () =>
              controller.error(new Error("aborted")),
            );
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    { timeoutMs: 30 },
  );
  assert.equal((await stamp(slowBody.adapter)).code, "PAC_TIMEOUT");
  for (const code of ["ECONNRESET", "UND_ERR_SOCKET", "EPIPE", undefined]) {
    const { adapter, calls } = adapterWith(() => {
      throw Object.assign(new TypeError("fetch failed"), {
        cause: code ? Object.assign(new Error(code), { code }) : undefined,
      });
    });
    const outcome = await stamp(adapter);
    assert.deepEqual(summary(outcome), {
      kind: "UNKNOWN",
      code: "PAC_CONNECTION_LOST",
      providerCode: null,
    });
    assert.equal(calls.length, 1, String(code));
  }
});

test("only a connection never established is retried (same bytes, same CustomID, bounded backoff), then NOT_SUBMITTED", async () => {
  const waits: number[] = [];
  const { adapter, calls } = adapterWith(
    () => {
      throw Object.assign(new TypeError("fetch failed"), {
        cause: Object.assign(new Error("getaddrinfo ENOTFOUND"), {
          code: "ENOTFOUND",
        }),
      });
    },
    { sleep: async (ms) => void waits.push(ms) },
  );
  const outcome = await stamp(adapter);
  assert.deepEqual(summary(outcome), {
    kind: "REJECTED",
    code: "PAC_NOT_SUBMITTED",
    retryable: true,
    providerCode: null,
  });
  assert.equal(calls.length, 3);
  assert.deepEqual(waits, [250, 1000]);
  const bodies = calls.map((c) =>
    Buffer.from(readMultipart(c.init).xml).toString("utf8"),
  );
  assert(bodies.every((b) => b === sent.xml));
  assert(calls.every((c) => readMultipart(c.init).customId === customId));
  // A refused connection, then success: the stamp comes back on the retry.
  const stamped = simulateStamp(kit, sent);
  const recovering = adapterWith((_call, index) => {
    if (index === 0)
      throw Object.assign(new TypeError("fetch failed"), {
        cause: Object.assign(new Error("connect ECONNREFUSED"), {
          code: "ECONNREFUSED",
        }),
      });
    return swJson(200, { status: "success", data: stamped.data });
  });
  assert.equal((await stamp(recovering.adapter)).code, "PAC_STAMPED");
  assert.equal(recovering.calls.length, 2);
});

test("classifier unit: status before body for explicit refusals; unknown fields ignored; bounded fields", () => {
  const stamped = simulateStamp(kit, sent);
  const body = (value: unknown) =>
    new Uint8Array(Buffer.from(JSON.stringify(value)));
  const success = classifySwResponse({
    status: 200,
    contentType: "application/json",
    body: body({
      status: "success",
      data: { ...stamped.data, extra: { nested: true }, uuid: 7 },
    }),
    problem: null,
  });
  assert.equal(success.kind, "EVIDENCE");
  assert(
    success.kind === "EVIDENCE" && success.evidence.fields.uuid === undefined,
  );
  const oversizedField = classifySwResponse({
    status: 200,
    contentType: "application/json",
    body: body({
      status: "success",
      data: { ...stamped.data, cfdi: "x".repeat(4 * 1024 * 1024 + 1) },
    }),
    problem: null,
  });
  assert.equal(oversizedField.kind, "UNKNOWN");
  const refusedTruncated = classifySwResponse({
    status: 401,
    contentType: "application/json",
    body: null,
    problem: "TRUNCATED",
  });
  assert.equal(refusedTruncated.code, "PAC_AUTH_FAILED");
});

test("adapter code: server-only, constant origins, token only in the Authorization header, no logs", async () => {
  const adapter = await readFile("src/lib/pac/sw/adapter.ts", "utf8");
  const config = await readFile("src/lib/pac/sw/config.ts", "utf8");
  const response = await readFile("src/lib/pac/sw/response.ts", "utf8");
  assert.match(adapter, /^import "server-only";/);
  for (const text of [adapter, config, response]) {
    assert(
      !/\bconsole\.|\beval\(|new Function|child_process|node:fs/.test(text),
    );
    assert(
      !/messageDetail\s*[:=]|\.messageDetail\b/.test(
        text.replace(/\/\/.*$/gm, ""),
      ),
    );
  }
  // The token is read once (config) and used once (Authorization header).
  assert.equal(config.match(/swSandboxTokenVariable\]/g)?.length, 1);
  assert.equal(adapter.match(/configuration\.token/g)?.length, 1);
  assert.match(adapter, /redirect: "manual"/);
  assert(!/process\.env/.test(adapter));
});
