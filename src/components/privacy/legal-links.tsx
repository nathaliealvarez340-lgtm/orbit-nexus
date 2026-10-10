import Link from "next/link";
export function LegalLinks() {
  return (
    <nav aria-label="Información legal" className="legal-links">
      <Link href="/privacy">Aviso de Privacidad</Link>
      <Link href="/terms">Términos</Link>
      <Link href="/cookies">Cookies y preferencias</Link>
    </nav>
  );
}
