// Master-data rules for Perfil Fiscal and Clientes (contract §7, §10.2, §10.6), backed by
// the official c_RegimenFiscal / c_UsoCFDI resources. Returns a user-facing message or null.
import {
  cfdiUseRules,
  genericRfc,
  inForce,
  officialCfdiUses,
  officialRegimes,
} from "./sat-catalogs";

const personLabel = (personType: string) =>
  personType === "INDIVIDUAL" ? "persona física" : "persona moral";
const isGenericRfc = (rfc: string) =>
  rfc === genericRfc.publicGeneral || rfc === genericRfc.foreign;

export function fiscalRegimeProblem(
  regime: string,
  personType: string,
  rfc: string,
  date?: string,
): string | null {
  const entry = officialRegimes.get(regime);
  if (!entry) return "Selecciona un régimen fiscal del catálogo del SAT.";
  if (!inForce(entry, date))
    return "El régimen fiscal no está vigente en el catálogo del SAT.";
  if (isGenericRfc(rfc))
    return regime === "616"
      ? null
      : "Con RFC genérico el régimen fiscal debe ser 616 · Sin obligaciones fiscales.";
  if (!(entry.personTypes as string[]).includes(personType))
    return `El régimen ${regime} no aplica a una ${personLabel(personType)}.`;
  return null;
}

export function cfdiUseProblem(
  use: string,
  regime: string,
  personType: string,
  rfc: string,
  date?: string,
): string | null {
  const entry = officialCfdiUses.get(use);
  if (!entry) return "Selecciona un Uso CFDI del catálogo del SAT.";
  if (!inForce(entry, date))
    return "El Uso CFDI no está vigente en el catálogo del SAT.";
  if (isGenericRfc(rfc))
    return use === "S01"
      ? null
      : "Con RFC genérico el Uso CFDI debe ser S01 · Sin efectos fiscales.";
  const rule = cfdiUseRules.get(use)!;
  if (!(rule.personTypes as string[]).includes(personType))
    return `El Uso CFDI ${use} no aplica a una ${personLabel(personType)}.`;
  if (!rule.receiverRegimes.includes(regime))
    return `El Uso CFDI ${use} no es compatible con el régimen fiscal ${regime}.`;
  return null;
}
