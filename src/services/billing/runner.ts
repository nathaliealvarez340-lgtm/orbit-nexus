import "server-only";
import { z } from "zod";
import {
  billingErrors,
  type BillingAutomationRunner,
  type BillingContext,
  type BillingPortalAdapter,
} from "./types";
const resultSchema = z.object({
  state: z.enum([
    "PREPARED",
    "SUBMITTED",
    "PENDING",
    "RESULT",
    "MANUAL",
    "FAILED",
  ]),
  sessionId: z.string().max(200).optional(),
  verifiedFields: z
    .record(z.string().max(100), z.string().max(1000))
    .optional(),
  errorCode: z
    .string()
    .refine((code) => code in billingErrors)
    .optional(),
  xmlBase64: z.string().max(1500000).optional(),
  pdfBase64: z.string().max(14000000).optional(),
  uuid: z.uuid().optional(),
});
export class HttpBillingAutomationRunner implements BillingAutomationRunner {
  async run(
    action: "prepare" | "fill" | "submit" | "collect",
    context: BillingContext,
    sessionId?: string,
  ) {
    if (
      !process.env.BILLING_AUTOMATION_URL ||
      !process.env.BILLING_AUTOMATION_TOKEN
    )
      return {
        state: "MANUAL" as const,
        errorCode: "AUTOMATION_NOT_CONFIGURED",
      };
    try {
      const endpoint = new URL(process.env.BILLING_AUTOMATION_URL);
      if (
        endpoint.username ||
        endpoint.password ||
        (endpoint.protocol !== "https:" &&
          !(
            endpoint.protocol === "http:" &&
            ["localhost", "127.0.0.1"].includes(endpoint.hostname)
          ))
      )
        throw new Error("INVALID_URL");
      const response = await fetch(process.env.BILLING_AUTOMATION_URL, {
        method: "POST",
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(45000),
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + process.env.BILLING_AUTOMATION_TOKEN,
        },
        body: JSON.stringify({
          version: 1,
          action,
          context,
          sessionId,
          networkPolicy: "orbit-public-pinned-v1",
        }),
      });
      if (!response.ok || !response.body) throw new Error("PROVIDER_ERROR");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 16 * 1024 * 1024) {
          await reader.cancel();
          throw new Error("DOWNLOAD_FAILED");
        }
        chunks.push(value);
      }
      return resultSchema.parse(
        JSON.parse(Buffer.concat(chunks).toString("utf8")),
      );
    } catch (error) {
      // A failed response after submit must never trigger another submit.
      const timeout =
        error instanceof Error &&
        ["TimeoutError", "AbortError"].includes(error.name);
      const code = timeout
        ? "AUTOMATION_TIMEOUT"
        : error instanceof Error && error.message === "DOWNLOAD_FAILED"
          ? "DOWNLOAD_FAILED"
          : "PROVIDER_ERROR";
      return {
        state: "FAILED" as const,
        errorCode: action === "submit" ? "SUBMIT_AMBIGUOUS" : code,
      };
    }
  }
}
export class GenericManualAdapter implements BillingPortalAdapter {
  constructor(private reason = "UNSUPPORTED_PROVIDER") {}
  canHandle() {
    return true;
  }
  inspectRequirements(context: BillingContext) {
    return context.fields
      .filter((f) => f.required && !f.value)
      .map((f) => f.label);
  }
  async prepare() {
    return { state: "MANUAL" as const, errorCode: this.reason };
  }
  async fill() {
    return this.prepare();
  }
  async submit() {
    return this.prepare();
  }
  async collectResult() {
    return this.prepare();
  }
}
export class ManagedPortalAdapter implements BillingPortalAdapter {
  constructor(private runner: BillingAutomationRunner) {}
  canHandle(context: BillingContext) {
    return context.adapterKey !== "manual";
  }
  inspectRequirements(context: BillingContext) {
    return new GenericManualAdapter().inspectRequirements(context);
  }
  async prepare(context: BillingContext) {
    return this.runner.run("prepare", context);
  }
  async fill(context: BillingContext, sessionId: string) {
    return this.runner.run("fill", context, sessionId);
  }
  async submit(context: BillingContext, sessionId: string) {
    return this.runner.run("submit", context, sessionId);
  }
  async collectResult(context: BillingContext, sessionId: string) {
    return this.runner.run("collect", context, sessionId);
  }
}
export function portalAdapter(adapterKey: string): BillingPortalAdapter {
  const enabled = (process.env.BILLING_AUTOMATION_ADAPTERS ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
  return adapterKey !== "manual" && enabled.includes(adapterKey)
    ? new ManagedPortalAdapter(new HttpBillingAutomationRunner())
    : new GenericManualAdapter(
        adapterKey === "manual"
          ? "UNSUPPORTED_PROVIDER"
          : "AUTOMATION_NOT_CONFIGURED",
      );
}
