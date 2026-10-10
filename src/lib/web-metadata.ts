import type { Metadata } from "next";
export function siteOrigin(
  env: Record<string, string | undefined> = process.env,
) {
  try {
    const url = new URL(env.BETTER_AUTH_URL || "http://localhost:3101");
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}
export const publicPaths = [
  "/",
  "/login",
  "/register",
  "/forgot-password",
  "/privacy",
  "/terms",
  "/cookies",
] as const;
export const privateRobots: Metadata["robots"] = {
  index: false,
  follow: false,
  nocache: true,
};
export const webDescription =
  "Organiza tickets, gastos, clientes y la preparación de facturas en un espacio de trabajo financiero y fiscal para tu empresa.";
export function publicMetadata(title: string, path: string): Metadata {
  return {
    title,
    description: webDescription,
    alternates: { canonical: path },
    openGraph: {
      title: `${title} | ORBIT Nexus`,
      description: webDescription,
      url: path,
      siteName: "ORBIT Nexus",
      locale: "es_MX",
      type: "website",
    },
  };
}
