import { z } from 'zod';
import { calculatePriorityScore } from '@luminatick/shared';

/** Staff-supplied classification is complete or absent; score is server-owned. */
export const priorityClassificationSchema = z.object({
  category: z.enum([
    'incidents-interruptions', 'security-privacy', 'access-authentication', 'technical-problems',
    'service-requests', 'transactions-billing', 'status-follow-up', 'information-requests',
    'how-to-assistance', 'feedback', 'other',
  ]),
  scope: z.enum(['systemic', 'localised', 'isolated']),
  regulatoryOfficerOnSite: z.boolean(),
  vipBlocked: z.boolean(),
  hardDeadline: z.boolean(),
  contractTier: z.enum(['alpha', 'bravo', 'charlie', 'delta']),
  criticalityTier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
}).strict();

export type PriorityClassificationInput = z.infer<typeof priorityClassificationSchema>;

export function priorityClassificationColumns(input: PriorityClassificationInput) {
  const parsed = priorityClassificationSchema.parse(input);
  const flags = [parsed.regulatoryOfficerOnSite, parsed.vipBlocked, parsed.hardDeadline];
  return {
    priority_category: parsed.category,
    priority_scope: parsed.scope,
    priority_regulatory_officer_on_site: Number(parsed.regulatoryOfficerOnSite) as 0 | 1,
    priority_vip_blocked: Number(parsed.vipBlocked) as 0 | 1,
    priority_hard_deadline: Number(parsed.hardDeadline) as 0 | 1,
    priority_score: calculatePriorityScore(parsed.category, parsed.scope, 5 * flags.filter(Boolean).length),
    contract_sla_tier: parsed.contractTier,
    criticality_tier: parsed.criticalityTier,
  };
}
