import { apiError, assertSameOrigin, readJson } from "@/lib/http";
import { listClients, saveClient } from "@/services/clients";
export async function GET(request: Request) {
  try {
    const p = new URL(request.url).searchParams;
    return Response.json(
      await listClients(p.get("q") ?? "", p.get("archived") === "true"),
    );
  } catch (e) {
    return apiError(e);
  }
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    return Response.json(await saveClient(await readJson(request)), {
      status: 201,
    });
  } catch (e) {
    return apiError(e);
  }
}
