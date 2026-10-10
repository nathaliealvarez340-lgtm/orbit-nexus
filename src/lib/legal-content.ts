// Operational copy from existing pages. The operator must supply approved legal
// text, version and effective date. An environment version alone is not approval.
export type LegalContent = {
  title: string;
  summary: string;
  version: string | null;
  effectiveDate: string | null;
  approved: boolean;
  sections: { id: string; title: string; paragraphs: string[] }[];
};
export const legalContent: Record<"privacy" | "terms", LegalContent> = {
  privacy: {
    title: "Aviso de Privacidad",
    summary: "Cómo se utiliza y protege la información en ORBIT Nexus.",
    version: null,
    effectiveDate: null,
    approved: false,
    sections: [
      {
        id: "cuenta",
        title: "Cuenta y organizaciones",
        paragraphs: [
          "Orbit utiliza tus datos de cuenta para autenticarte y vincularte con tus organizaciones. Los tickets, gastos y datos fiscales pertenecen a la organización activa; los miembros autorizados de esa organización pueden consultarlos.",
        ],
      },
      {
        id: "documentos",
        title: "Documentos privados",
        paragraphs: [
          "Los archivos se guardan de forma privada. Si el operador configura un servicio OCR, los tickets se envían a ese servicio únicamente cuando solicitas analizarlos.",
        ],
      },
      {
        id: "facturacion",
        title: "Facturación asistida",
        paragraphs: [
          "Abrir un portal de facturación no envía automáticamente tus datos fiscales ni acredita la emisión de una factura.",
        ],
      },
      {
        id: "preferencias",
        title: "Cookies y preferencias",
        paragraphs: [
          "Las cookies necesarias mantienen tu sesión y tu selección de organización. Rechazar cookies opcionales no bloquea el inicio de sesión. Puedes consultar las categorías y cambiar tu elección en Cookies y preferencias.",
        ],
      },
    ],
  },
  terms: {
    title: "Términos del servicio",
    summary: "Alcance operativo y revisión humana en el uso de ORBIT Nexus.",
    version: null,
    effectiveDate: null,
    approved: false,
    sections: [
      {
        id: "acceso",
        title: "Acceso a la información",
        paragraphs: [
          "Orbit organiza tickets, gastos y documentos por organización. Cada usuario debe contar con autorización para incorporar y consultar la información de su espacio.",
        ],
      },
      {
        id: "revision",
        title: "Revisión de datos",
        paragraphs: [
          "Los datos detectados por OCR requieren revisión humana. Confirmar un gasto no determina por sí solo su tratamiento fiscal ni su deducibilidad.",
        ],
      },
      {
        id: "emision",
        title: "Emisión de comprobantes",
        paragraphs: [
          "La facturación asistida dirige al portal del comercio. Solo el emisor y sus proveedores autorizados pueden emitir el comprobante correspondiente. Orbit no declara una factura emitida por el hecho de abrir un portal.",
        ],
      },
    ],
  },
};
