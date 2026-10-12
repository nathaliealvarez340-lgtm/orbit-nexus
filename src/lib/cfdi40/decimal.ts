import { Prisma } from "@/generated/prisma/browser";

// Fase 5C.4: exact decimal arithmetic for CFDI amounts. A private decimal.js clone with
// enough precision for 18 integer + 6 fraction digits times 6-decimal rates (and the
// 10^-12 terms of the Anexo 20 limits) and no exponent notation. Rounding is explicit in
// every helper; nothing here goes through JavaScript floating point.
export const CfdiDecimal = Prisma.Decimal.clone({
  precision: 60,
  rounding: Prisma.Decimal.ROUND_HALF_UP,
  toExpNeg: -40,
  toExpPos: 40,
});
export type CfdiDecimal = InstanceType<typeof CfdiDecimal>;

// tdCFDI t_Importe: [0-9]{1,18}(.[0-9]{1,6})? — no sign, no exponent, no grouping.
const amountPattern = /^\d{1,18}(\.\d{1,6})?$/;

/** Parses a non-negative decimal text with at most `maxDecimals` fraction digits. */
export function parseAmount(text: string | null | undefined, maxDecimals = 6) {
  if (typeof text !== "string" || !amountPattern.test(text)) return null;
  if (decimalsOf(text) > maxDecimals) return null;
  return new CfdiDecimal(text);
}

/** Fraction digits as written ("1.50" → 2, "3" → 0). */
export const decimalsOf = (text: string) =>
  text.includes(".") ? text.length - text.indexOf(".") - 1 : 0;

/** "Redondeo" of the Anexo 20 and its guide: arithmetic, half away from zero. */
export const round = (value: CfdiDecimal, places: number) =>
  value.toDecimalPlaces(places, CfdiDecimal.ROUND_HALF_UP);
export const truncate = (value: CfdiDecimal, places: number) =>
  value.toDecimalPlaces(places, CfdiDecimal.ROUND_DOWN);
export const roundUp = (value: CfdiDecimal, places: number) =>
  value.toDecimalPlaces(places, CfdiDecimal.ROUND_CEIL);

const zero = new CfdiDecimal(0);
const clean = (value: CfdiDecimal) => (value.isZero() ? zero : value);

/** Exactly `places` fraction digits (amounts in the currency's decimals). */
export const fixed = (value: CfdiDecimal, places: number) =>
  clean(round(value, places)).toFixed(places);
/** Shortest exact representation, no trailing zeros ("1.5000" → "1.5"). */
export const canonical = (value: CfdiDecimal) => clean(value).toFixed();
/** At least `places` fraction digits, more only when the value needs them. */
export const atLeast = (value: CfdiDecimal, places: number) =>
  clean(value).decimalPlaces() < places
    ? clean(value).toFixed(places)
    : clean(value).toFixed();

export const sum = (values: readonly CfdiDecimal[]) =>
  values.reduce((total, value) => total.add(value), zero);

const half = (decimals: number) => new CfdiDecimal(10).pow(-decimals).div(2);
const epsilon = new CfdiDecimal("1e-12");

/**
 * Anexo 20 (DOF 13/01/2022), Concepto@Importe: lower limit
 * (Cantidad − 10^-dC/2)·(ValorUnitario − 10^-dV/2) truncated, upper limit
 * (Cantidad + 10^-dC/2 − 10^-12)·(ValorUnitario + 10^-dV/2 − 10^-12) rounded up, both to
 * the decimals written in Importe. Texts are the exact values written in the XML.
 */
export function conceptAmountWithinLimits(
  quantity: string,
  unitPrice: string,
  amount: string,
) {
  const q = new CfdiDecimal(quantity),
    v = new CfdiDecimal(unitPrice),
    a = new CfdiDecimal(amount),
    places = decimalsOf(amount);
  const lower = truncate(
    q.sub(half(decimalsOf(quantity))).mul(v.sub(half(decimalsOf(unitPrice)))),
    places,
  );
  const upper = roundUp(
    q
      .add(half(decimalsOf(quantity)))
      .sub(epsilon)
      .mul(v.add(half(decimalsOf(unitPrice))).sub(epsilon)),
    places,
  );
  return a.greaterThanOrEqualTo(lower) && a.lessThanOrEqualTo(upper);
}

/**
 * Anexo 20, Traslado/Retencion@Importe: lower (Base − 10^-dB/2)·TasaOCuota truncated,
 * upper (Base + 10^-dB/2 − 10^-12)·TasaOCuota rounded up, to the decimals of Importe.
 */
export function taxAmountWithinLimits(
  base: string,
  rate: string,
  amount: string,
) {
  const b = new CfdiDecimal(base),
    r = new CfdiDecimal(rate),
    a = new CfdiDecimal(amount),
    places = decimalsOf(amount);
  const lower = truncate(b.sub(half(decimalsOf(base))).mul(r), places);
  const upper = roundUp(
    b
      .add(half(decimalsOf(base)))
      .sub(epsilon)
      .mul(r),
    places,
  );
  return a.greaterThanOrEqualTo(lower) && a.lessThanOrEqualTo(upper);
}
