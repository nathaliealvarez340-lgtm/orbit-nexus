import { assertSameOrigin, readJson } from "@/lib/http";
import { codedApiError } from "@/lib/invoice-api";
import { listClients, saveClient } from "@/services/clients";
export async function GET(request: Request) {
  try {
    const p = new URL(request.url).searchParams;
    return Response.json(
      await listClients(p.get("q") ?? "", p.get("archived") === "true"),
    );
  } catch (e) {
    return codedApiError(e);
  }
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    return Response.json(await saveClient(await readJson(request)), {
      status: 201,
    });
  } catch (e) {
    return codedApiError(e);
  }
}
