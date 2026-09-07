declare const brand: unique symbol;

export type VerifiedTenantScope = Readonly<{
  tenantId: string;
  actorId: string;
  roles: readonly string[];
  authVersion: number;
  [brand]: "VerifiedTenantScope";
}>;
