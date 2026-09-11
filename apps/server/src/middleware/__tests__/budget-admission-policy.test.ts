import { describe, expect, it } from 'vitest';
import { customerTicketAdmissionMode, staffTicketAdmissionMode, ticketMutationAdmissionMode } from '../budget-admission.middleware';

describe('ticket mutation admission policy', () => {
  it.each([
    ['off', 'disabled', 'disabled', 'disabled'],
    ['api-ticket-mutations-v1', 'api', 'disabled', 'disabled'],
    ['ticket-mutations-v1', 'combined', 'enabled', 'enabled'],
    ['staff-ticket-mutations-v1', 'invalid', 'invalid', 'invalid'],
    ['unknown', 'invalid', 'invalid', 'invalid'],
    [undefined, 'invalid', 'invalid', 'invalid'],
  ] as const)('classifies %s without an implicit fallback', (policy, ticket, staff, customer) => {
    const env = { BUDGET_ADMISSION_POLICY: policy } as any;
    expect(ticketMutationAdmissionMode(env)).toBe(ticket);
    expect(staffTicketAdmissionMode(env)).toBe(staff);
    expect(customerTicketAdmissionMode(env)).toBe(customer);
  });
});
