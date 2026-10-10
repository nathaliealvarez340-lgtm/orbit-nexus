import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { LegalLinks } from "./legal-links";
import { CookiePreferencesButton } from "./cookie-consent";
import type { LegalContent } from "@/lib/legal-content";
export function LegalPage({
  content,
  children,
}: {
  content: LegalContent;
  children?: React.ReactNode;
}) {
  return (
    <main className="legal-page">
      <header>
        <Logo />
        <p className="legal-eyebrow">ORBIT Nexus · Información del servicio</p>
        <h1>{content.title}</h1>
        <p className="legal-summary">{content.summary}</p>
        {content.version && <p>Versión {content.version}</p>}
        {content.effectiveDate && (
          <p>
            Vigente desde{" "}
            <time dateTime={content.effectiveDate}>
              {new Intl.DateTimeFormat("es-MX", {
                dateStyle: "long",
                timeZone: "UTC",
              }).format(new Date(content.effectiveDate))}
            </time>
          </p>
        )}
        {!content.approved && (
          <p className="legal-notice">
            Información operativa disponible. El documento legal completo está
            pendiente de revisión y aprobación por el responsable del servicio.
          </p>
        )}
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
