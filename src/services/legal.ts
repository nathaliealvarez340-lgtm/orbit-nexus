import "server-only";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/tenant";
import { enforceRateLimit } from "@/lib/http";
import {
  acceptLegalDocument,
  legalAcceptanceStates,
} from "./legal-acceptances";

// Legal acceptance belongs to the signed-in person, not to an Organization.
export async function myLegalAcceptances() {
  const user = await requireUser();
  return legalAcceptanceStates(getDb(), user.id);
}

export async function acceptMyLegalDocument(body: unknown) {
  const user = await requireUser();
  await enforceRateLimit("legal-accept:" + user.id, 10, 60);
  return acceptLegalDocument(getDb(), user.id, body);
}
