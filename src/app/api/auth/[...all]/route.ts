import { getAuth } from "@/lib/auth";
import { apiError, readBody } from "@/lib/http";

async function handle(request: Request) {
  try {
    if (request.method === "POST") {
      const body = await readBody(request, 32768);
      request = new Request(request.url, {
        method: "POST",
        headers: request.headers,
        body,
      });
    }
    return await getAuth().handler(request);
  } catch (error) {
    return apiError(error);
  }
}
export const GET = handle;
export const POST = handle;
