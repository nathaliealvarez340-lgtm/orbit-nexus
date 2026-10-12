import type { LegalDocumentSummary } from "@/types/legal";
import { privateRobots, publicMetadata, publicPaths } from "./web-metadata";

// Presentation/SEO helpers, never a second source of legal text or versions.
export function legalMetadata(document: LegalDocumentSummary, path: string) {
  const metadata = publicMetadata(document.title, path);
  if (document.status === "DRAFT") {
    const title = `${document.title} · Versión preliminar`;
    metadata.title = title;
    metadata.description =
      "Documento en revisión, aún no publicado como versión definitiva.";
    metadata.robots = privateRobots;
    metadata.openGraph = {
      ...metadata.openGraph,
      title: `${title} | ORBIT Nexus`,
      description: metadata.description,
    };
  }
  return metadata;
}

export function publishedPublicPaths(
  documents: readonly LegalDocumentSummary[],
) {
  return publicPaths.filter((path) => {
    const kind =
      path === "/privacy"
        ? "PRIVACY_NOTICE"
        : path === "/terms"
          ? "TERMS"
          : null;
    return (
      !kind ||
      documents.some(
        (document) => document.kind === kind && document.status === "PUBLISHED",
      )
    );
  });
}
