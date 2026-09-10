import { describe, expect, it } from 'vitest';
import { createRequestCanonicalMutationSli } from '../request-canonical-mutation-sli';

describe('request-scoped canonical mutation SLI', () => {
  it('counts only an acknowledged durable receipt as a completed mutation', () => {
    const sli = createRequestCanonicalMutationSli();
    sli.recordAttempt();
    sli.recordDurablyCompleted();
    expect(sli.snapshot()).toEqual({
      version: 1, type: 'canonical_mutation.sli.request', scope: 'request', complete: true,
      counts: { attempted: 1, durablyCompleted: 1, replayed: 0, noOp: 0, denied: 0, uncertain: 0 },
    });
  });

  it('keeps replay separate and makes missing terminal acknowledgement uncertain', () => {
    const replay = createRequestCanonicalMutationSli();
    replay.recordAttempt();
    replay.recordReplayed();
    expect(replay.snapshot()).toMatchObject({ complete: true, counts: { attempted: 1, replayed: 1, durablyCompleted: 0, noOp: 0 } });

    const unknown = createRequestCanonicalMutationSli();
    unknown.recordAttempt();
    expect(unknown.snapshot()).toMatchObject({ complete: false, counts: { attempted: 1, noOp: 0, uncertain: 1 } });

    const noOp = createRequestCanonicalMutationSli();
    noOp.recordAttempt();
    noOp.recordNoOp();
    expect(noOp.snapshot()).toMatchObject({ complete: true, counts: { attempted: 1, durablyCompleted: 0, replayed: 0, noOp: 1, uncertain: 0 } });
  });

  it('keeps denied attempts out of the durable denominator and marks observer failure incomplete', () => {
    const denied = createRequestCanonicalMutationSli();
    denied.recordDenied();
    denied.markObserverFault();
    expect(denied.snapshot()).toMatchObject({ complete: false, counts: { attempted: 0, noOp: 0, denied: 1 } });
  });

  it('uses fixed one-request counters and makes duplicate instrumentation incomplete', () => {
    const sli = createRequestCanonicalMutationSli();
    sli.recordAttempt();
    sli.recordAttempt();
    sli.recordDurablyCompleted();
    expect(sli.snapshot()).toMatchObject({
      complete: false,
      counts: { attempted: 1, durablyCompleted: 1, replayed: 0, noOp: 0, denied: 0, uncertain: 0 },
    });
  });
});
