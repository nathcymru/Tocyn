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
  } as unknown as VerifiedTenantScope;
}

export function createSystemTenantScope(options: { tenantId: string, actor: string }): VerifiedTenantScope {
  return {
    tenantId: options.tenantId,
    actorId: options.actor,
    roles: ['system'],
    authVersion: 1
  } as unknown as VerifiedTenantScope;
}
