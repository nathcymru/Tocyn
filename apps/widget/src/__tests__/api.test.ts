import { afterEach, describe, expect, it, vi } from 'vitest';
import { widgetHeaders, getWidgetSession } from '../api';

afterEach(() => vi.unstubAllGlobals());
describe('widget authentication contract', () => {
  it('supports a non-browser caller without accessing document', () => {
    vi.stubGlobal('document', undefined);
    vi.stubGlobal('localStorage', undefined);
    expect(widgetHeaders().has('Authorization')).toBe(false);
  });
  it('sends the customer token and widget routing key when checking a session', async () => {
    vi.stubGlobal('document', {querySelector:()=>({dataset:{widgetKey:'public-key',widgetToken:'customer-token'}})});
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({user:{email:'customer@example.test'}})));
    vi.stubGlobal('fetch',fetcher);
    expect(await getWidgetSession()).toEqual({email:'customer@example.test'});
    const headers = fetcher.mock.calls[0][1].headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer customer-token');
    expect(headers.get('X-Widget-Key')).toBe('public-key');
  });
  it('does not treat a public widget key or rejected session as authentication', async () => {
    vi.stubGlobal('document', {querySelector:()=>({dataset:{widgetKey:'public-key'}})});
    vi.stubGlobal('localStorage',undefined);
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('',{status:401})));
    expect(widgetHeaders().has('Authorization')).toBe(false);
    expect(await getWidgetSession()).toBeNull();
  });
});
