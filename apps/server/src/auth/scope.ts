import { VerifiedTenantScope } from '../types/tenant';

// This factory should ONLY be imported by authentication/authorization logic.
export function createVerifiedTenantScope(
  tenantId: string,
  actorId: string,
  roles: string[],
  authVersion: number
): VerifiedTenantScope {
  return {
    tenantId,
    actorId,
    roles: Object.freeze([...roles]),
    authVersion,
  } as VerifiedTenantScope;
}
