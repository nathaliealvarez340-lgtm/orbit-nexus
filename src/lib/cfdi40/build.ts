import type { Cfdi40Catalogs } from "./catalogs";
import { Cfdi40Error, type Cfdi40Issue } from "./errors";
import { mapOrbitInvoice } from "./mapper";
import { normalizeCfdi40 } from "./normalize";
import { serializeUnsignedCfdi40 } from "./serialize";
import type {
  Cfdi40Document,
  OrbitInvoiceForCfdi,
  UnsignedCfdi40Xml,
} from "./types";
import { validateCfdi40 } from "./validate";

// Fase 5C.4 pipeline: ORBIT invoice → mapper → normalizer → validator → serializer.
// Pure: no database, network, clock or randomness. The caller passes the server instant of
// emission (never a browser value) and the official catalogs. It stops at the unsigned
// representation: no cadena original, seal, PAC or ISSUED (FASE5C §15-§16).

export type Cfdi40BuildResult = {
  document: Cfdi40Document;
  xml: UnsignedCfdi40Xml;
  /** The unsigned XML cannot be XSD-valid (Sello, NoCertificado, Certificado are required). */
  schemaValidation: {
    status: "NOT_VALIDATED";
    reason: "UNSIGNED_REPRESENTATION";
  };
};

/** Throws Cfdi40Error with every issue found; nothing partial is returned. */
export function buildUnsignedCfdi40(
  invoice: OrbitInvoiceForCfdi,
  options: { issuedAt: Date; catalogs: Cfdi40Catalogs },
): Cfdi40BuildResult {
  const normalized = normalizeCfdi40(mapOrbitInvoice(invoice), options);
  if (!normalized.ok) throw new Cfdi40Error(normalized.issues);
  const issues = validateCfdi40(normalized.document, options.catalogs);
  if (issues.length) throw new Cfdi40Error(issues);
  return {
    document: normalized.document,
    xml: serializeUnsignedCfdi40(normalized.document),
    schemaValidation: {
      status: "NOT_VALIDATED",
      reason: "UNSIGNED_REPRESENTATION",
    },
  };
}

/**
 * READY gate (FASE5C §3: READY means "puede intentar timbrarse"). Runs the same mapper,
 * normalizer, validator and serializer as the emission build in CONTENT mode, at the
 * server instant `at`: every rule except the two that only exist at emission (status
 * READY, draft date = local issue date). Returns the issues; an empty list means the
 * content of the invoice is emittable now. The emission build re-checks everything.
 */
export function checkCfdi40Content(
  invoice: OrbitInvoiceForCfdi,
  options: { at: Date; catalogs: Cfdi40Catalogs },
): readonly Cfdi40Issue[] {
  const normalized = normalizeCfdi40(mapOrbitInvoice(invoice), {
    issuedAt: options.at,
    catalogs: options.catalogs,
    mode: "CONTENT",
  });
  if (!normalized.ok) return normalized.issues;
  const issues = validateCfdi40(normalized.document, options.catalogs);
  if (issues.length) return issues;
  try {
    serializeUnsignedCfdi40(normalized.document);
    return [];
  } catch (error) {
    if (error instanceof Cfdi40Error) return error.issues;
    throw error;
  }
}
