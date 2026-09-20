import { describe, expect, it } from 'vitest';
import { priorityClassificationColumns, priorityClassificationSchema } from '../priority-classification';

const complete = {
  category: 'security-privacy', scope: 'systemic', regulatoryOfficerOnSite: true,
  vipBlocked: true, hardDeadline: false, contractTier: 'alpha', criticalityTier: 4,
} as const;

describe('staff priority classification admission', () => {
  it('scores each true urgency condition and never accepts a client score', () => {
    expect(priorityClassificationColumns(complete)).toEqual({
      priority_category: 'security-privacy', priority_scope: 'systemic',
      priority_regulatory_officer_on_site: 1, priority_vip_blocked: 1, priority_hard_deadline: 0,
      priority_score: 40, contract_sla_tier: 'alpha', criticality_tier: 4,
    });
    expect(priorityClassificationSchema.safeParse({ ...complete, priority_score: 1 }).success).toBe(false);
  });

  it('requires a complete classification and rejects unsupported levels and flag values', () => {
    expect(priorityClassificationSchema.safeParse({ ...complete, hardDeadline: undefined }).success).toBe(false);
    expect(priorityClassificationSchema.safeParse({ ...complete, criticalityTier: 5 }).success).toBe(false);
    expect(priorityClassificationSchema.safeParse({ ...complete, vipBlocked: 1 }).success).toBe(false);
  });
});
