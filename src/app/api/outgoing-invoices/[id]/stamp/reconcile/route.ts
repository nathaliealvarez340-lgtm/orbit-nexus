import { getDb } from "@/lib/db";
import { assertSameOrigin, enforceRateLimit } from "@/lib/http";
import { stampApiError } from "@/lib/stamp-api";
import { reconcileStampAttempt } from "@/services/cfdi40-stamp";
import { validateStoredInvoice } from "@/services/outgoing-invoices";
import { requireInvoicePlan } from "@/services/plans";

// Fase 5C.8: reconciles the UNKNOWN attempt of an invoice by re-sending the same sealed bytes
// with the same CustomID. No body: the attempt is resolved server-side from the invoice.
export const maxDuration = 60;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const { organizationId, userId, role } = await requireInvoicePlan();
    await enforceRateLimit("stamp:" + userId, 10, 60);
    return Response.json(
      await reconcileStampAttempt(
        getDb(),
        { organizationId, userId, role },
        (await params).id,
        { revalidate: validateStoredInvoice },
      ),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return stampApiError(error);
  }
}
