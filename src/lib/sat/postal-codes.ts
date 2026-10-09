import "server-only";
// Official c_CodigoPostal (catCFDI, versioned in ./catcfdi). Loaded lazily so the
// ~3 MB resource only enters the routes that verify postal codes. Time-zone data is
// kept exactly as published; it is interpreted only by the stamping blocks (D9).

export type PostalCodeTimeZone = {
  description: string;
  summer: { month: string; day: string; time: string; utcOffset: string };
  winter: { month: string; day: string; time: string; utcOffset: string };
};
export type PostalCodeEntry = {
  postalCode: string;
  state: string;
  municipality: string | null;
  locality: string | null;
  borderRegionStimulus: boolean;
  validFrom: string | null;
  validTo: string | null;
  timeZone: PostalCodeTimeZone;
};
type PostalCodeIndex = {
  has(code: string): boolean;
  get(code: string): PostalCodeEntry | undefined;
};

let index: Promise<PostalCodeIndex> | undefined;
async function build(): Promise<PostalCodeIndex> {
  const data = (await import("./catcfdi/c_CodigoPostal.json")).default as {
    timeZones: PostalCodeTimeZone[];
    entries: string[];
  };
  const rows = new Map<string, string>();
  for (const line of data.entries) rows.set(line.slice(0, 5), line);
  return {
    has: (code) => rows.has(code),
    get(code) {
      const line = rows.get(code);
      if (!line) return undefined;
      const [
        postalCode,
        state,
        municipality,
        locality,
        stimulus,
        from,
        to,
        zone,
      ] = line.split("|");
      return {
        postalCode,
        state,
        municipality: municipality || null,
        locality: locality || null,
        borderRegionStimulus: stimulus === "1",
        validFrom: from || null,
        validTo: to || null,
        timeZone: data.timeZones[Number(zone)],
      };
    },
  };
}
/** Server-side lookup over the official catalog; resolves once per process. */
export function postalCodeIndex() {
  return (index ??= build());
}
