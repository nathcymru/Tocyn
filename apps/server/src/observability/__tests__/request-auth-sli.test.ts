import { describe, expect, it } from 'vitest';
import { createRequestAuthSli } from '../request-auth-sli';

describe('request-scoped credential auth SLI', () => {
  it('keeps one unsampled fixed-dimension trusted decision', () => {
    const sli = createRequestAuthSli();
    sli.record('accepted');
    expect(sli.snapshot()).toEqual({
      version: 1,
      type: 'auth.sli.request',
      scope: 'credential',
      complete: true,
      counts: { attempted: 1, accepted: 1, denied: 0, unavailable: 0, challenge: 0 },
    });
  });

  it('makes duplicate decisions and observer failures explicitly incomplete without changing counts', () => {
    const duplicate = createRequestAuthSli();
    duplicate.record('denied');
    duplicate.record('accepted');
    expect(duplicate.snapshot()).toMatchObject({ complete: false, counts: { attempted: 1, denied: 1, accepted: 0 } });

    const observerFault = createRequestAuthSli();
    observerFault.record('unavailable');
    observerFault.markObserverFault();
    expect(observerFault.snapshot()).toMatchObject({ complete: false, counts: { attempted: 1, unavailable: 1 } });
  });
});

it('never labels an invalid runtime classification as complete evidence', () => {
  const sli = createRequestAuthSli();
  sli.record('unsupported' as never);
  expect(sli.snapshot()).toMatchObject({ complete: false, counts: { attempted: 0 } });
});
