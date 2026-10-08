import "server-only";
import { randomUUID } from "node:crypto";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { pinnedPortalRequest, PortalNetworkError } from "./url-security";
import type {
  BillingAutomationRunner,
  BillingContext,
  RunnerResult,
} from "./types";

type Phase = "prepare" | "fill" | "submit" | "collect";
type Transport = typeof pinnedPortalRequest;
/** Server-owned, reviewed manifest. Never build selectors or network rules from OCR/user input. */
export type PortalManifest = {
  key: string;
  portalUrl: string;
  allowedHosts: string[];
  marker: string;
  fields: Record<string, { selector: string; kind: "input" | "select" }>;
  submitSelector: string;
  resultMarker: string;
  xmlLink: string;
  pdfLink?: string;
  requests: Record<Phase, { method: string; url: string }[]>;
};
type Session = {
  context: BrowserContext;
  page: Page;
  manifest: PortalManifest;
  digest: string;
  phase: Phase;
  submitted: boolean;
  createdAt: number;
  busy: boolean;
  requests: number;
  bytes: number;
  expires: ReturnType<typeof setTimeout>;
};
export async function guardedRequest(
  raw: string,
  method: string,
  manifest: PortalManifest,
  phase: Phase,
  transport: Transport = pinnedPortalRequest,
  headers?: Record<string, string>,
  body?: Buffer,
) {
  let current = raw;
  for (let redirects = 0; redirects <= 5; redirects++) {
    const url = new URL(current);
    if (
      !manifest.allowedHosts.includes(url.hostname) ||
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      !manifest.requests[phase].some(
        (r) => r.method === method && r.url === url.href,
      )
    )
      throw new PortalNetworkError("INVALID_URL");
    const response = await transport(url.href, {
      allowedHosts: manifest.allowedHosts,
      method,
      headers,
      body,
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    if (!response.headers.location || redirects === 5)
      throw new PortalNetworkError("INVALID_URL");
    current = new URL(response.headers.location, url).href;
    if (new URL(current).origin !== url.origin)
      headers = Object.fromEntries(
        Object.entries(headers ?? {}).filter(
          ([key]) => !/^(cookie|authorization|origin|referer)$/i.test(key),
        ),
      );
    if (
      response.status === 303 ||
      ([301, 302].includes(response.status) && method === "POST")
    ) {
      method = "GET";
      body = undefined;
    }
    // The next iteration checks the exact URL and re-resolves/pins its public IP.
  }
  throw new PortalNetworkError("INVALID_URL");
}
/** Local/reference worker, not loaded into Next routes. Production uses the HTTP runner.
 * Injected transport is solely for controlled fixtures; production must use pinnedPortalRequest.
 * Short-lived contexts and no screenshots/download directory keep fiscal data off disk. */
export class LocalBillingAutomationRunner implements BillingAutomationRunner {
  private sessions = new Map<string, Session>();
  constructor(
    private browser: Browser,
    private manifests: PortalManifest[],
    private transport: Transport = pinnedPortalRequest,
  ) {}
  async close() {
    for (const session of this.sessions.values()) {
      clearTimeout(session.expires);
      await session.context.close();
    }
    this.sessions.clear();
  }
  async run(
    action: Phase,
    billing: BillingContext,
    sessionId?: string,
  ): Promise<RunnerResult> {
    const manifest = this.manifests.find(
      (m) => m.key === billing.adapterKey && m.portalUrl === billing.billingUrl,
    );
    if (!manifest)
      return { state: "MANUAL", errorCode: "UNSUPPORTED_PROVIDER" };
    const digest = JSON.stringify(billing);
    let session = sessionId ? this.sessions.get(sessionId) : undefined;
    if (action !== "prepare" && (!session || session.digest !== digest))
      return { state: "MANUAL", errorCode: "AUTOMATION_TIMEOUT" };
    if (session?.busy) return { state: "PENDING", sessionId };
    try {
      if (action === "prepare") {
        if (this.sessions.size >= 20)
          return { state: "MANUAL", errorCode: "AUTOMATION_TIMEOUT" };
        const previous = [...this.sessions.entries()].find(
          ([, s]) => s.digest === digest,
        );
        if (previous) return { state: "PREPARED", sessionId: previous[0] };
        const context = await this.browser.newContext({
          serviceWorkers: "block",
          acceptDownloads: false,
        });
        context.setDefaultTimeout(10000);
        context.setDefaultNavigationTimeout(15000);
        await context.routeWebSocket("**/*", (socket) => socket.close());
        const page = await context.newPage();
        sessionId = randomUUID();
        const id = sessionId;
        session = {
          context,
          page,
          manifest,
          digest,
          phase: "prepare",
          submitted: false,
          createdAt: Date.now(),
          busy: false,
          requests: 0,
          bytes: 0,
          expires: setTimeout(() => {
            this.sessions.delete(id);
            void context.close();
          }, 10 * 60000),
        };
        session.expires.unref();
        this.sessions.set(sessionId, session);
        const active = session;
        await context.route("**/*", async (route) => {
          try {
            active.requests++;
            if (active.requests > 120 || active.bytes > 24 * 1024 * 1024)
              throw new PortalNetworkError("DOWNLOAD_FAILED");
            const req = route.request();
            const result = await guardedRequest(
              req.url(),
              req.method(),
              manifest,
              active.phase,
              this.transport,
              await req.allHeaders(),
              req.postDataBuffer() ?? undefined,
            );
            const headers = Object.fromEntries(
              Object.entries(result.headers).filter(
                ([key]) =>
                  !/^(content-length|transfer-encoding|connection|content-encoding)$/i.test(
                    key,
                  ),
              ),
            );
            active.bytes += result.body.length;
            if (active.bytes > 24 * 1024 * 1024)
              throw new PortalNetworkError("DOWNLOAD_FAILED");
            await route.fulfill({
              status: result.status,
              headers,
              body: result.body,
            });
          } catch {
            await route.abort("blockedbyclient").catch(() => {});
          }
        });
        await page.goto(manifest.portalUrl, { waitUntil: "domcontentloaded" });
        if ((await page.locator(manifest.marker).count()) !== 1)
          return { state: "MANUAL", errorCode: "PORTAL_CHANGED", sessionId };
        return { state: "PREPARED", sessionId };
      }
      if (!session) return { state: "MANUAL", errorCode: "AUTOMATION_TIMEOUT" };
      session.busy = true;
      session.phase = action;
      if (action === "fill") {
        if (session.submitted) return { state: "PENDING", sessionId };
        const verifiedFields: Record<string, string> = {};
        for (const field of billing.fields.filter(
          (f) => f.required || (f.value && manifest.fields[f.key]),
        )) {
          const mapping = manifest.fields[field.key];
          if (!mapping)
            return { state: "MANUAL", errorCode: "FIELD_NOT_FOUND" };
          const locator = session.page.locator(mapping.selector);
          if ((await locator.count()) !== 1)
            return { state: "MANUAL", errorCode: "PORTAL_CHANGED" };
          if (mapping.kind === "select")
            await locator.selectOption(field.value);
          else await locator.fill(field.value);
          verifiedFields[field.key] = await locator.inputValue();
          if (verifiedFields[field.key] !== field.value)
            return { state: "MANUAL", errorCode: "VALIDATION_ERROR" };
        }
        return { state: "PREPARED", sessionId, verifiedFields };
      }
      if (action === "submit") {
        if (session.submitted) return { state: "PENDING", sessionId };
        // Revalidate the actual form immediately before clicking, not only at preparation.
        for (const field of billing.fields.filter(
          (f) => f.required || (f.value && manifest.fields[f.key]),
        )) {
          const mapping = manifest.fields[field.key];
          if (
            !mapping ||
            (await session.page.locator(mapping.selector).inputValue()) !==
              field.value
          )
            return { state: "MANUAL", errorCode: "VALIDATION_ERROR" };
        }
        if ((await session.page.locator(manifest.submitSelector).count()) !== 1)
          return { state: "MANUAL", errorCode: "PORTAL_CHANGED" };
        session.submitted = true;
        await session.page.locator(manifest.submitSelector).click();
        return { state: "SUBMITTED", sessionId };
      }
      if (!session.submitted)
        return { state: "MANUAL", errorCode: "VALIDATION_ERROR" };
      if ((await session.page.locator(manifest.resultMarker).count()) !== 1)
        return { state: "PENDING", sessionId };
      const xmlHref = await session.page
        .locator(manifest.xmlLink)
        .getAttribute("href");
      if (!xmlHref) return { state: "PENDING", sessionId };
      const cookies = await session.context.cookies(manifest.portalUrl);
      const headers = {
        cookie: cookies.map((c) => c.name + "=" + c.value).join("; "),
      };
      const xml = await guardedRequest(
        new URL(xmlHref, manifest.portalUrl).href,
        "GET",
        manifest,
        "collect",
        this.transport,
        headers,
      );
      if (xml.status !== 200 || xml.body.length > 1024 * 1024)
        return { state: "MANUAL", errorCode: "DOWNLOAD_FAILED" };
      let pdfBase64: string | undefined;
      if (
        manifest.pdfLink &&
        (await session.page.locator(manifest.pdfLink).count()) === 1
      ) {
        const pdfHref = await session.page
          .locator(manifest.pdfLink)
          .getAttribute("href");
        if (pdfHref) {
          const pdf = await guardedRequest(
            new URL(pdfHref, manifest.portalUrl).href,
            "GET",
            manifest,
            "collect",
            this.transport,
            headers,
          );
          if (pdf.status !== 200)
            return { state: "MANUAL", errorCode: "DOWNLOAD_FAILED" };
          pdfBase64 = pdf.body.toString("base64");
        }
      }
      return {
        state: "RESULT",
        sessionId,
        xmlBase64: xml.body.toString("base64"),
        pdfBase64,
      };
    } catch {
      return {
        state: "FAILED",
        sessionId,
        errorCode: action === "submit" ? "SUBMIT_AMBIGUOUS" : "PORTAL_CHANGED",
      };
    } finally {
      if (session) session.busy = false;
    }
  }
}
