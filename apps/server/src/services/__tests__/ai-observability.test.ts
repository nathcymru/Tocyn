import { afterEach, describe, expect, it, vi } from 'vitest';
import { StatelessAiService } from '../ai.service';

afterEach(() => vi.restoreAllMocks());
const suggestionFallback = "I'm sorry, I'm having trouble generating a suggestion right now. Please try again or draft a manual response.";
const chatFailure = "I'm having trouble connecting to my brain. Please try again later.";
const chatEmpty = "I'm sorry, I couldn't generate a response.";

for (const kind of ['suggestion', 'chat'] as const) {
  describe(`${kind} diagnostics`, () => {
    const invoke = (service: StatelessAiService) => kind === 'suggestion'
      ? service.generateSuggestion({ input: 'private question', context: ['private knowledge'], systemInstruction: 'private instruction' })
      : service.generateResponse('private question', 'private knowledge', [{ role: 'user', content: 'private history' }]);
    it('returns the provider result unchanged and emits no content', async () => {
      const run = vi.fn().mockResolvedValue({ response: 'private output' });
      const emit = vi.fn();
      await expect(invoke(new StatelessAiService({ run }, emit))).resolves.toBe('private output');
      expect(run).toHaveBeenCalledTimes(1);
      expect(emit.mock.calls.map(([event]) => [event.resource, event.operation, event.outcome])).toEqual([['ai', 'run', 'success']]);
      expect(JSON.stringify(emit.mock.calls)).not.toMatch(/private|llama|messages/);
    });
    it('keeps the exact provider-error fallback and measures its selection separately', async () => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      const run = vi.fn().mockRejectedValue(new Error('private provider failure'));
      const emit = vi.fn();
      await expect(invoke(new StatelessAiService({ run }, emit))).resolves.toBe(kind === 'suggestion' ? suggestionFallback : chatFailure);
      expect(run).toHaveBeenCalledTimes(1);
      expect(emit.mock.calls.map(([event]) => [event.operation, event.outcome])).toEqual([['run', 'failure'], ['fallback', 'success']]);
      expect(JSON.stringify([emit.mock.calls, log.mock.calls])).not.toContain('private');
    });
    it('preserves the existing empty-response behavior without pretending fallback is a model success', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const emit = vi.fn();
      await expect(invoke(new StatelessAiService({ run: vi.fn().mockResolvedValue({ response: '' }) }, emit)))
        .resolves.toBe(kind === 'suggestion' ? suggestionFallback : chatEmpty);
      expect(emit.mock.calls.map(([event]) => [event.operation, event.outcome])).toEqual([
        ['run', kind === 'suggestion' ? 'failure' : 'success'], ['fallback', 'success'],
      ]);
    });
    it('does not turn a failing diagnostic sink into an application failure or retry', async () => {
      const run = vi.fn().mockResolvedValue({ response: 'private output' });
      const emit = vi.fn(() => { throw new Error('sink failure'); });
      await expect(invoke(new StatelessAiService({ run }, emit))).resolves.toBe('private output');
      expect(run).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledTimes(1);
    });
  });
}
