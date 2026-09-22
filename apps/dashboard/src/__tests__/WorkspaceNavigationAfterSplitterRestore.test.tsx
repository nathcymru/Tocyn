import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode, useEffect } from 'react';
import { createMemoryRouter, Link, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DraftNavigationGuard } from '../components/DraftNavigationGuard';
import { useOperatorDraft } from '../hooks/useOperatorDraft';
import { OperatorWorkspaceProvider, useOperatorWorkspaceState } from '../hooks/useOperatorWorkspaceState';
import { useAuthStore } from '../store/authStore';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const storedWorkspace = {
  revision: 7, view: 'all', sort: 'updated_desc', filters: {}, listQuery: '', listAnchor: 'page:1',
  selectedTicketId: 'beta2-email', panel: 'conversation', splitterRatio: 34, updatedAt: '2026-09-20T00:00:00Z',
};

function Conversation({ autoSelect = false }: { autoSelect?: boolean }) {
  const workspace = useOperatorWorkspaceState();
  const draft = useOperatorDraft('beta2-email');
  useEffect(() => {
    if (autoSelect && (workspace.status === 'restored' || workspace.status === 'saved') && workspace.selectedTicketId !== 'beta2-email') {
      workspace.update({ selectedTicketId: 'beta2-email' });
    }
  }, [autoSelect, workspace]);
  const draftPending = ['unsaved', 'saving', 'error', 'conflict'].includes(draft.status);
  const pending = draftPending || workspace.hasUnsavedChanges;
  const flush = async () => (await draft.flushBeforeNavigation()) && workspace.flushBeforeNavigation();
  return <>
    <DraftNavigationGuard pending={pending} flush={flush}
      failureMessage="Your draft or workspace preferences are not saved. Stay on this ticket, retry or restore preferences, then navigate again."
      retryLabel="Retry navigation" />
    <output data-testid="workspace-state">{JSON.stringify({ status: workspace.status, ratio: workspace.splitterRatio, dirty: workspace.hasUnsavedChanges, draft: draft.status })}</output>
    <button type="button" onClick={() => workspace.update({ splitterRatio: 34 })}>Set splitter ratio to 34</button>
    <button type="button" onClick={() => draft.update(current => ({ ...current, body: 'Unsent customer reply' }))}>Edit reply</button>
    {workspace.status === 'conflict' && <button type="button" onClick={workspace.restoreServerState}>Restore server preferences</button>}
    <Link to="/settings">Settings</Link>
  </>;
}

function show(autoSelect = false) {
  const router = createMemoryRouter([
    { path: '/inbox/all/beta2-email', element: <OperatorWorkspaceProvider><Conversation autoSelect={autoSelect} /></OperatorWorkspaceProvider> },
    { path: '/settings', element: <h1>General settings</h1> },
  ], { initialEntries: ['/inbox/all/beta2-email'] });
  render(<StrictMode><RouterProvider router={router} /></StrictMode>);
  return router;
}

function state() { return JSON.parse(screen.getByTestId('workspace-state').textContent || '{}') as { status: string; ratio: number; dirty: boolean; draft: string }; }

beforeEach(() => {
  useAuthStore.setState({ token: null, user: null, mfaRequired: false, sessionGeneration: 0 });
  useAuthStore.getState().setAuth('synthetic-session', { id: 'operator', tenant_id: 'tenant-a', email: 'operator@example.invalid', full_name: 'Operator', role: 'admin', mfa_enabled: true });
});
afterEach(() => { cleanup(); useAuthStore.getState().logout(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('does not turn a restored splitter ratio into an unsaved preference or block Settings', async () => {
  let persisted = { ...storedWorkspace, revision: 6, splitterRatio: 32 };
  const writes: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit = {}) => {
    if (url === '/api/workspace/state' && options.method === 'PUT') {
      const input = JSON.parse(String(options.body));
      writes.push(input);
      persisted = { ...persisted, ...input, revision: persisted.revision + 1 };
      return json(persisted);
    }
    if (url === '/api/workspace/state') return json(persisted);
    if (url === '/api/workspace/drafts/beta2-email') return new Response(null, { status: 204 });
    return json([]);
  }));
  show();
  await waitFor(() => expect(state()).toMatchObject({ status: 'restored', ratio: 32, dirty: false, draft: 'idle' }));
  fireEvent.click(screen.getByRole('button', { name: 'Set splitter ratio to 34' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  await waitFor(() => expect(state()).toMatchObject({ ratio: 34, dirty: false }));
  expect(writes[0]).toMatchObject({ splitterRatio: 34 });

  cleanup(); // Reload the conversation with its saved workspace preference.
  show();
  await waitFor(() => expect(state()).toMatchObject({ status: 'restored', ratio: 34, dirty: false, draft: 'idle' }));
  fireEvent.click(screen.getByRole('button', { name: 'Set splitter ratio to 34' }));
  expect(state().dirty).toBe(false);
  fireEvent.click(screen.getByRole('link', { name: 'Settings' }));
  expect(await screen.findByRole('heading', { name: 'General settings' })).toBeInTheDocument();
  expect(writes).toHaveLength(1);
});

it('navigates after an immediate selection save while an untouched draft is still restoring', async () => {
  const initial = { ...storedWorkspace, selectedTicketId: null };
  let acknowledgeWorkspace!: (response: Response) => void;
  const workspaceWrite = new Promise<Response>(resolve => { acknowledgeWorkspace = resolve; });
  const untouchedDraftRead = new Promise<Response>(() => {});
  const writes: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit = {}) => {
    if (url === '/api/workspace/state' && options.method === 'PUT') {
      writes.push(JSON.parse(String(options.body)));
      return workspaceWrite;
    }
    if (url === '/api/workspace/state') return json(initial);
    if (url === '/api/workspace/drafts/beta2-email') return untouchedDraftRead;
    return json([]);
  }));
  const router = show(true);
  await waitFor(() => expect(state()).toMatchObject({ status: 'unsaved', dirty: true, draft: 'loading' }));
  fireEvent.click(screen.getByRole('link', { name: 'Settings' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(router.state.location.pathname).toBe('/inbox/all/beta2-email');
  await act(async () => acknowledgeWorkspace(json({ ...initial, selectedTicketId: 'beta2-email', revision: 8 })));
  expect(await screen.findByRole('heading', { name: 'General settings' })).toBeInTheDocument();
  expect(writes[0]).toMatchObject({ selectedTicketId: 'beta2-email', expectedRevision: 7 });
});

it('still fences a genuinely edited reply until its draft write is acknowledged', async () => {
  let acknowledge!: (response: Response) => void;
  const draftWrite = new Promise<Response>(resolve => { acknowledge = resolve; });
  const writes: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit = {}) => {
    if (url === '/api/workspace/state') return json(storedWorkspace);
    if (url === '/api/workspace/drafts/beta2-email' && options.method === 'PUT') { writes.push(JSON.parse(String(options.body))); return draftWrite; }
    if (url === '/api/workspace/drafts/beta2-email') return new Response(null, { status: 204 });
    return json([]);
  }));
  const router = show();
  await waitFor(() => expect(state()).toMatchObject({ status: 'restored', dirty: false, draft: 'idle' }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit reply' }));
  await waitFor(() => expect(state().draft).toBe('unsaved'));
  fireEvent.click(screen.getByRole('link', { name: 'Settings' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(router.state.location.pathname).toBe('/inbox/all/beta2-email');
  expect(writes[0]).toMatchObject({ body: 'Unsent customer reply' });
  await act(async () => { acknowledge(json({ generation: 'draft-generation', revision: 1, mode: 'public', body: 'Unsent customer reply', bodyFormat: 'markdown-v1', attachments: [], mentionedUserIds: [], baseConversationRevision: 0 })); });
  expect(await screen.findByRole('heading', { name: 'General settings' })).toBeInTheDocument();
});

it('exposes workspace conflict recovery when another tab advances the shared revision', async () => {
  let persisted = { ...storedWorkspace, selectedTicketId: null as string | null };
  const writes: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit = {}) => {
    if (url === '/api/workspace/state' && options.method === 'PUT') {
      writes.push(JSON.parse(String(options.body)));
      // Another authenticated tab changed this operator's workspace after the read.
      persisted = { ...persisted, revision: persisted.revision + 1, selectedTicketId: 'beta2-email' };
      return json({ error: 'Conflict' }, 409);
    }
    if (url === '/api/workspace/state') return json(persisted);
    if (url === '/api/workspace/drafts/beta2-email') return new Response(null, { status: 204 });
    return json([]);
  }));
  const router = show(true);
  await waitFor(() => expect(writes).toHaveLength(1));
  await waitFor(() => expect(state()).toMatchObject({ status: 'conflict', dirty: true, draft: 'idle' }));
  fireEvent.click(screen.getByRole('link', { name: 'Settings' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Your draft or workspace preferences are not saved');
  expect(router.state.location.pathname).toBe('/inbox/all/beta2-email');
  fireEvent.click(screen.getByRole('button', { name: 'Restore server preferences' }));
  await waitFor(() => expect(state()).toMatchObject({ status: 'restored', dirty: false }));
  fireEvent.click(screen.getByRole('link', { name: 'Settings' }));
  expect(await screen.findByRole('heading', { name: 'General settings' })).toBeInTheDocument();
  expect(writes).toHaveLength(1);
});
