import type { LegalSection } from "@/types/legal";
import type { LegalFacts } from "../facts";

// Fase 5C.2 §5: describes the processing ORBIT NEXUS actually performs (see
// docs/tasks/FASE5C2-CONTRACT.md §3). It does not claim legal compliance by itself;
// operator facts that are not defined yet are stated neutrally and keep the document
// in DRAFT. Any text change requires a new version in ../registry.ts.
export function privacyNoticeSections(facts: LegalFacts): LegalSection[] {
  const contact = facts.privacyContact
    ? `Envía tu solicitud a ${facts.privacyContact}.`
    : "El medio para presentar solicitudes se publicará en la versión vigente de este aviso, antes de que ORBIT NEXUS trate datos personales en producción.";
  return [
    {
      id: "responsable",
      title: "Identidad y domicilio del responsable",
      paragraphs: [
        facts.controller
          ? `${facts.controller.name}, con domicilio en ${facts.controller.address}, es responsable del tratamiento de tus datos personales en ORBIT NEXUS.`
          : "La identidad y el domicilio del responsable del tratamiento se publicarán en la versión vigente de este aviso, antes de que ORBIT NEXUS trate datos personales en producción.",
      ],
    },
    {
      id: "datos",
      title: "Datos personales que tratamos",
      paragraphs: [
        "Tratamos únicamente los datos que tú o los miembros de tu organización incorporan para usar ORBIT NEXUS:",
      ],
      items: [
        "Cuenta: nombre y correo electrónico. La contraseña se conserva solo como resumen criptográfico; ORBIT NEXUS no la conoce en texto legible.",
        "Sesión y seguridad: identificadores de sesión, dirección IP y navegador asociados a la sesión, registros de actividad y de auditoría, y contadores para limitar solicitudes.",
        "Organización: nombre, membresías, roles, plan y preferencias de la cuenta.",
        "Perfil fiscal de tu organización: RFC, nombre o razón social, tipo de persona, régimen fiscal, código postal y domicilio fiscal, uso de CFDI, correo fiscal y Constancia de Situación Fiscal.",
        "Tickets y gastos: imágenes o PDF de tickets, datos detectados en ellos (comercio, RFC del comercio, fechas, importes, folios, forma de pago, códigos o enlaces de facturación) y los datos que confirmas.",
        "Comprobantes fiscales: XML y PDF de CFDI que incorporas u obtienes, con su UUID, RFC de emisor y receptor e importes.",
        "Clientes de tu organización: RFC, nombre o razón social, régimen fiscal, código postal y domicilio, correos, teléfono, notas y, si la incorporas, su Constancia de Situación Fiscal.",
        "Facturación que preparas: conceptos, importes, folios y los datos del cliente incluidos en cada borrador.",
      ],
    },
    {
      id: "datos-no-solicitados",
      title: "Datos que no solicitamos",
      paragraphs: [
        "ORBIT NEXUS no solicita datos personales sensibles. Los documentos que incorporas podrían contenerlos de forma incidental, por ejemplo un ticket de farmacia; evita incorporar información que no sea necesaria.",
        "En esta versión ORBIT NEXUS no solicita, recibe ni custodia la e.firma, sus contraseñas ni certificados de sello digital (CSD).",
      ],
    },
    {
      id: "finalidades-primarias",
      title: "Finalidades necesarias para el servicio",
      paragraphs: ["Usamos tus datos para:"],
      items: [
        "Crear y proteger tu cuenta, autenticarte y mantener tu sesión.",
        "Administrar organizaciones, miembros y permisos, y separar la información de cada organización.",
        "Capturar y analizar tickets cuando lo solicitas, registrar gastos y elaborar reportes mensuales.",
        "Administrar el perfil fiscal, los clientes y los borradores de facturación de tu organización.",
        "Preparar la facturación de tus tickets y, solo después de tu aprobación expresa, enviar al portal del comercio los datos necesarios.",
        "Enviarte notificaciones del servicio y, si el servicio de correo está configurado, el enlace para recuperar tu contraseña.",
        "Prevenir abusos y accesos no autorizados, registrar auditoría de acciones sensibles e investigar incidentes de seguridad.",
      ],
    },
    {
      id: "finalidades-secundarias",
      title: "Finalidades secundarias",
      paragraphs: [
        "ORBIT NEXUS no trata tus datos para finalidades secundarias como mercadotecnia, publicidad o perfilamiento comercial. Si en el futuro se propone alguna, se informará en una nueva versión de este aviso y podrás negarte antes de que se aplique.",
      ],
    },
    {
      id: "documentos-fiscales",
      title: "Documentos fiscales y Constancia de Situación Fiscal",
      paragraphs: [
        "Los documentos fiscales se almacenan de forma privada y solo los consultan los miembros autorizados de la organización a la que pertenecen.",
        "Subir una Constancia de Situación Fiscal solo la guarda. ORBIT NEXUS lee su contenido únicamente después de que autorizas expresamente esa lectura; cada autorización queda registrada con la versión del texto que aceptaste. Los datos detectados se muestran para que los revises y corrijas: solo los datos que confirmas se guardan en el perfil fiscal o en el cliente.",
        "Si registras la Constancia de un cliente, declaras contar con facultades o una base legítima para proporcionarla.",
      ],
    },
    {
      id: "tickets",
      title: "Tickets e imágenes",
      paragraphs: [
        "Las imágenes y PDF de tickets se almacenan de forma privada. Si el servicio de lectura automática (OCR) está configurado, el archivo se envía a ese servicio solo cuando solicitas analizar el ticket. ORBIT NEXUS conserva por separado el resultado original de la lectura, los datos detectados y los datos que confirmas.",
      ],
    },
    {
      id: "cfdi",
      title: "Comprobantes fiscales digitales (CFDI)",
      paragraphs: [
        "Los XML y PDF de CFDI se almacenan de forma privada y se validan contra los datos del ticket y del perfil fiscal. ORBIT NEXUS no es proveedor de certificación (PAC) y no certifica la vigencia de un comprobante ante el SAT.",
      ],
    },
    {
      id: "clientes",
      title: "Datos de los clientes de tu organización",
      paragraphs: [
        "Los datos de tus clientes se tratan únicamente para las funciones que tu organización utiliza, como preparar sus comprobantes. Tu organización es quien decide incorporarlos y debe contar con la base legítima para hacerlo.",
      ],
    },
    {
      id: "cookies",
      title: "Cookies y analítica",
      paragraphs: [
        "ORBIT NEXUS usa cookies necesarias para mantener tu sesión de forma segura, recordar tu organización activa (el servidor siempre comprueba tu membresía) y guardar tus preferencias de cookies.",
        "Esta versión no instala herramientas de analítica ni de publicidad. Cualquier integración futura de ese tipo se mantendrá desactivada salvo que la aceptes y dejará de cargarse si retiras tu consentimiento.",
      ],
    },
    {
      id: "proveedores",
      title: "Proveedores y transferencias",
      paragraphs: [
        "La aplicación se ejecuta en Vercel y la base de datos en Neon PostgreSQL. Cuando el operador los configura, también intervienen un servicio de lectura automática de tickets, un servicio de correo transaccional y un servicio de automatización de portales de facturación; cada uno recibe solo los datos necesarios para su función.",
        "Al aprobar la facturación de un ticket, los datos fiscales necesarios se envían al portal del comercio que emitirá el comprobante.",
        facts.providerDisclosure ??
          "La identificación de los proveedores opcionales y la ubicación de la infraestructura se publicarán en la versión vigente de este aviso.",
        "ORBIT NEXUS no vende datos personales.",
      ],
    },
    {
      id: "seguridad",
      title: "Almacenamiento y seguridad",
      paragraphs: [
        "La información se separa por organización y cada solicitud comprueba en el servidor la sesión, la membresía y los permisos. Las cookies de sesión no son accesibles desde JavaScript, las acciones sensibles quedan registradas en una bitácora de auditoría y los documentos privados no se publican mediante enlaces abiertos.",
      ],
    },
    {
      id: "conservacion",
      title: "Conservación",
      paragraphs: [
        facts.retentionStatement ??
          "Los datos se conservan mientras tu cuenta o tu organización estén activas y durante los plazos que exijan las obligaciones legales y fiscales aplicables. Los plazos específicos se publicarán en la versión vigente de este aviso.",
      ],
    },
    {
      id: "eliminacion",
      title: "Eliminación",
      paragraphs: [
        "Puedes solicitar la eliminación de tu cuenta, de tu organización o de documentos específicos. Algunos documentos fiscales podrían conservarse bloqueados durante el plazo que exija la ley antes de suprimirse.",
        contact,
      ],
    },
    {
      id: "arco",
      title:
        "Derechos de acceso, rectificación, cancelación y oposición (ARCO)",
      paragraphs: [
        "Puedes acceder a tus datos, rectificarlos si son inexactos, solicitar su cancelación u oponerte a su tratamiento. Muchos datos pueden consultarse y corregirse directamente en ORBIT NEXUS.",
        contact,
        "Las solicitudes se atenderán en los plazos y con los requisitos que establezca la legislación aplicable.",
      ],
    },
    {
      id: "limitacion",
      title: "Limitación del uso o divulgación",
      paragraphs: [
        "Puedes limitar el uso de tus datos solicitándolo por el mismo medio. Las preferencias de cookies opcionales se modifican en cualquier momento desde el control de preferencias de cookies.",
      ],
    },
    {
      id: "revocacion",
      title: "Revocación del consentimiento",
      paragraphs: [
        "Puedes revocar el consentimiento que hayas otorgado, por ejemplo para la lectura de una Constancia. La revocación no tiene efectos retroactivos y puede impedir continuar con las funciones que dependen de ese tratamiento.",
        contact,
      ],
    },
    {
      id: "cambios",
      title: "Cambios a este aviso",
      paragraphs: [
        "Cada cambio a este aviso genera una nueva versión con su fecha de vigencia, publicada en ORBIT NEXUS. Cuando un cambio requiera tu aceptación, te la solicitaremos antes de aplicarlo.",
      ],
    },
    {
      id: "contacto",
      title: "Contacto",
      paragraphs: [
        facts.privacyContact
          ? `Para cualquier asunto relacionado con tus datos personales escribe a ${facts.privacyContact}.`
          : "El medio de contacto para asuntos de privacidad se publicará en la versión vigente de este aviso.",
      ],
    },
  ];
}
