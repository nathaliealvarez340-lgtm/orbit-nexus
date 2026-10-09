// Synthetic Constancia de Situación Fiscal for automated tests only. It imitates a
// label/value layout; it is not a real SAT document and contains fictitious data.
import { PDFDocument, StandardFonts } from "pdf-lib";

/**
 * @param {{
 *   rfc?: string, companyName?: string, names?: string[], operationsStart?: string,
 *   postalCode?: string, street?: string, exteriorNumber?: string, interiorNumber?: string,
 *   colony?: string, locality?: string, municipality?: string, state?: string,
 *   regimes?: string[][], extraRfc?: string, blank?: boolean
 * }} [options]
 */
export async function syntheticCsf({
  rfc,
  companyName,
  names,
  operationsStart = "17 DE MARZO DE 1990",
  postalCode = "42501",
  street = "MORELOS",
  exteriorNumber = "15",
  interiorNumber,
  colony = "CENTRO",
  locality = "PACHUCA",
  municipality = "PACHUCA DE SOTO",
  state = "HIDALGO",
  regimes = [["Régimen General de Ley Personas Morales", "17/03/1990"]],
  extraRfc,
  blank = false,
} = {}) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([612, 792]);
  if (blank) return Buffer.from(await pdf.save());
  let y = 760;
  const row = (...cells) => {
    for (const [x, text] of cells) page.drawText(text, { x, y, size: 8, font });
    y -= 16;
  };
  row([
    40,
    "CONSTANCIA DE SITUACIÓN FISCAL · DOCUMENTO SINTÉTICO PARA PRUEBAS",
  ]);
  row([40, "Datos de Identificación del Contribuyente:"]);
  row([40, "RFC:"], [220, rfc]);
  if (extraRfc) row([40, "RFC:"], [220, extraRfc]);
  if (companyName) {
    row([40, "Denominación/Razón Social:"], [220, companyName]);
    row(
      [40, "Régimen Capital:"],
      [220, "SOCIEDAD ANONIMA DE CAPITAL VARIABLE"],
    );
  }
  if (names) {
    row([40, "CURP:"], [220, "XEXX010101HNEXXXA4"]);
    row([40, "Nombre (s):"], [220, names[0]]);
    row([40, "Primer Apellido:"], [220, names[1]]);
    row([40, "Segundo Apellido:"], [220, names[2]]);
  }
  row([40, "Fecha inicio de operaciones:"], [220, operationsStart]);
  row([40, "Estatus en el padrón:"], [220, "ACTIVO"]);
  row([40, "Datos del domicilio registrado"]);
  row(
    [40, "Código Postal:"],
    [130, postalCode],
    [300, "Tipo de Vialidad:"],
    [420, "CALLE"],
  );
  row(
    [40, "Nombre de Vialidad:"],
    [130, street],
    [300, "Número Exterior:"],
    [420, exteriorNumber],
  );
  row(
    [40, "Número Interior:"],
    ...(interiorNumber ? [[130, interiorNumber]] : []),
    [300, "Nombre de la Colonia:"],
    [420, colony],
  );
  row([40, "Nombre de la Localidad:"], [130, locality]);
  row(
    [40, "Nombre del Municipio o Demarcación Territorial:"],
    [250, municipality],
  );
  row([40, "Nombre de la Entidad Federativa:"], [250, state]);
  row(
    [40, "Correo Electrónico:"],
    [200, "contacto@example.test"],
    [360, "Tel. Fijo Lada:"],
    [460, "55"],
  );
  row([40, "Regímenes:"]);
  row([40, "Régimen"], [380, "Fecha Inicio"], [480, "Fecha Fin"]);
  for (const [text, start, end] of regimes)
    row([40, text], [380, start], ...(end ? [[480, end]] : []));
  row([40, "Obligaciones:"]);
  row([40, "Declaración anual de ISR"], [380, "17/03/1990"]);
  return Buffer.from(await pdf.save());
}
