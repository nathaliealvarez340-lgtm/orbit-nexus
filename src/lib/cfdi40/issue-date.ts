import type { PostalCodeTimeZone } from "@/lib/sat/postal-codes";

// Fase 5C.4: Comprobante@Fecha "debe corresponder con la hora local donde se expide el
// comprobante" (Anexo 20 guía de llenado; CFDI40101). ORBIT derives it from a server
// instant (never from the browser) and the time-zone data that c_CodigoPostal publishes
// for LugarExpedicion: fixed UTC offsets, or a daylight-saving rule given as
// month + "<ordinal> domingo" + local time. The data is used only when it is internally
// consistent (daylight offset exactly one hour ahead of standard); anything else is
// unresolved and the CFDI is not built, instead of guessing a zone.

const months: Record<string, number> = {
  enero: 0,
  febrero: 1,
  marzo: 2,
  abril: 3,
  mayo: 4,
  junio: 5,
  julio: 6,
  agosto: 7,
  septiembre: 8,
  octubre: 9,
  noviembre: 10,
  diciembre: 11,
};
const ordinals: Record<string, number> = {
  primer: 1,
  primero: 1,
  segundo: 2,
  tercer: 3,
  tercero: 3,
  cuarto: 4,
};

const offsetHours = (value: string) =>
  /^[+-]?\d{1,2}$/.test(value.trim()) ? Number(value.trim()) : null;

type Transition = {
  month: number;
  ordinal: number;
  hour: number;
  minute: number;
};
function transition(rule: PostalCodeTimeZone["summer"]): Transition | null {
  const month = months[rule.month.trim().toLowerCase()];
  const day = /^(\S+)\s+domingo$/i.exec(rule.day.trim());
  const ordinal = day ? ordinals[day[1].toLowerCase()] : undefined;
  const time = /^(\d{2}):(\d{2})$/.exec(rule.time.trim());
  if (month === undefined || !ordinal || !time) return null;
  return { month, ordinal, hour: Number(time[1]), minute: Number(time[2]) };
}

/** UTC instant of a local wall-clock transition expressed with the given offset. */
function transitionInstant(year: number, t: Transition, offset: number) {
  const first = new Date(Date.UTC(year, t.month, 1));
  const firstSunday = 1 + ((7 - first.getUTCDay()) % 7);
  const day = firstSunday + 7 * (t.ordinal - 1);
  return Date.UTC(year, t.month, day, t.hour - offset, t.minute);
}

/** UTC offset (hours) in force at `instant`, or null when the published data is unusable. */
export function utcOffsetAt(instant: Date, zone: PostalCodeTimeZone) {
  const standard = offsetHours(zone.winter.utcOffset);
  const daylight = offsetHours(zone.summer.utcOffset);
  if (standard === null || daylight === null) return null;
  const noRule = [zone.summer, zone.winter].every(
    (r) => !r.month.trim() && !r.day.trim() && !r.time.trim(),
  );
  if (noRule) return standard === daylight ? standard : null;
  const start = transition(zone.summer);
  const end = transition(zone.winter);
  if (!start || !end || daylight !== standard + 1 || start.month >= end.month)
    return null;
  const year = new Date(
    instant.getTime() + standard * 3600_000,
  ).getUTCFullYear();
  const from = transitionInstant(year, start, standard);
  const to = transitionInstant(year, end, daylight);
  const t = instant.getTime();
  return t >= from && t < to ? daylight : standard;
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/**
 * t_FechaH ("YYYY-MM-DDThh:mm:ss", no offset, no fractions) in the local time of the place
 * of issue, plus its calendar date. Null when the zone cannot be resolved.
 */
export function localIssueDateTime(instant: Date, zone: PostalCodeTimeZone) {
  if (Number.isNaN(instant.getTime())) return null;
  const offset = utcOffsetAt(instant, zone);
  if (offset === null) return null;
  const local = new Date(instant.getTime() + offset * 3600_000);
  const date = `${pad(local.getUTCFullYear(), 4)}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
  return {
    issuedAt: `${date}T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}`,
    date,
    utcOffset: offset,
  };
}
