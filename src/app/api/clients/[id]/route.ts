import { assertSameOrigin, readJson } from "@/lib/http";
import { codedApiError } from "@/lib/invoice-api";
import { archiveClient, saveClient } from "@/services/clients";
type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    return Response.json(
      await saveClient(await readJson(request), (await context.params).id),
    );
  } catch (e) {
    return codedApiError(e);
  }
}
export async function DELETE(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    return Response.json(await archiveClient((await context.params).id));
  } catch (e) {
    return codedApiError(e);
  }
}
