import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { LegalLinks } from "./legal-links";
import { CookiePreferencesButton } from "./cookie-consent";
import type { LegalDocument, LegalSection } from "@/types/legal";
import { LegalAcceptance } from "./legal-acceptance";

// Presentation only: legal text and publication state come from the server registry.
// The cookie policy uses the same layout without implying a legal publication.
export function LegalPageLayout({
  content,
  summary,
  notice,
  children,
}: {
  content: { title: string; sections: LegalSection[] };
  summary: string;
  notice?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <main className="legal-page">
      <header>
        <Logo />
        <p className="legal-eyebrow">ORBIT Nexus · Información del servicio</p>
        <h1>{content.title}</h1>
        <p className="legal-summary">{summary}</p>
        {notice}
      </header>
      <div className="legal-layout">
        <nav aria-label="Contenido de la página" className="legal-toc">
          <h2>En esta página</h2>
          {content.sections.map((section) => (
            <Link key={section.id} href={`#${section.id}`}>
              {section.title}
            </Link>
          ))}
        </nav>
        <article>
          {content.sections.map((section) => (
            <section key={section.id} id={section.id} tabIndex={-1}>
              <h2>{section.title}</h2>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
              {section.items && (
                <ul className="list-disc space-y-3 pl-6">
                  {section.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}
          {children}
        </article>
      </div>
      <footer>
        <LegalLinks />
        <div className="mt-4">
          <CookiePreferencesButton label="Preferencias de cookies" />
        </div>
        <Link href="/login" className="legal-back">
          Volver al acceso
        </Link>
      </footer>
    </main>
  );
}

export function LegalPage({ document }: { document: LegalDocument }) {
  const published = document.status === "PUBLISHED";
  return (
    <LegalPageLayout
      content={document}
      summary={
        published
          ? "Documento publicado de ORBIT Nexus."
          : "Versión preliminar de ORBIT Nexus, disponible para revisión."
      }
      notice={
        <div data-legal-status={document.status}>
          <p>Versión {document.version}</p>
          {published && document.effectiveDate && (
            <p>
              Vigente desde{" "}
              <time dateTime={document.effectiveDate}>
                {new Intl.DateTimeFormat("es-MX", {
                  dateStyle: "long",
                  timeZone: "UTC",
                }).format(new Date(document.effectiveDate))}
              </time>
            </p>
          )}
          {!published && (
            <div className="legal-notice">
              <p>
                Documento en revisión. Aún no está publicado como versión
                definitiva y no puede aceptarse.
              </p>
              {document.pendingTopics.length > 0 && (
                <details className="mt-4">
                  <summary className="cursor-pointer">
                    Temas pendientes de aprobación
                  </summary>
                  <ul className="mt-3 list-disc space-y-2 pl-6">
                    {document.pendingTopics.map((topic) => (
                      <li key={topic}>{topic}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </div>
      }
    >
      {published && (
        <LegalAcceptance
          key={document.contentHash}
          document={{
            kind: document.kind,
            status: document.status,
            version: document.version,
            contentHash: document.contentHash,
          }}
        />
      )}
    </LegalPageLayout>
  );
}
