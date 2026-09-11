import { describe, expect, it } from 'vitest';
import { staffTicketAdmissionMode, ticketMutationAdmissionMode } from '../budget-admission.middleware';

describe('ticket mutation admission policy', () => {
  it.each([
    ['off', 'disabled', 'disabled'],
    ['api-ticket-mutations-v1', 'api', 'disabled'],
    ['staff-ticket-mutations-v1', 'staff', 'enabled'],
    ['ticket-mutations-v1', 'combined', 'enabled'],
    ['unknown', 'invalid', 'invalid'],
    [undefined, 'invalid', 'invalid'],
  ] as const)('classifies %s without an implicit fallback', (policy, ticket, staff) => {
    const env = { BUDGET_ADMISSION_POLICY: policy } as any;
    expect(ticketMutationAdmissionMode(env)).toBe(ticket);
    expect(staffTicketAdmissionMode(env)).toBe(staff);
  });
});
