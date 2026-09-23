import "server-only";
import { ZodError } from "zod";
import { createHash } from "node:crypto";
import { getDb } from "./db";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function apiError(error: unknown) {
  if (error instanceof ApiError)
    return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof ZodError)
    return Response.json(
      {
        error: "Revisa los campos indicados.",
        fields: error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  // Never log requests, credentials, documents, fiscal data or provider errors.
  return Response.json(
    { error: "No pudimos completar la operación. Intenta nuevamente." },
    { status: 503 },
  );
}
export function assertSameOrigin(request: Request) {
  const expected = new URL(
    process.env.BETTER_AUTH_URL || "http://localhost:3000",
  ).origin;
  if (request.headers.get("origin") !== expected)
    throw new ApiError(403, "Origen no permitido.");
}
export async function readBody(request: Request, maxBytes: number) {
  if (Number(request.headers.get("content-length")) > maxBytes)
    throw new ApiError(413, "El archivo o solicitud es demasiado grande.");
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new ApiError(413, "El archivo o solicitud es demasiado grande.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
export async function readJson(request: Request) {
  try {
    return JSON.parse(
      Buffer.from(await readBody(request, 32768)).toString("utf8"),
    );
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(400, "Solicitud inválida.");
  }
}
export async function readUpload(
  request: Request,
  maxBytes = 10 * 1024 * 1024 + 65536,
) {
  const body = await readBody(request, maxBytes);
  try {
    return await new Response(body, {
      headers: { "Content-Type": request.headers.get("content-type") || "" },
    }).formData();
  } catch {
    throw new ApiError(400, "Archivo inválido.");
  }
}
export async function enforceRateLimit(
  key: string,
  limit = 30,
  windowSeconds = 60,
) {
  const hash = createHash("sha256").update(key).digest("hex");
  const now = new Date();
  const expires = new Date(now.getTime() + windowSeconds * 1000);
  const rows = await getDb().$queryRaw<Array<{ count: number }>>`
    INSERT INTO "RequestLimit" ("key", "count", "expiresAt") VALUES (${hash}, 1, ${expires})
    ON CONFLICT ("key") DO UPDATE SET "count" = CASE WHEN "RequestLimit"."expiresAt" <= ${now} THEN 1 ELSE "RequestLimit"."count" + 1 END,
    "expiresAt" = CASE WHEN "RequestLimit"."expiresAt" <= ${now} THEN ${expires} ELSE "RequestLimit"."expiresAt" END RETURNING "count"`;
  if (rows[0].count > limit)
    throw new ApiError(429, "Demasiadas solicitudes. Espera un momento.");
}
