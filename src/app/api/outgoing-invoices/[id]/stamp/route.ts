import { getDb } from "@/lib/db";
import { assertSameOrigin, enforceRateLimit, readJson } from "@/lib/http";
import { stampApiError } from "@/lib/stamp-api";
import { invoiceStampingState, stampInvoice } from "@/services/cfdi40-stamp";
import { validateStoredInvoice } from "@/services/outgoing-invoices";
import { requireInvoicePlan } from "@/services/plans";

// Fase 5C.8 (src/types/stamping.ts): GET the stamping state of an invoice; POST stamps it in
// fiscal SANDBOX with the explicit authorization of that version. The Organization comes from
// the session membership; the browser sends only { expectedVersion, authorization }.
export const maxDuration = 60;

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const { organizationId, userId, role } = await requireInvoicePlan();
    return Response.json(
      await invoiceStampingState(
        getDb(),
        { organizationId, userId, role },
        (await params).id,
        {},
      ),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return stampApiError(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    assertSameOrigin(request);
    const { organizationId, userId, role } = await requireInvoicePlan();
    // Separate from normal edits (FASE5C §27.7); idempotency and locks still apply.
    await enforceRateLimit("stamp:" + userId, 10, 60);
    const body = await readJson(request, 4096);
    return Response.json(
      await stampInvoice(
        getDb(),
        { organizationId, userId, role },
        (await params).id,
        body,
        { revalidate: validateStoredInvoice },
      ),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return stampApiError(error);
  }
}
