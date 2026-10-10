// Fase 5C.2 §6: audit trail DTOs. Metadata only holds the sanitized catalog keys.
export type AuditEventDto = {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  result: "SUCCESS" | "FAILURE" | "DENIED";
  actor: { id: string; name: string } | null;
  metadata: Record<string, string | number | boolean | string[]> | null;
  createdAt: string;
};

export type AuditEventPage = {
  events: AuditEventDto[];
  /** Pass as `before` to read older events; null when there are no more. */
  nextBefore: string | null;
};
