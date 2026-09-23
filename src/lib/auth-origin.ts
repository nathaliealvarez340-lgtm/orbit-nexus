// Shared by Better Auth and private mutation checks: never infer trust from Host.
export function authOrigin(env: NodeJS.ProcessEnv = process.env) {
  const configured = env.BETTER_AUTH_URL?.trim();
  if (!configured && (env.NODE_ENV === "production" || env.VERCEL)) {
    throw new Error("BETTER_AUTH_URL_REQUIRED");
  }
  let url: URL;
  try {
    url = new URL(configured || "http://localhost:3000");
  } catch {
    throw new Error("BETTER_AUTH_URL_INVALID");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.hostname.includes("*") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (env.VERCEL && loopback) ||
    ((env.NODE_ENV === "production" || env.VERCEL) &&
      url.protocol !== "https:" &&
      !loopback)
  )
    throw new Error("BETTER_AUTH_URL_INVALID");
  return url.origin;
}
