import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  describeError,
  logSafeError,
  redact,
  redactHeaders,
  redactText,
} from "../src/lib/security/redact";
import {
  documentFields,
  uploadPolicies,
  validateUpload,
  type UploadCategory,
} from "../src/lib/upload-validation";
import type { MalwareScanner } from "../src/lib/security/malware-scan";
import {
  apiContentSecurityPolicy,
  contentSecurityPolicy,
  securityHeaders,
} from "../src/lib/security/headers";
import nextConfig from "../next.config";
import {
  buildLegalDocument,
  currentLegalDocument,
  legalDocumentBySlug,
  legalDocumentKinds,
  legalDocumentSummary,
  LegalPublicationError,
} from "../src/lib/legal/registry";
import { legalFacts, type LegalFacts } from "../src/lib/legal/facts";
import {
  auditCatalog,
  changedFieldNames,
  recordAuditEvent,
  sanitizeAuditMetadata,
  type AuditAction,
} from "../src/lib/audit";
import { isSecretKey } from "../src/lib/security/redact";
import {
  acceptLegalDocument,
  legalAcceptanceSchema,
} from "../src/services/legal-acceptances";

const syntheticFacts: LegalFacts = {
  controller: {
    name: "Responsable sintético de prueba",
    address: "Domicilio sintético de prueba",
  },
  privacyContact: "privacidad@example.test",
  termsContact: "terminos@example.test",
  retentionStatement: "Plazos sintéticos de prueba.",
  providerDisclosure: "Proveedores sintéticos de prueba.",
  governingLawAndJurisdiction: "Legislación sintética de prueba.",
};
const publishedAs = (version: string) => ({
  version,
  status: "PUBLISHED" as const,
  effectiveDate: "2026-11-01",
  legalReviewApproved: true,
});

// Synthetic secrets are built at runtime so the repository never holds credential literals.
const synthetic = (label: string) =>
  `Synthetic-${label}-${randomBytes(8).toString("hex")}`;

// --- Redaction ------------------------------------------------------------------------

test("redaction drops credentials, fiscal payloads and identifiers from log data", () => {
  const secrets = {
    password: synthetic("password"),
    newPassword: synthetic("password"),
    resetToken: synthetic("token"),
    privateKey: [
      "-----BEGIN",
      "PRIVATE KEY-----\nMIIE\n-----END",
      "PRIVATE KEY-----",
    ].join(" "),
  };
  const bearer = ["Bearer", "abc.def.ghi"].join(" ");
  const input = {
    headers: Object.fromEntries([
      ["authorization", bearer],
      ["cookie", "a=b"],
    ]),
    ...secrets,
    verificationCode: "123456",
    xml: "<cfdi:Comprobante/>",
    content: Buffer.from("PDF bytes"),
    rfc: "XAXX010101000",
    email: "persona@example.test",
    note: "RFC XAXX010101000, correo persona@example.test, Bearer secret-token-value",
    nested: { deep: { csfFields: { rfc: "AAA010101AAA" } } },
    count: 3,
  };
  const output = JSON.stringify(redact(input));
  for (const forbidden of [
    "abc.def.ghi",
    "a=b",
    "Synthetic-password",
    secrets.resetToken,
    "123456",
    "BEGIN PRIVATE KEY",
    "Comprobante",
    "PDF bytes",
    "XAXX010101000",
    "AAA010101AAA",
    "persona@example.test",
    "secret-token-value",
  ])
    assert(!output.includes(forbidden), forbidden + " leaked: " + output);
  assert(output.includes('"count":3'));
  const hidden = "[redacted]";
  assert.deepEqual(
    redactHeaders(
      new Headers([
        ["Authorization", bearer],
        ["Cookie", "s=1"],
        ["Set-Cookie", "s=1"],
        ["Accept", "application/json"],
      ]),
    ),
    Object.fromEntries([
      ["accept", "application/json"],
      ["authorization", hidden],
      ["cookie", hidden],
      ["set-cookie", hidden],
    ]),
  );
  const connection = [
    "postgresql://user",
    synthetic("db") + "@db.example.test/app",
  ].join(":");
  assert.equal(redactText(connection), "[credentials]@db.example.test/app");
  assert.equal(redactText("CURP XEXX010101HNEXXXA4"), "CURP [curp]");
});

test("unexpected errors are logged as class and code only, never message or SQL", () => {
  const prismaLike = Object.assign(
    new Error(
      "Invalid `prisma.client.create()` invocation: INSERT INTO \"Client\" VALUES ('XAXX010101000')",
    ),
    {
      name: "PrismaClientKnownRequestError",
      code: "P2002",
      meta: {
        target: ["rfc"],
        driverAdapterError: { cause: { originalCode: "23505" } },
      },
    },
  );
  assert.deepEqual(describeError(prismaLike), {
    name: "PrismaClientKnownRequestError",
    code: "P2002/23505",
  });
  assert.deepEqual(describeError("text"), { name: "string" });
  const logged = mock.method(console, "error", () => {});
  try {
    logSafeError("api", prismaLike);
    const line = String(logged.mock.calls[0].arguments[0]);
    assert.deepEqual(JSON.parse(line), {
      level: "error",
      scope: "api",
      name: "PrismaClientKnownRequestError",
      code: "P2002/23505",
    });
    assert(!line.includes("XAXX") && !line.includes("INSERT"));
  } finally {
    logged.mock.restore();
  }
});

// --- Uploads --------------------------------------------------------------------------

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDioAAAAASUVORK5CYII=",
  "base64",
);
const pdf = Buffer.from("%PDF-1.7\n%synthetic\n");
const file = (bytes: Buffer | string, name: string, type: string) =>
  new File([typeof bytes === "string" ? bytes : new Uint8Array(bytes)], name, {
    type,
  });
const rejects = (promise: Promise<unknown>, status?: number) =>
  assert.rejects(promise, (error: { status?: number }) =>
    status ? error.status === status : true,
  );

test("each upload category has an explicit size limit and type allowlist", async () => {
  const active = ["image/svg+xml", "text/html", "application/javascript"];
  for (const [category, policy] of Object.entries(uploadPolicies)) {
    assert(policy.maxBytes > 0 && policy.maxBytes <= 10 * 1024 * 1024);
    for (const type of active)
      assert(!(policy.types as string[]).includes(type), category);
  }
  assert.equal(uploadPolicies.INVOICE_LOGO.maxBytes, 2 * 1024 * 1024);
  assert.deepEqual(uploadPolicies.CSF.types, ["application/pdf"]);
  // CSF and client CSF only accept PDF; a renamed image is rejected.
  for (const category of ["CSF", "CLIENT_CSF"] as UploadCategory[]) {
    await rejects(validateUpload(file(png, "csf.png", "image/png"), category));
    await rejects(
      validateUpload(file(png, "csf.pdf", "application/pdf"), category),
    );
    assert.equal(
      (await validateUpload(file(pdf, "csf.pdf", "application/pdf"), category))
        .mimeType,
      "application/pdf",
    );
  }
  await rejects(
    validateUpload(
      file(Buffer.alloc(2 * 1024 * 1024 + 1), "logo.png", "image/png"),
      "INVOICE_LOGO",
    ),
    413,
  );
  await rejects(
    validateUpload(file(pdf, "logo.pdf", "application/pdf"), "INVOICE_LOGO"),
  );
  for (const category of Object.keys(uploadPolicies) as UploadCategory[])
    await rejects(
      validateUpload(
        file('<svg onload="alert(1)"/>', "image.svg", "image/svg+xml"),
        category,
      ),
    );
});

test("XML uploads are data only: no DTD, entities, invalid UTF-8 or oversized files", async () => {
  const valid = '<?xml version="1.0" encoding="UTF-8"?><cfdi:Comprobante/>';
  assert.equal(
    (
      await validateUpload(
        file(valid, "cfdi.xml", "application/xml"),
        "RECEIVED_CFDI_XML",
      )
    ).mimeType,
    "application/xml",
  );
  for (const bad of [
    '<!DOCTYPE x [<!ENTITY a SYSTEM "file:///etc/passwd">]><x>&a;</x>',
    '<x><!ENTITY a "b"></x>',
    "<x>\u0000</x>",
    "not xml",
  ])
    await rejects(
      validateUpload(
        file(bad, "cfdi.xml", "application/xml"),
        "RECEIVED_CFDI_XML",
      ),
      400,
    );
  await rejects(
    validateUpload(
      file(Buffer.from([0x3c, 0x78, 0xff, 0xfe, 0x3e]), "cfdi.xml", "text/xml"),
      "RECEIVED_CFDI_XML",
    ),
    400,
  );
  await rejects(
    validateUpload(
      file(
        "<x>" + "a".repeat(1024 * 1024) + "</x>",
        "fiscal.xml",
        "application/xml",
      ),
      "FISCAL_DOCUMENT",
    ),
    400,
  );
  // XML is never accepted where the category does not expect it.
  await rejects(
    validateUpload(file(valid, "t.xml", "application/xml"), "TICKET"),
  );
});

test("stored names are display-only and the malware boundary never fakes a clean result", async () => {
  const upload = await validateUpload(
    file(png, "../../.hidden/..ticket.png", "image/png"),
    "TICKET",
  );
  assert(!upload.fileName.includes("/") && !upload.fileName.startsWith("."));
  assert.equal(upload.malwareScan, "NOT_CONFIGURED");
  assert.deepEqual(Object.keys(documentFields(upload)).sort(), [
    "content",
    "fileName",
    "mimeType",
    "sha256",
    "size",
  ]);
  const scanner = (status: Awaited<ReturnType<MalwareScanner["scan"]>>) => ({
    scan: async () => status,
  });
  await rejects(
    validateUpload(
      file(png, "t.png", "image/png"),
      "TICKET",
      scanner("INFECTED"),
    ),
    422,
  );
  await rejects(
    validateUpload(file(png, "t.png", "image/png"), "TICKET", scanner("ERROR")),
    503,
  );
  assert.equal(
    (
      await validateUpload(
        file(png, "t.png", "image/png"),
        "TICKET",
        scanner("CLEAN"),
      )
    ).malwareScan,
    "CLEAN",
  );
});

// --- Security headers -----------------------------------------------------------------

const headerMap = (env: Record<string, string>, path: string) => {
  const result = new Map<string, string>();
  for (const rule of securityHeaders(env)) {
    const prefix = rule.source.replace("/:path*", "");
    if (path === prefix || path.startsWith(prefix + "/") || prefix === "")
      for (const header of rule.headers) result.set(header.key, header.value);
  }
  return result;
};

test("security headers: strict CSP without eval in production, HSTS only on production HTTPS", () => {
  const production = { NODE_ENV: "production", VERCEL_ENV: "production" };
  const page = headerMap(production, "/dashboard/reports");
  const csp = page.get("Content-Security-Policy")!;
  assert(!csp.includes("unsafe-eval"));
  assert(!/https?:/.test(csp), "no external origins: " + csp);
  for (const directive of [
    "default-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests",
  ])
    assert(csp.includes(directive), directive);
  assert.equal(page.get("Strict-Transport-Security"), "max-age=63072000");
  assert.equal(page.get("X-Frame-Options"), "DENY");
  assert.equal(page.get("X-Content-Type-Options"), "nosniff");
  assert.equal(page.get("Cache-Control"), "private, no-store");
  assert.equal(page.get("Referrer-Policy"), "no-referrer");
  assert.match(page.get("Permissions-Policy")!, /camera=\(self\)/);
  assert.match(page.get("Permissions-Policy")!, /microphone=\(\)/);

  const api = headerMap(production, "/api/documents/x");
  assert.equal(api.get("Content-Security-Policy"), apiContentSecurityPolicy);
  assert.equal(api.get("Cross-Origin-Resource-Policy"), "same-origin");

  const landing = headerMap(production, "/");
  assert.equal(
    landing.get("Referrer-Policy"),
    "strict-origin-when-cross-origin",
  );
  assert.equal(landing.get("Cache-Control"), undefined);

  // Local production build over http (E2E): no HSTS and no upgrade of http requests.
  const local = headerMap(
    { NODE_ENV: "production", BETTER_AUTH_URL: "http://localhost:3000" },
    "/",
  );
  assert.equal(local.get("Strict-Transport-Security"), undefined);
  assert(!local.get("Content-Security-Policy")!.includes("upgrade-insecure"));
  assert.equal(
    headerMap({ VERCEL_ENV: "preview" }, "/").get("Strict-Transport-Security"),
    undefined,
  );
  assert.match(
    contentSecurityPolicy({ NODE_ENV: "development" }),
    /'unsafe-eval'/,
  );
});

test("next.config serves the central security headers", async () => {
  assert.deepEqual(await nextConfig.headers!(), securityHeaders());
});

// --- Legal versioning ------------------------------------------------------------------

// Each version is pinned to its exact text: changing a text requires a new version.
const pinnedHashes: Record<string, string> = {
  "aviso-privacidad-2026-10-borrador-1":
    "96473c1b36ff7d23ee8a0ac2cb8eaa079f1c6a2f4f637d33ec188a832b9de768",
  "terminos-2026-10-borrador-1":
    "6f948ad65ce621a516608d60a22e3eb286ab6f26745b68f84d3cee37afea8ce8",
};

test("legal documents are versioned, pinned to their content and remain drafts until defined", () => {
  for (const kind of legalDocumentKinds) {
    const document = currentLegalDocument(kind);
    assert.equal(
      document.contentHash,
      pinnedHashes[document.version],
      `${kind} text changed without a new version`,
    );
    assert.equal(document.status, "DRAFT");
    assert.equal(document.effectiveDate, null);
    assert(document.pendingTopics.length > 0);
    assert.equal(legalDocumentBySlug(document.slug), document);
    assert(!("sections" in legalDocumentSummary(document)));
  }
  assert.equal(legalDocumentBySlug("otro"), null);
  // Defining a fact changes the text, hence the hash.
  const filled = buildLegalDocument("PRIVACY_NOTICE", {
    ...legalFacts,
    privacyContact: "privacidad@example.test",
  });
  assert.notEqual(
    filled.contentHash,
    currentLegalDocument("PRIVACY_NOTICE").contentHash,
  );
});

test("a legal document cannot be published with undefined facts, date or review", () => {
  for (const kind of legalDocumentKinds) {
    assert.throws(
      () => buildLegalDocument(kind, legalFacts, publishedAs("v1")),
      LegalPublicationError,
    );
    assert.throws(
      () =>
        buildLegalDocument(kind, syntheticFacts, {
          ...publishedAs("v1"),
          legalReviewApproved: false,
        }),
      LegalPublicationError,
    );
    assert.throws(
      () =>
        buildLegalDocument(kind, syntheticFacts, {
          ...publishedAs("v1"),
          effectiveDate: null,
        }),
      LegalPublicationError,
    );
    const published = buildLegalDocument(
      kind,
      syntheticFacts,
      publishedAs("v1"),
    );
    assert.equal(published.status, "PUBLISHED");
    assert.deepEqual(published.pendingTopics, []);
  }
});

test("legal texts cover every required topic and never show placeholders", () => {
  const ids = (kind: "PRIVACY_NOTICE" | "TERMS") =>
    currentLegalDocument(kind).sections.map((s) => s.id);
  for (const id of [
    "responsable",
    "datos",
    "finalidades-primarias",
    "finalidades-secundarias",
    "documentos-fiscales",
    "tickets",
    "cfdi",
    "clientes",
    "cookies",
    "proveedores",
    "seguridad",
    "conservacion",
    "eliminacion",
    "arco",
    "limitacion",
    "revocacion",
    "cambios",
    "contacto",
    "version",
  ])
    assert(ids("PRIVACY_NOTICE").includes(id), "privacy notice: " + id);
  for (const id of [
    "alcance",
    "cuentas",
    "obligaciones",
    "informacion-fiscal",
    "uso-permitido",
    "documentos-fiscales",
    "sat-pac",
    "disponibilidad",
    "suspension",
    "propiedad-intelectual",
    "planes",
    "limitaciones",
    "terminacion",
    "legislacion",
    "contacto",
    "version",
  ])
    assert(ids("TERMS").includes(id), "terms: " + id);
  for (const kind of legalDocumentKinds)
    for (const facts of [legalFacts, syntheticFacts]) {
      const text = JSON.stringify(buildLegalDocument(kind, facts).sections);
      assert(
        !/TODO|TBD|XXX|lorem|\{\{|\[[^\]]*pendiente[^\]]*\]|null|undefined/i.test(
          text,
        ),
        kind + " shows a placeholder",
      );
    }
  // ORBIT is never presented as a PAC nor as already compliant.
  const terms = JSON.stringify(currentLegalDocument("TERMS").sections);
  assert.match(
    terms,
    /no es una autoridad fiscal ni un proveedor de certificación/,
  );
});

// --- Audit catalog --------------------------------------------------------------------

test("audit metadata keeps only catalog keys with bounded, redacted values", () => {
  const payloadKeys =
    /^(xml|content|raww*|ocrw*|payload|snapshot|fields|regimes|rfc|email|address|legalName|password|token|cookie)$/i;
  for (const [action, definition] of Object.entries(auditCatalog))
    for (const key of definition.metadata)
      assert(
        !isSecretKey(key) && !payloadKeys.test(key),
        `${action} lists unsafe metadata key ${key}`,
      );
  assert.deepEqual(
    sanitizeAuditMetadata("client.fiscal.updated", {
      operation: "UPDATE",
      changedFields: ["rfc", "postalCode"],
      source: "MANUAL",
      rfc: "XAXX010101000",
      password: synthetic("password"),
      xml: "<x/>",
      unexpected: "value",
    }),
    {
      operation: "UPDATE",
      changedFields: ["rfc", "postalCode"],
      source: "MANUAL",
    },
  );
  assert.deepEqual(
    sanitizeAuditMetadata("csf.extraction_requested", {
      reason: "contacto XAXX010101000 persona@example.test",
    }),
    { reason: "contacto [rfc] [email]" },
  );
  assert.equal(sanitizeAuditMetadata("csf.confirmed", {}), undefined);
  assert.deepEqual(
    changedFieldNames({ rfc: "A", name: "B" }, { rfc: "A", name: "C" }, [
      "rfc",
      "name",
    ]),
    ["name"],
  );
  assert.deepEqual(changedFieldNames(null, { a: 1, b: 2 }, ["b", "a"]), [
    "a",
    "b",
  ]);
});

test("audit scope rules: tenant events need the Organization, account events have none, reserved events are blocked", async () => {
  const writes: unknown[] = [];
  const writer = {
    auditEvent: {
      create: async (args: unknown) => {
        writes.push(args);
        return { id: "event" };
      },
    },
  } as unknown as Parameters<typeof recordAuditEvent>[0];
  const record = (action: AuditAction, organizationId: string | null) =>
    recordAuditEvent(writer, { action, organizationId, actorUserId: "user" });
  await assert.rejects(
    record("fiscal_profile.updated", null),
    /ORGANIZATION_REQUIRED/,
  );
  await assert.rejects(record("legal.accepted", "org"), /HAS_NO_ORGANIZATION/);
  for (const action of [
    "csd.configured",
    "csd.revoked",
    "invoice.stamp_authorized",
    "invoice.stamped",
    "invoice.cancelled",
  ] as AuditAction[])
    await assert.rejects(record(action, "org"), /AUDIT_ACTION_RESERVED/);
  await record("legal.accepted", null);
  await record("sensitive_asset.uploaded", "org");
  assert.equal(writes.length, 2);
});

// --- Consent invariants ---------------------------------------------------------------

test("legal acceptance only accepts the exact current published text", async () => {
  const fail = () => {
    throw new Error("the database must not be reached");
  };
  const db = {
    legalAcceptance: { createMany: fail, findUniqueOrThrow: fail },
    $transaction: fail,
  } as unknown as Parameters<typeof acceptLegalDocument>[0];
  const draft = currentLegalDocument("TERMS");
  await assert.rejects(
    acceptLegalDocument(db, "user", {
      document: "TERMS",
      version: draft.version,
      contentHash: draft.contentHash,
    }),
    { code: "LEGAL_DOCUMENT_NOT_PUBLISHED" },
  );
  const published = buildLegalDocument(
    "TERMS",
    syntheticFacts,
    publishedAs("v1"),
  );
  const current = () => published;
  await assert.rejects(
    acceptLegalDocument(
      db,
      "user",
      { document: "TERMS", version: "v0", contentHash: published.contentHash },
      current,
    ),
    { code: "LEGAL_VERSION_OUTDATED" },
  );
  await assert.rejects(
    acceptLegalDocument(
      db,
      "user",
      { document: "TERMS", version: "v1", contentHash: "0".repeat(64) },
      current,
    ),
    { code: "LEGAL_VERSION_OUTDATED" },
  );
  assert(
    !legalAcceptanceSchema.safeParse({
      document: "COOKIES",
      version: "v1",
      contentHash: "0".repeat(64),
    }).success,
  );
  assert(
    !legalAcceptanceSchema.safeParse({
      document: "TERMS",
      version: "v1",
      contentHash: "abc",
    }).success,
  );
});
