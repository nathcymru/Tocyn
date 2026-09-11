import { describe, expect, it } from 'vitest';
import { deterministicNextTicket } from '../utils/deterministic-next-ticket';

const ticket = (id: string) => ({ id });

describe('deterministic next ticket', () => {
  it('selects the replacement in the removed ticket’s confirmed list slot', () => {
    expect(deterministicNextTicket([ticket('a'), ticket('b'), ticket('c')], [ticket('a'), ticket('c')], 'b')?.id).toBe('c');
  });

  it('uses the preceding remaining ticket when the removed ticket was last', () => {
    expect(deterministicNextTicket([ticket('a'), ticket('b')], [ticket('a')], 'b')?.id).toBe('a');
  });

  it('returns a truthful clear result for an exhausted server list', () => {
    expect(deterministicNextTicket([ticket('a')], [], 'a')).toBeUndefined();
  });
});
