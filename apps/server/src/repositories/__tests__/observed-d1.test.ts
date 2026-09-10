import { describe, expect, it, vi } from 'vitest';
import { observeD1 } from '../observed-d1';

describe('observed D1 boundary', () => {
  function database() {
    const statement = { bind: vi.fn(function (this: unknown) { return this; }), first: vi.fn(), all: vi.fn(), raw: vi.fn(), run: vi.fn() };
    return { statement, db: { prepare: vi.fn(() => statement), batch: vi.fn(async (items: unknown[]) => items), dump: vi.fn(), exec: vi.fn() } as any };
  }
  it('returns the original binding when disabled', () => { const { db } = database(); expect(observeD1(db)).toBe(db); });
  it('unwraps prepared statements and measures one invocation without leaking inputs', async () => {
    const { db, statement } = database(); const emit = vi.fn(); const result = { tenant: 'private', rows: [1] }; statement.first.mockResolvedValue(result);
    const observed = observeD1(db, emit); const bound = observed.prepare('SELECT secret FROM articles WHERE tenant_id = ?').bind('private-tenant');
    await expect(bound.first()).resolves.toBe(result); expect(statement.first).toHaveBeenCalledTimes(1); expect(db.prepare).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(emit.mock.calls)).not.toContain('private');
  });
  it('preserves batch statement identity, result identity, and errors', async () => {
    const { db } = database(); const emit = vi.fn(); const result = { success: true }; db.batch.mockResolvedValue(result);
    const observed = observeD1(db, emit); const one = observed.prepare('a'); const two = observed.prepare('b');
    await expect(observed.batch([one, two])).resolves.toBe(result);
    expect(db.batch.mock.calls[0][0]).toEqual([db.prepare.mock.results[0].value, db.prepare.mock.results[1].value]);
    const error = { secret: 'error' }; db.batch.mockRejectedValueOnce(error); await expect(observed.batch([])).rejects.toBe(error);
  });
  it.each(['first','all','raw','run'] as const)('preserves native receiver, arguments and failures for %s', async method => {
    const {db,statement}=database();const emit=vi.fn();const result={privateValue:'never emitted'};
    statement[method].mockImplementation(function(this:unknown,...args:unknown[]){expect(this).toBe(statement);expect(args).toEqual(['argument']);return Promise.resolve(result);});
    const observed=observeD1(db,emit);const prepared=observed.prepare('private SQL').bind('private argument');
    await expect(prepared[method]('argument')).resolves.toBe(result);
    const failure={secret:'private failure'};statement[method].mockRejectedValueOnce(failure);
    await expect(prepared[method]('argument')).rejects.toBe(failure);
    expect(statement[method]).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls.map(([event])=>event.outcome)).toEqual(['success','failure']);
    expect(JSON.stringify(emit.mock.calls)).not.toMatch(/private|SQL|argument|failure"\s*:/);
  });
  it('keeps uninstrumented exec/dump methods bound to their native receiver', async () => {
    const {db}=database();const emit=vi.fn();db.exec.mockImplementation(function(this:unknown){expect(this).toBe(db);return 'exec-result';});db.dump.mockImplementation(function(this:unknown){expect(this).toBe(db);return 'dump-result';});
    const observed=observeD1(db,emit);expect(observed.exec('sql')).toBe('exec-result');expect(observed.dump()).toBe('dump-result');expect(emit).not.toHaveBeenCalled();
  });

});
