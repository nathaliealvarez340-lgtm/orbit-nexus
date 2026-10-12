import { LegalPageLayout } from "@/components/privacy/legal-page";
import { CookiePreferencesButton } from "@/components/privacy/cookie-consent";
import { COOKIE_POLICY_VERSION } from "@/lib/consent";
import { publicMetadata } from "@/lib/web-metadata";
export const metadata = publicMetadata("Cookies y preferencias", "/cookies");
export default function Page() {
  return (
    <LegalPageLayout
      summary="Las necesarias permanecen activas. Tú decides si permites analíticas."
      content={{
        title: "Cookies y preferencias",
        sections: [
          {
            id: "necesarias",
            title: "ESSENTIAL · Siempre activas",
            paragraphs: [
              "Better Auth mantiene tu sesión mediante cookies HttpOnly, SameSite=Lax y Secure en producción, durante siete días con renovación durante el uso.",
              "orbit.organization recuerda tu organización durante siete días. No concede acceso: el servidor comprueba tu membresía.",
              "orbit.consent guarda únicamente la versión de preferencias, la elección de analíticas y la fecha de elección durante seis meses. No contiene datos de cuenta, fiscales ni de tu organización.",
            ],
          },
          {
            id: "analiticas",
            title: "ANALYTICS · Opcionales",
            paragraphs: [
              "Vercel Web Analytics puede medir visitas a páginas generales si lo autorizas y el servicio está habilitado. La integración elimina consultas y fragmentos, y excluye rutas con identificadores y recuperación de contraseña. No enviamos datos fiscales ni propiedades de eventos personalizadas.",
              "No cargamos el proveedor antes de tu autorización. Puedes retirar el permiso en cualquier momento; los nuevos eventos quedan bloqueados. No usamos publicidad ni marketing.",
            ],
          },
          {
            id: "eleccion",
            title: "Cambiar tu elección",
            paragraphs: [
              `Versión técnica de preferencias: ${COOKIE_POLICY_VERSION}. Cuando esta versión cambie, volveremos a solicitar tu elección. Rechazar analíticas no limita el uso de ORBIT Nexus.`,
            ],
          },
        ],
      }}
    >
      <CookiePreferencesButton />
    </LegalPageLayout>
  );
}
