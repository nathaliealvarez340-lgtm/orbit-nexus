import type { DecipherGCM } from "node:crypto";

// Fase 5C.6 hardening: Buffer.concat copies the plaintext parts that update() and final()
// return, so the parts themselves must be overwritten too, including the unauthenticated
// part when final() rejects the GCM tag. Best effort: OpenSSL's own buffers are not ours.

/** update + final as one Buffer; the intermediate plaintext parts are zeroed. */
export function decipherAll(decipher: DecipherGCM, data: Uint8Array): Buffer {
  const parts: Buffer[] = [];
  try {
    parts.push(decipher.update(data));
    parts.push(decipher.final());
    return Buffer.concat(parts);
  } finally {
    for (const part of parts) part.fill(0);
  }
}
