import { describe, expect, it } from 'vitest';
import { isAllowedTicketUtilityLink } from '@luminatick/shared';
import { governedTicketUtilityActions } from '../governed-ticket-actions';

const allowed = { allowed: true, reason: 'allowed', capability: 'tools.reference.read', policyFingerprint: 'policy-1' } as const;
const denied = { allowed: false, reason: 'role_grant', capability: 'tools.reference.read', policyFingerprint: 'policy-2' } as const;

describe('governed ticket utility actions', () => {
  it('issues only the finite core command, dialog, and validated link actions', () => {
    const result = governedTicketUtilityActions('ticket-a', allowed);
    expect(result).toMatchObject({ version: 1, ticketId: 'ticket-a' });
    expect(result.actions).toEqual([
      expect.objectContaining({ id: 'copy-ticket-reference', kind: 'application-command', command: 'copy-ticket-reference', enabled: true }),
      expect.objectContaining({ id: 'view-ticket-reference', kind: 'internal-dialog', dialog: 'ticket-reference', enabled: true }),
      expect.objectContaining({ id: 'open-governed-action-guidance', kind: 'external-link', enabled: true }),
    ]);
    expect(result.actions.some(action => action.kind === 'external-link' && !isAllowedTicketUtilityLink(action.href))).toBe(false);
  });

  it('keeps every action visible but disabled when the server policy denies the capability', () => {
    const result = governedTicketUtilityActions('ticket-a', denied);
    expect(result.actions).toHaveLength(3);
    expect(result.actions.every(action => action.enabled === false && action.reason.includes('server policy'))).toBe(true);
  });

  it.each([
    'javascript:alert(1)', 'data:text/html,unsafe', 'http://github.com/nathcymru/Tocyn/blob/main/docs/security/capability-permissions.md',
    'https://evil.example/capability-permissions.md', 'https://github.com/nathcymru/Tocyn/blob/main/docs/security/capability-permissions.md?next=evil',
    'https://user@github.com/nathcymru/Tocyn/blob/main/docs/security/capability-permissions.md',
  ])('rejects unsafe or unapproved external action target %s', href => {
    expect(isAllowedTicketUtilityLink(href)).toBe(false);
  });
});
