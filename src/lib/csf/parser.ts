// Conservative Constancia de Situación Fiscal parser (contract §8, D16).
// Works on positioned text lines; never infers Uso CFDI, payment data, currency,
// email or phone. Until the parser is calibrated against representative documents,
// every heuristic value is LOW_CONFIDENCE; only values verified independently (RFC
// check digit, official postal-code catalog) can be DETECTED.
import type {
  ExtractedFiscalField,
  ExtractedFiscalFieldStatus,
  ExtractedFiscalRegime,
  FiscalExtractionFieldKey,
} from "@/types/fiscal-identity";
import { officialRegimes } from "@/lib/sat-catalogs";

export const CSF_PARSER_VERSION = "csf-text-v1";
/** Flip only after calibration with representative (anonymized) documents. */
const CALIBRATED = false;

export type TextLine = {
  page: number;
  y: number;
  segments: { x: number; text: string }[];
};
export type CsfParseOptions = { isKnownPostalCode?: (code: string) => boolean };
export type CsfParseResult = {
  status: "PROCESSED" | "PARTIAL" | "UNREADABLE";
  fields: Record<FiscalExtractionFieldKey, ExtractedFiscalField>;
  regimes: ExtractedFiscalRegime[];
};

export const extractionFieldKeys: FiscalExtractionFieldKey[] = [
  "rfc",
  "legalName",
  "personType",
  "postalCode",
  "street",
  "exteriorNumber",
  "interiorNumber",
  "colony",
  "locality",
  "municipality",
  "state",
  "country",
  "operationsStartDate",
];

export const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
const clean = (value: string) => value.replace(/\s+/g, " ").trim();

type CaptureKey =
  | Exclude<FiscalExtractionFieldKey, "legalName" | "personType">
  | "companyName"
  | "firstName"
  | "firstSurname"
  | "secondSurname";
// Known CSF labels. Labels mapped to null are recognized only so their values are
// never captured into another field (e.g. email or phone).
const labels: [string, CaptureKey | null][] = [
  ["rfc", "rfc"],
  ["curp", null],
  ["nombre (s)", "firstName"],
  ["nombre(s)", "firstName"],
  ["primer apellido", "firstSurname"],
  ["segundo apellido", "secondSurname"],
  ["denominacion/razon social", "companyName"],
  ["denominacion / razon social", "companyName"],
  ["denominacion o razon social", "companyName"],
  ["regimen capital", null],
  ["nombre comercial", null],
  ["fecha inicio de operaciones", "operationsStartDate"],
  ["estatus en el padron", null],
  ["fecha de ultimo cambio de estado", null],
  ["codigo postal", "postalCode"],
  ["tipo de vialidad", null],
  ["nombre de vialidad", "street"],
  ["numero exterior", "exteriorNumber"],
  ["numero interior", "interiorNumber"],
  ["nombre de la colonia", "colony"],
  ["nombre de la localidad", "locality"],
  ["nombre del municipio o demarcacion territorial", "municipality"],
  ["nombre de la entidad federativa", "state"],
  ["entre calle", null],
  ["y calle", null],
  ["pais", "country"],
  ["correo electronico", null],
  ["tel. fijo lada", null],
  ["tel. movil lada", null],
  ["numero", null],
  ["estado de la localidad", null],
  ["caracteristicas del domicilio", null],
  ["lugar y fecha de emision", null],
];
const labelIndex = new Map(labels);
const regimeSectionStart = /^regimenes:?$/;
const regimeSectionEnd =
  /^(obligaciones|actividades economicas|sus datos personales|cadena original|sello digital)/;

/** RFC homoclave check digit (verified against SAT test RFCs, both personas morales and físicas). */
export function rfcCheckDigitValid(rfc: string) {
  const alphabet = "0123456789ABCDEFGHIJKLMN&OPQRSTUVWXYZ Ñ";
  const base = (rfc.length === 12 ? " " : "") + rfc.slice(0, -1);
  if (base.length !== 12) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const value = alphabet.indexOf(base[i]);
    if (value < 0) return false;
    sum += value * (13 - i);
  }
  const remainder = sum % 11;
  const digit =
    remainder === 0
      ? "0"
      : 11 - remainder === 10
        ? "A"
        : String(11 - remainder);
  return rfc.slice(-1) === digit;
}

const months: Record<string, string> = {
  enero: "01",
  febrero: "02",
  marzo: "03",
  abril: "04",
  mayo: "05",
  junio: "06",
  julio: "07",
  agosto: "08",
  septiembre: "09",
  setiembre: "09",
  octubre: "10",
  noviembre: "11",
  diciembre: "12",
};
export function parseCsfDate(raw: string): string | null {
  const text = normalize(raw);
  const numeric = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const written = text.match(/^(\d{1,2}) de ([a-z]+) de (\d{4})$/);
  const [day, month, year] = numeric
    ? [numeric[1], numeric[2].padStart(2, "0"), numeric[3]]
    : written && months[written[2]]
      ? [written[1], months[written[2]], written[3]]
      : [];
  if (!day) return null;
  const iso = `${year}-${month}-${day.padStart(2, "0")}`;
  const date = new Date(iso + "T00:00:00Z");
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso
    ? null
    : iso;
}

const field = (
  value: string | null,
  status: ExtractedFiscalFieldStatus,
  source?: string,
  candidates?: string[],
): ExtractedFiscalField => ({
  value,
  status,
  ...(source ? { source } : {}),
  ...(candidates ? { candidates } : {}),
});
const notFound = () => field(null, "NOT_FOUND");
// Uncalibrated heuristics are never reported as DETECTED (D16).
const heuristic = (value: string, source: string) =>
  field(value, CALIBRATED ? "DETECTED" : "LOW_CONFIDENCE", source);

function labelOf(text: string): CaptureKey | null | undefined {
  const key = normalize(text).replace(/:$/, "").trim();
  return labelIndex.has(key) ? labelIndex.get(key) : undefined;
}

/** Collects label → values pairs; a value runs until the next label on the same line. */
function captureLabels(lines: TextLine[]) {
  const captured = new Map<CaptureKey, string[]>();
  let recognized = 0;
  for (const line of lines) {
    let current: CaptureKey | null | undefined;
    let buffer: string[] = [];
    const flush = () => {
      if (current && buffer.length) {
        const value = clean(buffer.join(" "));
        if (value)
          (
            captured.get(current) ?? captured.set(current, []).get(current)!
          ).push(value);
      }
      buffer = [];
    };
    for (const segment of line.segments) {
      const colon = segment.text.indexOf(":");
      const whole = labelOf(segment.text);
      const head =
        colon > 0 ? labelOf(segment.text.slice(0, colon)) : undefined;
      if (whole !== undefined && /:\s*$/.test(segment.text)) {
        flush();
        current = whole;
        recognized++;
      } else if (head !== undefined) {
        flush();
        current = head;
        recognized++;
        const rest = segment.text.slice(colon + 1).trim();
        if (rest) buffer.push(rest);
      } else if (current !== undefined) buffer.push(segment.text);
    }
    flush();
  }
  return { captured, recognized };
}

function single(captured: Map<CaptureKey, string[]>, key: CaptureKey) {
  const values = [...new Set((captured.get(key) ?? []).map(clean))];
  return values;
}

function parseRegimes(lines: TextLine[]): ExtractedFiscalRegime[] {
  const start = lines.findIndex((l) =>
    regimeSectionStart.test(normalize(l.segments[0]?.text ?? "")),
  );
  if (start < 0) return [];
  const regimes: ExtractedFiscalRegime[] = [];
  for (const line of lines.slice(start + 1)) {
    const first = normalize(line.segments[0]?.text ?? "");
    if (regimeSectionEnd.test(first)) break;
    const dates = line.segments
      .map((s) => s.text.trim())
      .filter((t) => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(t));
    const text = clean(
      line.segments
        .map((s) => s.text)
        .filter((t) => !dates.includes(t.trim()))
        .join(" "),
    );
    const normalizedText = normalize(text);
    if (
      !text ||
      (normalizedText.includes("regimen") &&
        normalizedText.includes("fecha inicio"))
    )
      continue;
    const match = matchRegime(text);
    regimes.push({
      code: match.code ?? "",
      label: text,
      startDate: dates[0] ? parseCsfDate(dates[0]) : null,
      endDate: dates[1] ? parseCsfDate(dates[1]) : null,
      status: match.ambiguous
        ? "AMBIGUOUS"
        : CALIBRATED && match.code
          ? "DETECTED"
          : "LOW_CONFIDENCE",
      catalogVerified: !!match.code,
    });
  }
  return regimes;
}

const regimeKey = (value: string) =>
  normalize(value)
    .replace(/^regimen (de los |de las |de la |del |de )?/, "")
    .replace(/[.,]/g, "")
    .trim();
const officialRegimeKeys = [...officialRegimes.values()].map((r) => ({
  code: r.code,
  key: regimeKey(r.description),
}));
function matchRegime(text: string): { code?: string; ambiguous?: boolean } {
  const key = regimeKey(text);
  const exact = officialRegimeKeys.filter((r) => r.key === key);
  if (exact.length === 1) return { code: exact[0].code };
  if (exact.length > 1) return { ambiguous: true };
  return {};
}

export function parseCsfText(
  lines: TextLine[],
  options: CsfParseOptions = {},
): CsfParseResult {
  const { captured, recognized } = captureLabels(lines);
  const regimes = parseRegimes(lines);
  const fields = Object.fromEntries(
    extractionFieldKeys.map((k) => [k, notFound()]),
  ) as Record<FiscalExtractionFieldKey, ExtractedFiscalField>;
  if (!recognized && !regimes.length)
    return { status: "UNREADABLE", fields, regimes };

  const simple = (
    key: Exclude<
      CaptureKey,
      | "rfc"
      | "postalCode"
      | "operationsStartDate"
      | "companyName"
      | "firstName"
      | "firstSurname"
      | "secondSurname"
    >,
    source: string,
  ) => {
    const values = single(captured, key);
    fields[key] =
      values.length === 0
        ? notFound()
        : values.length > 1
          ? field(null, "AMBIGUOUS", source, values)
          : heuristic(values[0], source);
  };

  // RFC: DETECTED only with a valid format and check digit.
  const rfcs = single(captured, "rfc").map((v) =>
    v.toUpperCase().replace(/\s/g, ""),
  );
  if (rfcs.length > 1)
    fields.rfc = field(null, "AMBIGUOUS", "Etiqueta RFC", rfcs);
  else if (rfcs.length === 1) {
    const rfc = rfcs[0];
    const formatOk = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(rfc);
    fields.rfc =
      formatOk && rfcCheckDigitValid(rfc)
        ? field(rfc, "DETECTED", "Etiqueta RFC · dígito verificador válido")
        : field(
            rfc,
            "LOW_CONFIDENCE",
            "Etiqueta RFC · formato o dígito verificador no comprobado",
          );
    if (formatOk)
      fields.personType = field(
        rfc.length === 12 ? "COMPANY" : "INDIVIDUAL",
        fields.rfc.status,
        "Longitud del RFC",
      );
  }

  // Postal code: DETECTED only when it exists in the official c_CodigoPostal catalog.
  const postalCodes = single(captured, "postalCode");
  if (postalCodes.length > 1)
    fields.postalCode = field(
      null,
      "AMBIGUOUS",
      "Etiqueta Código Postal",
      postalCodes,
    );
  else if (postalCodes.length === 1) {
    const code = postalCodes[0];
    fields.postalCode =
      /^\d{5}$/.test(code) && options.isKnownPostalCode?.(code)
        ? field(
            code,
            "DETECTED",
            "Etiqueta Código Postal · catálogo oficial c_CodigoPostal",
          )
        : field(
            code,
            "LOW_CONFIDENCE",
            "Etiqueta Código Postal · no verificado en el catálogo",
          );
  }

  // Legal name: denominación for personas morales, name + surnames for personas físicas.
  const company = single(captured, "companyName");
  const names = ["firstName", "firstSurname", "secondSurname"].map((k) =>
    single(captured, k as CaptureKey),
  );
  const preferIndividual =
    fields.personType.value === "INDIVIDUAL" ||
    (!company.length && names[0].length > 0);
  if (!preferIndividual && company.length)
    fields.legalName =
      company.length > 1
        ? field(null, "AMBIGUOUS", "Denominación/Razón Social", company)
        : heuristic(company[0], "Denominación/Razón Social");
  else if (names[0].length) {
    if (names.some((v) => v.length > 1))
      fields.legalName = field(
        null,
        "AMBIGUOUS",
        "Nombre(s) y apellidos",
        names.flat(),
      );
    else
      fields.legalName = heuristic(
        clean(names.map((v) => v[0] ?? "").join(" ")),
        "Nombre(s) y apellidos",
      );
  }

  const starts = single(captured, "operationsStartDate");
  if (starts.length > 1)
    fields.operationsStartDate = field(
      null,
      "AMBIGUOUS",
      "Fecha inicio de operaciones",
      starts,
    );
  else if (starts.length === 1) {
    const iso = parseCsfDate(starts[0]);
    fields.operationsStartDate = iso
      ? heuristic(iso, "Fecha inicio de operaciones")
      : field(
          starts[0],
          "LOW_CONFIDENCE",
          "Fecha inicio de operaciones · formato no reconocido",
        );
  }

  simple("street", "Nombre de Vialidad");
  simple("exteriorNumber", "Número Exterior");
  simple("interiorNumber", "Número Interior");
  simple("colony", "Nombre de la Colonia");
  simple("locality", "Nombre de la Localidad");
  simple("municipality", "Nombre del Municipio o Demarcación Territorial");
  simple("state", "Nombre de la Entidad Federativa");
  simple("country", "País");

  const complete =
    extractionFieldKeys.every(
      (k) =>
        fields[k].status === "DETECTED" ||
        k === "interiorNumber" ||
        k === "country",
    ) &&
    regimes.length > 0 &&
    regimes.every((r) => r.status === "DETECTED");
  return { status: complete ? "PROCESSED" : "PARTIAL", fields, regimes };
}
