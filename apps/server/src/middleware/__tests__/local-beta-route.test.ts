import { describe, expect, it } from 'vitest';
import { localBetaRoute } from '../local-beta';

describe('localBetaRoute', () => {
  it('allows the authenticated reply capability read in the guarded local profile', () => {
    expect(localBetaRoute('GET', '/api/tickets/ticket-1/reply-capability')).toBe('conversation-read');
    expect(localBetaRoute('GET', '/api/tickets/ticket-1/utility-actions')).toBe('conversation-read');
  });

  it('keeps unimplemented API and customer variants disabled', () => {
    expect(localBetaRoute('GET', '/api/v1/tickets/ticket-1/reply-capability')).toBe('disabled');
    expect(localBetaRoute('GET', '/api/v1/customer/tickets/ticket-1/reply-capability')).toBe('disabled');
  });

  it('admits only the three staff SLA routes needed by the local beta', () => {
    expect(localBetaRoute('GET', '/api/sla-policy')).toBe('conversation-read');
    expect(localBetaRoute('PUT', '/api/sla-policy')).toBe('configuration');
    expect(localBetaRoute('POST', '/api/tickets/ticket-1/sla/initialize')).toBe('conversation-write');

    for (const [method, path] of [
      ['POST', '/api/sla-policy'], ['PATCH', '/api/sla-policy'], ['GET', '/api/sla-policy/extra'],
      ['POST', '/api/tickets/ticket-1/sla/initialize/extra'], ['POST', '/api/tickets/sla/initialize'],
      ['POST', '/api/v1/tickets/ticket-1/sla/initialize'], ['POST', '/api/v1/customer/tickets/ticket-1/sla/initialize'],
      ['POST', '/api/tickets/sla/initialize/bulk'],
    ] as const) expect(localBetaRoute(method, path)).toBe('disabled');
  });

  it('admits only exact capacity read and configuration routes',()=>{
    expect(localBetaRoute('GET','/api/operators/operator/capacity')).toBe('conversation-read');
    expect(localBetaRoute('PUT','/api/operators/operator/capacity')).toBe('configuration');
    expect(localBetaRoute('POST','/api/operators/operator/capacity')).toBe('disabled');
    expect(localBetaRoute('PUT','/api/v1/operators/operator/capacity')).toBe('disabled');
  });
  it('admits the responsible-owner transition as a bounded conversation write', () => {
    expect(localBetaRoute('PATCH', '/api/tickets/ticket-1/responsible-owner')).toBe('conversation-write');
  });

  it('admits the route POST as bounded conversation write and rejects non-dashboard variants', () => {
    expect(localBetaRoute('POST', '/api/tickets/ticket-1/route')).toBe('conversation-write');
    expect(localBetaRoute('POST', '/api/v1/tickets/ticket-1/route')).toBe('disabled');
    expect(localBetaRoute('POST', '/api/v1/customer/tickets/ticket-1/route')).toBe('disabled');
  });

  it('rejects unsupported verbs for /api/tickets/:id/route', () => {
    expect(localBetaRoute('PUT', '/api/tickets/ticket-1/route')).toBe('disabled');
    expect(localBetaRoute('GET', '/api/tickets/ticket-1/route')).toBe('disabled');
    expect(localBetaRoute('DELETE', '/api/tickets/ticket-1/route')).toBe('disabled');
  });
});


it('admits only the exact staff activity read inventory',()=>{
  expect(localBetaRoute('GET','/api/activities')).toBe('conversation-read');
  for(const [method,path] of [
    ['POST','/api/activities'],['GET','/api/activities/extra'],
    ['GET','/api/v1/activities'],['GET','/api/v1/customer/activities'],
  ])expect(localBetaRoute(method,path)).toBe('disabled');
});


it('admits exact balanced and activity mutation forms without API or extra-path variants',()=>{
  expect(localBetaRoute('POST','/api/tickets/ticket-1/balanced-assignment')).toBe('conversation-write');
  expect(localBetaRoute('PATCH','/api/activities/activity-1/read')).toBe('conversation-write');
  expect(localBetaRoute('PATCH','/api/activities/activity-1/dismiss')).toBe('conversation-write');
  for(const [method,path] of [
    ['GET','/api/tickets/ticket-1/balanced-assignment'],['PATCH','/api/tickets/ticket-1/balanced-assignment'],
    ['POST','/api/tickets/ticket-1/balanced-assignment/extra'],['POST','/api/v1/tickets/ticket-1/balanced-assignment'],
    ['POST','/api/activities/activity-1/read'],['GET','/api/activities/activity-1/dismiss'],
    ['PATCH','/api/activities/activity-1/read/extra'],['PATCH','/api/activities/activity-1/other'],
    ['PATCH','/api/v1/customer/activities/activity-1/read'],
  ])expect(localBetaRoute(method,path)).toBe('disabled');
});
