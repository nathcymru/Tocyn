import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useOperatorDraft, type OperatorDraftValue } from '../hooks/useOperatorDraft';
import { useAuthStore } from '../store/authStore';

const user = (id = 'operator', tenant_id = 'tenant-a') => ({ id, tenant_id, email: `${id}@example.invalid`, full_name: id, role: 'admin', mfa_enabled: true });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
let controller!: ReturnType<typeof useOperatorDraft>;
let renders: { ticketId: string | null; body: string; session: number }[] = [];
function Harness({ ticketId }: { ticketId: string | null }) {
  controller = useOperatorDraft(ticketId, { debounceMs: 100 });
  renders.push({ ticketId, body: controller.body, session: useAuthStore.getState().sessionGeneration });
  return <output data-testid="draft">{JSON.stringify({ status: controller.status, body: controller.body, bodyFormat: controller.bodyFormat, mode: controller.mode, attachments: controller.attachments, base: controller.baseConversationRevision, error: controller.error, version: controller.version })}</output>;
}
function current() { return JSON.parse(screen.getByTestId('draft').textContent || '{}'); }
const edited = (body: string): OperatorDraftValue => ({ mode: 'internal', body, bodyFormat: 'markdown-v1', attachments: [{ storageKey: 'agent-attachments/operator/a.txt', filename: 'a.txt', size: 1, contentType: 'text/plain' }], baseConversationRevision: 7 });

beforeEach(() => {
  localStorage.clear();
  renders = [];
  useAuthStore.setState({ token: null, user: null, mfaRequired: false, sessionGeneration: 0 });
  useAuthStore.getState().setAuth('session-a', user());
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); useAuthStore.getState().logout(); localStorage.clear(); });

it('restores the server draft, debounces edits, and only reports Saved after its returned version', async () => {
  const restored = { generation: '11111111-1111-4111-8111-111111111111', revision: 4, mode: 'public', body: 'restored', attachments: [], baseConversationRevision: 3, expiresAt: null, updatedAt: '2026-09-10T00:00:00Z' };
  const saved = { ...restored, revision: 5, mode: 'internal', body: 'latest', bodyFormat: 'markdown-v1', attachments: edited('latest').attachments, baseConversationRevision: 3 };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(restored)).mockResolvedValueOnce(json(saved)));
  render(<Harness ticketId="ticket-a" />);
  await waitFor(() => expect(current()).toMatchObject({ status: 'saved', body: 'restored', base: 3 }));
  act(() => { controller.update(edited('first')); controller.update(edited('latest')); });
  expect(current()).toMatchObject({ status: 'unsaved', body: 'latest', mode: 'internal' });
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(current()).toMatchObject({ status: 'saved', body: 'latest', base: 3, version: { generation: restored.generation, revision: 5 } }));
  const savedRequest = vi.mocked(fetch).mock.calls[1]?.[1] as RequestInit;
  expect(JSON.parse(String(savedRequest.body))).toEqual({
    expectedGeneration: restored.generation, expectedRevision: 4, mode: 'internal', body: 'latest', bodyFormat: 'markdown-v1', attachments: edited('latest').attachments,
  });
  expect(localStorage.getItem('lumina-auth')).not.toContain('latest');
});

it('preserves an unsaved edit after failure and exposes a retry without false Saved state', async () => {
  const saved = { generation: '22222222-2222-4222-8222-222222222222', revision: 1, ...edited('retry'), expiresAt: null, updatedAt: '2026-09-10T00:00:00Z' };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(json({ error: 'Unavailable' }, 503)).mockResolvedValueOnce(json(saved)));
  render(<Harness ticketId="ticket-a" />);
  await waitFor(() => expect(current().status).toBe('idle'));
  act(() => controller.update(edited('retry')));
  await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(current()).toMatchObject({ status: 'error', body: 'retry' }));
  expect(current().status).not.toBe('saved');
  await act(async () => { controller.retrySave(); });
  await waitFor(() => expect(current()).toMatchObject({ status: 'saved', body: 'retry', version: { generation: saved.generation, revision: 1 } }));
});

it('keeps local work on a generation/revision conflict and requires an explicit review path', async () => {
  const restored = { generation: '33333333-3333-4333-8333-333333333333', revision: 2, ...edited('before'), expiresAt: null, updatedAt: '2026-09-10T00:00:00Z' };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(restored)).mockResolvedValueOnce(json({ error: 'Conflict' }, 409)));
  render(<Harness ticketId="ticket-a" />);
  await waitFor(() => expect(current().status).toBe('saved'));
  act(() => controller.update(edited('local change')));
  await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(current()).toMatchObject({ status: 'conflict', body: 'local change' }));
  expect(current().error).toContain('another session');
});

it('fences a late restore from a prior ticket or authority session', async () => {
  const lateA = deferred<Response>();
  vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(lateA.promise)
    .mockResolvedValueOnce(json({ generation: '44444444-4444-4444-8444-444444444444', revision: 1, ...edited('ticket b'), expiresAt: null, updatedAt: '2026-09-10T00:00:00Z' }))
    .mockResolvedValueOnce(json({ generation: '55555555-5555-4555-8555-555555555555', revision: 1, ...edited('new authority'), expiresAt: null, updatedAt: '2026-09-10T00:00:00Z' })));
  const view = render(<Harness ticketId="ticket-a" />);
  view.rerender(<Harness ticketId="ticket-b" />);
  await waitFor(() => expect(current()).toMatchObject({ status: 'saved', body: 'ticket b' }));
  await act(async () => { lateA.resolve(json({ generation: '66666666-6666-4666-8666-666666666666', revision: 1, ...edited('stale ticket'), expiresAt: null, updatedAt: '2026-09-10T00:00:00Z' })); });
  expect(current().body).toBe('ticket b');
  act(() => useAuthStore.getState().setAuth('session-b', user('replacement', 'tenant-b')));
  await waitFor(() => expect(current()).toMatchObject({ status: 'saved', body: 'new authority' }));
  expect(current().body).not.toBe('ticket b');
});

it('uses the restored exact version for an explicit discard', async () => {
  const restored = { generation: '77777777-7777-4777-8777-777777777777', revision: 9, ...edited('discard'), expiresAt: null, updatedAt: '2026-09-10T00:00:00Z' };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(restored)).mockResolvedValueOnce(new Response(null, { status: 204 })));
  render(<Harness ticketId="ticket-a" />);
  await waitFor(() => expect(current().status).toBe('saved'));
  await act(async () => { expect(await controller.discard()).toBe('cleared'); });
  expect(current()).toMatchObject({ status: 'discarded', body: '', version: null });
  expect(String(vi.mocked(fetch).mock.calls[1][0])).toContain(`generation=${restored.generation}&revision=9`);
});

it('preserves a later local edit while confirmed-send cleanup removes only its prior version', async () => {
  const restored = { generation: '88888888-8888-4888-8888-888888888888', revision: 3, ...edited('sent copy'), expiresAt: null, updatedAt: '2026-09-10T00:00:00Z' };
  const deletion = deferred<Response>();
  const later = { generation: '99999999-9999-4999-8999-999999999999', revision: 1, ...edited('later copy'), expiresAt: null, updatedAt: '2026-09-10T00:00:00Z' };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(restored)).mockReturnValueOnce(deletion.promise).mockResolvedValueOnce(json(later)));
  render(<Harness ticketId="ticket-a" />);
  await waitFor(() => expect(current().status).toBe('saved'));
  let cleanup!: ReturnType<typeof controller.cleanupAfterConfirmedSend>;
  act(() => { cleanup = controller.cleanupAfterConfirmedSend({ generation: restored.generation, revision: restored.revision }); });
  act(() => controller.update(edited('later copy')));
  await act(async () => { deletion.resolve(new Response(null, { status: 204 })); await cleanup; });
  await waitFor(() => expect(current()).toMatchObject({ status: 'saved', body: 'later copy', version: { generation: later.generation, revision: 1 } }));
  const laterRequest = vi.mocked(fetch).mock.calls[2]?.[1] as RequestInit;
  expect(JSON.parse(String(laterRequest.body))).toMatchObject({ expectedGeneration: null, expectedRevision: 0, body: 'later copy' });
});

const stored = (body: string, revision = 1) => ({ generation: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', revision, ...edited(body) });
async function mountWithTimers() {
  vi.useFakeTimers();
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(<Harness ticketId="ticket-a" />); });
  return view;
}
const advanceAutosave = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(100); }); };

it('serializes a pending save and reschedules edits using its acknowledged revision', async () => {
  const first = deferred<Response>();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(stored('before', 3)))
    .mockReturnValueOnce(first.promise).mockResolvedValueOnce(json(stored('latest', 5))));
  await mountWithTimers();
  act(() => controller.update(edited('first')));
  await advanceAutosave();
  act(() => controller.update(edited('latest')));
  await advanceAutosave();
  act(() => { void controller.saveNow(); void controller.saveNow(); });
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  await act(async () => { first.resolve(json(stored('first', 4))); });
  expect(current()).toMatchObject({ status: 'unsaved', body: 'latest', version: { revision: 4 } });
  await advanceAutosave();
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[2][1]?.body))).toMatchObject({ expectedRevision: 4, body: 'latest' });
  expect(current()).toMatchObject({ status: 'saved', body: 'latest', version: { revision: 5 } });
});

it('keeps edits made during restore behind the fetched exact-version gate', async () => {
  const restoration = deferred<Response>();
  vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(restoration.promise).mockResolvedValueOnce(json(stored('local', 9))));
  await mountWithTimers();
  act(() => controller.update(edited('local')));
  await advanceAutosave();
  await act(async () => { await controller.saveNow(); });
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  expect(current()).toMatchObject({ status: 'loading', body: 'local' });
  await act(async () => { restoration.resolve(json(stored('remote', 8))); });
  expect(current()).toMatchObject({ status: 'unsaved', body: 'local', version: { revision: 8 } });
  await advanceAutosave();
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body))).toMatchObject({ expectedRevision: 8, body: 'local' });
});

it('requires restore retry after a failed read and never treats save retry as create authorization', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ error: 'Unavailable' }, 503))
    .mockResolvedValueOnce(json(stored('remote', 6))).mockResolvedValueOnce(json(stored('retained', 7))));
  await mountWithTimers();
  act(() => { controller.update(edited('retained')); controller.retrySave(); });
  await advanceAutosave();
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  expect(current()).toMatchObject({ status: 'error', body: 'retained' });
  await act(async () => { controller.retryRestore(); });
  expect(current()).toMatchObject({ status: 'unsaved', body: 'retained', version: { revision: 6 } });
  await advanceAutosave();
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[2][1]?.body))).toMatchObject({ expectedRevision: 6, body: 'retained' });
});

it('keeps conflict latched through edits, timers, and retry actions', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(stored('remote'))).mockResolvedValueOnce(json({ error: 'Conflict' }, 409)));
  await mountWithTimers();
  act(() => controller.update(edited('first')));
  await advanceAutosave();
  act(() => { controller.update(edited('later')); controller.retrySave(); controller.retryRestore(); });
  await advanceAutosave();
  expect(current()).toMatchObject({ status: 'conflict', body: 'later' });
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
});

it('waits for a first PUT before discarding its exact returned version', async () => {
  const first = deferred<Response>();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockReturnValueOnce(first.promise).mockResolvedValueOnce(new Response(null, { status: 204 })));
  await mountWithTimers();
  act(() => controller.update(edited('discard me')));
  await advanceAutosave();
  let discarded!: ReturnType<typeof controller.discard>;
  act(() => { discarded = controller.discard(); });
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  expect(current().body).toBe('discard me');
  await act(async () => { first.resolve(json(stored('discard me'))); expect(await discarded).toBe('cleared'); });
  expect(vi.mocked(fetch).mock.calls[2][1]?.method).toBe('DELETE');
  expect(String(vi.mocked(fetch).mock.calls[2][0])).toContain(`generation=${stored('').generation}&revision=1`);
  expect(current()).toMatchObject({ status: 'discarded', body: '', version: null });
  await advanceAutosave();
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
});

it('does not claim discard succeeded when the first PUT acknowledgement was lost', async () => {
  const first = deferred<Response>();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 })).mockReturnValueOnce(first.promise));
  await mountWithTimers();
  act(() => controller.update(edited('uncertain')));
  await advanceAutosave();
  let discarded!: ReturnType<typeof controller.discard>;
  act(() => { discarded = controller.discard(); });
  await act(async () => { first.resolve(json({ error: 'Unavailable' }, 503)); expect(await discarded).toBe('error'); });
  expect(current()).toMatchObject({ status: 'error', body: 'uncertain' });
  act(() => controller.update(edited('more work')));
  await act(async () => { expect(await controller.discard()).toBe('error'); });
  expect(current().body).toBe('more work');
});

it('serializes edits during delete and preserves edits made before confirmed-send cleanup began', async () => {
  const deletion = deferred<Response>();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(stored('sent', 3)))
    .mockReturnValueOnce(deletion.promise).mockResolvedValueOnce(json({ ...stored('after'), generation: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' })));
  await mountWithTimers();
  act(() => controller.update(edited('before cleanup')));
  let cleared!: ReturnType<typeof controller.cleanupAfterConfirmedSend>;
  act(() => { cleared = controller.cleanupAfterConfirmedSend(stored('', 3)); });
  act(() => controller.update(edited('after')));
  await advanceAutosave();
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  await act(async () => { deletion.resolve(new Response(null, { status: 204 })); await cleared; });
  expect(current()).toMatchObject({ status: 'unsaved', body: 'after', version: null });
  await advanceAutosave();
  expect(current()).toMatchObject({ status: 'saved', body: 'after' });
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[2][1]?.body))).toMatchObject({ expectedGeneration: null, expectedRevision: 0, body: 'after' });
});

it('preserves an unsaved edit already present when send cleanup begins', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(stored('sent', 3)))
    .mockResolvedValueOnce(new Response(null, { status: 204 })));
  await mountWithTimers();
  act(() => controller.update(edited('already later')));
  await act(async () => { expect(await controller.cleanupAfterConfirmedSend(stored('', 3))).toBe('cleared'); });
  expect(current()).toMatchObject({ status: 'unsaved', body: 'already later', version: null });
});

it('never renders a prior identity body and disables retained callbacks on navigation or unmount', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(stored('private a')))
    .mockResolvedValueOnce(json(stored('private b'))).mockResolvedValueOnce(json(stored('new authority'))));
  const view = await mountWithTimers();
  const prior = controller;
  await act(async () => { view.rerender(<Harness ticketId="ticket-b" />); });
  expect(renders.find(value => value.ticketId === 'ticket-b')?.body).toBe('');
  await act(async () => { prior.update(edited('wrong ticket')); await prior.saveNow(); });
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  const oldAuthority = controller;
  await act(async () => {
    useAuthStore.getState().setAuth('replacement', user('replacement', 'tenant-b'));
    oldAuthority.update(edited('wrong authority'));
    await oldAuthority.saveNow();
  });
  const session = useAuthStore.getState().sessionGeneration;
  expect(renders.find(value => value.session === session)?.body).toBe('');
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
  const unmounted = controller;
  view.unmount();
  await act(async () => { unmounted.update(edited('after unmount')); await unmounted.saveNow(); expect(await unmounted.discard()).toBe('error'); });
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
});

it('fences a pending save and its newer queued edits after navigation', async () => {
  const late = deferred<Response>();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(stored('ticket a')))
    .mockReturnValueOnce(late.promise).mockResolvedValueOnce(json(stored('ticket b'))));
  const view = await mountWithTimers();
  act(() => controller.update(edited('saving a')));
  await advanceAutosave();
  act(() => controller.update(edited('queued a')));
  await act(async () => { view.rerender(<Harness ticketId="ticket-b" />); });
  await act(async () => { late.resolve(json(stored('saving a', 2))); });
  await advanceAutosave();
  expect(current()).toMatchObject({ status: 'saved', body: 'ticket b' });
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
});

it('retains edits made after discard starts while waiting for an earlier PUT', async () => {
  const first = deferred<Response>();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockReturnValueOnce(first.promise).mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(json({ ...stored('keep later'), generation: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' })));
  await mountWithTimers();
  act(() => controller.update(edited('discard original')));
  await advanceAutosave();
  let discarded!: ReturnType<typeof controller.discard>;
  act(() => { discarded = controller.discard(); controller.update(edited('keep later')); });
  await act(async () => { first.resolve(json(stored('discard original'))); expect(await discarded).toBe('cleared'); });
  expect(current()).toMatchObject({ status: 'unsaved', body: 'keep later', version: null });
  await advanceAutosave();
  expect(current()).toMatchObject({ status: 'saved', body: 'keep later' });
});

it('leaves a newer saved draft untouched when cleanup of an earlier send version conflicts', async () => {
  const first = deferred<Response>();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(stored('sent', 3)))
    .mockReturnValueOnce(first.promise).mockResolvedValueOnce(json({ error: 'Conflict' }, 409)));
  await mountWithTimers();
  act(() => controller.update(edited('later saved')));
  await advanceAutosave();
  let cleared!: ReturnType<typeof controller.cleanupAfterConfirmedSend>;
  act(() => { cleared = controller.cleanupAfterConfirmedSend(stored('', 3)); });
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  await act(async () => { first.resolve(json(stored('later saved', 4))); expect(await cleared).toBe('conflict'); });
  expect(current()).toMatchObject({ status: 'saved', body: 'later saved', version: { revision: 4 }, error: null });
  expect(String(vi.mocked(fetch).mock.calls[2][0])).toContain('revision=3');
});

it('does not acknowledge a second distinct cleanup while a delete is in flight', async () => {
  const deletion = deferred<Response>();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(stored('sent', 3))).mockReturnValueOnce(deletion.promise));
  await mountWithTimers();
  let discarded!: ReturnType<typeof controller.discard>;
  act(() => { discarded = controller.discard(); });
  await act(async () => { expect(await controller.cleanupAfterConfirmedSend(stored('', 2))).toBe('error'); });
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  await act(async () => { deletion.resolve(new Response(null, { status: 204 })); expect(await discarded).toBe('cleared'); });
});


it('flushes a newer edit after an existing PUT before allowing navigation', async () => {
  const first = deferred<Response>();
  const second = deferred<Response>();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(stored('before', 3)))
    .mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise));
  await mountWithTimers();
  act(() => controller.update(edited('first')));
  await advanceAutosave();
  act(() => controller.update(edited('latest')));
  let result: boolean | undefined;
  let pending!: Promise<void>;
  act(() => { pending = controller.flushBeforeNavigation().then(value => { result = value; }); });
  await act(async () => { first.resolve(json(stored('first', 4))); });
  expect(result).toBeUndefined();
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[2][1]?.body))).toMatchObject({ expectedRevision: 4, body: 'latest' });
  await act(async () => { second.resolve(json(stored('latest', 5))); await pending; });
  expect(result).toBe(true);
  expect(current()).toMatchObject({ status: 'saved', body: 'latest' });
});

it('does not permit navigation after an unacknowledged save', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(stored('before', 3)))
    .mockResolvedValueOnce(json({ error: 'Unavailable' }, 503)));
  await mountWithTimers();
  act(() => controller.update(edited('keep me')));
  await act(async () => { expect(await controller.flushBeforeNavigation()).toBe(false); });
  expect(current()).toMatchObject({ status: 'error', body: 'keep me' });
});

it('clears previously restored content when a save confirms lost ticket authority', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(stored('previously authorized', 3)))
    .mockResolvedValueOnce(json({ error: 'Forbidden' }, 403)));
  await mountWithTimers();
  act(() => controller.update(edited('pending private content')));
  await act(async () => { await controller.saveNow(); });
  expect(current()).toMatchObject({ body: '', attachments: [], version: null, status: 'error' });
  await act(async () => { await controller.saveNow(); });
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
});


it('restores legacy drafts as plain without interpreting content and persists an explicit format change', async () => {
  const legacy = { generation: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', revision: 2, mode: 'public', body: '**literal**', attachments: [], baseConversationRevision: 0 };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(legacy)).mockResolvedValueOnce(json({ ...legacy, revision: 3, bodyFormat: 'markdown-v1' })));
  render(<Harness ticketId="ticket-a" />);
  await waitFor(() => expect(current()).toMatchObject({ status: 'saved', body: '**literal**', bodyFormat: 'plain' }));
  act(() => controller.update(value => ({ ...value, bodyFormat: 'markdown-v1' })));
  await act(async () => { await controller.flushBeforeNavigation(); });
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body))).toMatchObject({ expectedRevision: 2, body: '**literal**', bodyFormat: 'markdown-v1' });
  expect(current()).toMatchObject({ bodyFormat: 'markdown-v1', status: 'saved' });
});

it('does not accept a restored unknown format as a successful draft restore', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ...stored('unchanged'), bodyFormat: 'html' })));
  render(<Harness ticketId="ticket-a" />);
  await waitFor(() => expect(current().status).toBe('error'));
  expect(current().body).toBe('');
  expect(await controller.flushBeforeNavigation()).toBe(false);
});


it('retains an unsaved format when the save acknowledgement silently changes it', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(json({ ...stored('new Markdown'), bodyFormat: 'plain' })));
  render(<Harness ticketId="ticket-a" />);
  await waitFor(() => expect(current().status).toBe('idle'));
  act(() => controller.update(edited('new Markdown')));
  await act(async () => { expect(await controller.flushBeforeNavigation()).toBe(false); });
  expect(current()).toMatchObject({ status: 'error', body: 'new Markdown', bodyFormat: 'markdown-v1' });
});
