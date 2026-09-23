import { apiError, assertSameOrigin, readUpload, ApiError } from "@/lib/http";
import { requireTenant } from "@/lib/tenant";
import { listTickets, uploadTicket } from "@/services/tickets";
export async function GET(request: Request) {
  try {
    const p = new URL(request.url).searchParams;
    const page = Math.max(
      1,
      Math.min(100000, Math.floor(Number(p.get("page")) || 1)),
    );
    return Response.json(await listTickets(p.get("q") || "", page));
  } catch (e) {
    return apiError(e);
  }
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await requireTenant();
    const form = await readUpload(request);
    const file = form.get("file");
    if (!(file instanceof File))
      throw new ApiError(400, "Selecciona un archivo.");
    return Response.json(await uploadTicket(file), { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
