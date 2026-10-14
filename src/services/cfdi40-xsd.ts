import "server-only";
import { recordAuditEvent } from "@/lib/audit";
import { Cfdi40Error, cfdi40Issue } from "@/lib/cfdi40/errors";
import { validateOfficialSealedCfdi40Xsd } from "@/lib/cfdi40/xsd-engine";
import { loadCfdi40XsdBundle } from "@/lib/cfdi40/xsd-resources";
import type { SealedCfdi40Xml, XsdValidatedCfdi40 } from "@/lib/cfdi40/types";

// Fase 5C.7: the official XSD gate with its audit evidence. Not wired to any route: the
// stamping block calls it after the seal and before the PAC (authorization → seal → XSD →
// PAC). `actor` comes from a server-validated tenant and `invoiceId` is resolved by the
// server, never taken from a client.

type AuditWriter = Parameters<typeof recordAuditEvent>[0];
export type Cfdi40XsdActor = { organizationId: string; userId: string };

const shortHash = (hash: string) => hash.slice(0, 16);

/**
 * Validates a sealed CFDI against the official XSD and records cfdi.xsd.validated or
 * cfdi.xsd.failed (code and the XSD set's short hash only). Returns the XsdValidatedCfdi40 or
 * throws a coded Cfdi40Error; unexpected failures become CFDI_XSD_VALIDATION_FAILED.
 */
export async function validateSealedCfdi40XsdForInvoice(
  db: AuditWriter,
  actor: Cfdi40XsdActor,
  request: { sealed: SealedCfdi40Xml; invoiceId: string | null },
): Promise<XsdValidatedCfdi40> {
  try {
    const validated = await validateOfficialSealedCfdi40Xsd(request.sealed);
    await recordAuditEvent(db, {
      action: "cfdi.xsd.validated",
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      targetId: request.invoiceId,
      metadata: { xsdBundle: shortHash(validated.xsd.bundleSha256) },
    });
    return validated;
  } catch (error) {
    const failure =
      error instanceof Cfdi40Error
        ? error
        : new Cfdi40Error([
            cfdi40Issue("CFDI_XSD_VALIDATION_FAILED", "Comprobante", "ORBIT"),
          ]);
    let xsdBundle: string | undefined;
    try {
      xsdBundle = shortHash((await loadCfdi40XsdBundle()).bundleSha256);
    } catch {
      xsdBundle = undefined;
    }
    try {
      await recordAuditEvent(db, {
        action: "cfdi.xsd.failed",
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        targetId: request.invoiceId,
        result: "FAILURE",
        metadata: { errorCode: failure.issues[0]?.code, xsdBundle },
      });
    } catch {
      // The validation failure is what the caller reports; audit storage failures are not.
    }
    throw failure;
  }
}
