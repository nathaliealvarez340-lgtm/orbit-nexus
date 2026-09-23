export function activeMembership<T extends { organizationId: string }>(
  memberships: T[],
  preferred?: string,
) {
  if (preferred) return memberships.find((m) => m.organizationId === preferred);
  // Multiple workspaces need an explicit choice; ordering is not authorization.
  return memberships.length === 1 ? memberships[0] : undefined;
}
