import type { LegalSection } from "@/types/legal";
import type { LegalFacts } from "../facts";

// Fase 5C.2 §5: terms limited to how ORBIT NEXUS actually works. Commercial conditions,
// governing law and jurisdiction are not invented; while they are undefined the
// document stays in DRAFT. Any text change requires a new version in ../registry.ts.
export function termsSections(facts: LegalFacts): LegalSection[] {
  const owner = facts.controller?.name ?? "el titular de ORBIT NEXUS";
  return [
    {
      id: "alcance",
      title: "Alcance del servicio",
      paragraphs: [
        "ORBIT NEXUS es una plataforma para organizar la operación financiera y fiscal de una organización: captura de tickets, registro de gastos, reportes mensuales, perfil fiscal, catálogo de clientes, preparación de facturas y facturación asistida de tickets ante los portales de los comercios.",
        "ORBIT NEXUS es una herramienta de apoyo. No sustituye la asesoría fiscal, contable ni legal, y no determina por sí misma el tratamiento fiscal ni la deducibilidad de una operación.",
      ],
    },
    {
      id: "cuentas",
      title: "Cuentas y seguridad",
      paragraphs: [
        "Para usar ORBIT NEXUS necesitas una cuenta con datos verdaderos. Eres responsable de mantener la confidencialidad de tu contraseña y de las acciones realizadas con tu cuenta. Avísanos si sospechas un acceso no autorizado.",
        "Cada organización administra a sus miembros y sus permisos. Quien invita o administra miembros es responsable de otorgar acceso solo a personas autorizadas.",
      ],
    },
    {
      id: "obligaciones",
      title: "Obligaciones del usuario",
      paragraphs: ["Al usar ORBIT NEXUS te comprometes a:"],
      items: [
        "Incorporar únicamente información y documentos que estés autorizado a tratar, incluidos los datos de tus clientes.",
        "Revisar los datos detectados automáticamente antes de confirmarlos.",
        "Cumplir tus obligaciones fiscales y conservar los comprobantes y registros que la ley te exija, con independencia de ORBIT NEXUS.",
        "Usar el servicio conforme a la ley y a estos términos.",
      ],
    },
    {
      id: "informacion-fiscal",
      title: "Exactitud de la información fiscal",
      paragraphs: [
        "La lectura automática de tickets y de constancias puede contener errores. Los datos solo se guardan como definitivos cuando los confirmas, y eres responsable de que la información fiscal confirmada sea exacta y esté vigente.",
      ],
    },
    {
      id: "uso-permitido",
      title: "Uso permitido",
      paragraphs: ["No está permitido:"],
      items: [
        "Acceder o intentar acceder a información de otra organización o cuenta.",
        "Eludir los controles de seguridad, los límites de uso o la aprobación humana previa a operaciones fiscales.",
        "Usar ORBIT NEXUS para emitir, alterar o simular comprobantes fiscales en nombre de terceros sin autorización.",
        "Introducir código malicioso, sobrecargar el servicio o automatizar su uso por medios no previstos.",
        "Incorporar contenido ilícito o datos de terceros sin base legítima.",
      ],
    },
    {
      id: "documentos-fiscales",
      title: "Documentos fiscales",
      paragraphs: [
        "Los documentos que incorporas pertenecen a tu organización y se almacenan de forma privada. Autorizas a ORBIT NEXUS a procesarlos únicamente para prestar las funciones que utilices, conforme al Aviso de Privacidad.",
      ],
    },
    {
      id: "sat-pac",
      title: "Relación con el SAT y con los proveedores de certificación (PAC)",
      paragraphs: [
        "ORBIT NEXUS no es una autoridad fiscal ni un proveedor de certificación de CFDI (PAC). En esta versión no timbra comprobantes. Cuando exista una integración de timbrado, el timbrado lo realizará un PAC autorizado por el SAT y ORBIT NEXUS no garantiza su aceptación.",
        "En la facturación de tickets, el comprobante lo emite el comercio a través de su portal. ORBIT NEXUS solo prepara la información y la envía después de tu aprobación expresa; no considera una factura obtenida sin evidencia del comprobante.",
      ],
    },
    {
      id: "disponibilidad",
      title: "Disponibilidad",
      paragraphs: [
        "Procuramos que ORBIT NEXUS esté disponible de forma continua, pero no garantizamos un nivel de servicio específico. El servicio puede interrumpirse por mantenimiento, por fallas propias o de proveedores, o por la indisponibilidad de servicios externos como portales de comercios, el SAT o un PAC. Cuando una integración externa no está disponible, ORBIT NEXUS ofrece una alternativa manual en lugar de simular un resultado.",
      ],
    },
    {
      id: "suspension",
      title: "Suspensión",
      paragraphs: [
        "Podemos suspender una cuenta u organización cuando exista un riesgo de seguridad, un uso contrario a estos términos o un requerimiento de autoridad competente. Cuando sea posible, te avisaremos y te indicaremos el motivo.",
      ],
    },
    {
      id: "propiedad-intelectual",
      title: "Propiedad intelectual",
      paragraphs: [
        `El software, la marca y los materiales de ORBIT NEXUS pertenecen a ${owner}. Estos términos no te transfieren ningún derecho sobre ellos más allá de usar el servicio. La información y los documentos que incorporas siguen siendo de tu organización.`,
      ],
    },
    {
      id: "planes",
      title: "Planes y pagos",
      paragraphs: [
        "ORBIT NEXUS ofrece distintos planes con funciones diferentes. Esta versión no procesa cobros. Los precios, la forma de pago y las condiciones comerciales de cada plan se publicarán antes de que se cobre cualquier importe, y no se aplicará ningún cargo sin que los aceptes.",
      ],
    },
    {
      id: "limitaciones",
      title: "Limitaciones",
      paragraphs: [
        "ORBIT NEXUS no es responsable de las decisiones tomadas con información que no fue revisada, de la operación de portales de terceros, del SAT o de un PAC, ni de los contenidos que los usuarios incorporen. Nada en estos términos limita derechos que la ley no permita renunciar.",
      ],
    },
    {
      id: "terminacion",
      title: "Terminación",
      paragraphs: [
        "Puedes dejar de usar ORBIT NEXUS en cualquier momento. Podemos terminar el acceso por un incumplimiento grave de estos términos. La conservación y eliminación de la información después de la terminación se rigen por el Aviso de Privacidad.",
      ],
    },
    {
      id: "cambios",
      title: "Cambios a estos términos",
      paragraphs: [
        "Cada cambio genera una nueva versión con su fecha de vigencia. Cuando un cambio requiera tu aceptación, te la solicitaremos antes de aplicarlo.",
      ],
    },
    {
      id: "legislacion",
      title: "Legislación aplicable y jurisdicción",
      paragraphs: [
        facts.governingLawAndJurisdiction ??
          "La legislación aplicable y la jurisdicción se establecerán en la versión vigente de estos términos.",
      ],
    },
    {
      id: "contacto",
      title: "Contacto",
      paragraphs: [
        facts.termsContact
          ? `Para cualquier asunto relacionado con estos términos escribe a ${facts.termsContact}.`
          : "El medio de contacto sobre estos términos se publicará en su versión vigente.",
      ],
    },
  ];
}
