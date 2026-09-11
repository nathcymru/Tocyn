import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { CollaborationProvider, useCollaboration } from '../components/CollaborationContext';
import { COLLABORATION_TYPING_EVENT, COLLABORATION_TYPING_PROTOCOL_VERSION, parseCollaborationTypingMessage } from '@luminatick/shared';
import { useAuthStore } from '../store/authStore';

const realtime = vi.hoisted(() => ({
  isConnected: true,
  lastMessage: null as unknown,
  presence: [] as { connectionId: string; userId: string; name: string; location: string | null }[],
  updateLocation: vi.fn(), connectionDetails: { latency: 0, reconnectCount: 0 },
  sendRealtime: vi.fn(() => true), manualReconnect: vi.fn(),
}));
vi.mock('../hooks/useRealtime', () => ({ useRealtime: () => realtime }));

function Probe() {
  const collaboration = useCollaboration();
  const viewers = collaboration.viewersForTicket('ticket-a');
  const typing = collaboration.typingForTicket('ticket-a');
  return <>
    <button type="button" onClick={() => collaboration.announceTyping({ ticketId: 'ticket-a', baseConversationRevision: 4, active: true })}>Type</button>
    <span>viewers:{viewers.map(viewer => viewer.name).join(',')}</span>
    <span>typing:{typing.map(candidate => candidate.actor.name).join(',')}</span>
    <span>typing-count:{typing.length}</span>
  </>;
}

function TicketLifecycleProbe() {
  const collaboration = useCollaboration();
  useEffect(() => {
    collaboration.updateLocation('ticket:ticket-a');
    return () => { collaboration.updateLocation(null); collaboration.stopTyping('ticket-a', 4); };
  }, [collaboration.stopTyping, collaboration.updateLocation]);
  return <button type="button" onClick={() => collaboration.announceTyping({ ticketId: 'ticket-a', baseConversationRevision: 4, active: true })}>Start typing</button>;
}

function view() {
  return render(<CollaborationProvider><Probe /></CollaborationProvider>);
}

afterEach(() => {
  cleanup();
  realtime.isConnected = true; realtime.lastMessage = null; realtime.presence = []; realtime.sendRealtime.mockClear();
  useAuthStore.getState().logout();
});

it('uses one deduplicated viewer list and sends a bounded, content-free typing hint at most once per throttle interval', () => {
  realtime.presence = [
    { connectionId: 'first', userId: 'agent-a', name: 'Ada', location: 'ticket:ticket-a' },
    { connectionId: 'second', userId: 'agent-a', name: 'Ada second session', location: 'ticket:ticket-a' },
    { connectionId: 'other', userId: 'agent-b', name: 'Bea', location: 'ticket:other' },
  ];
  view();
  expect(screen.getByText('viewers:Ada second session')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Type' }));
  fireEvent.click(screen.getByRole('button', { name: 'Type' }));
  expect(realtime.sendRealtime).toHaveBeenCalledTimes(1);
  expect(realtime.sendRealtime).toHaveBeenCalledWith({ type: COLLABORATION_TYPING_EVENT, payload: {
    version: COLLABORATION_TYPING_PROTOCOL_VERSION, ticketId: 'ticket-a', baseConversationRevision: 4, active: true,
  } });
  expect(JSON.stringify(realtime.sendRealtime.mock.calls[0])).not.toContain('body');
  expect(JSON.stringify(realtime.sendRealtime.mock.calls[0])).not.toContain('tenant');
});

it('accepts only server-shaped, current typing presence and removes it when the server marks it inactive', () => {
  const rendered = view();
  realtime.lastMessage = { type: COLLABORATION_TYPING_EVENT, payload: {
    version: 1, ticketId: 'ticket-a', actor: { id: 'agent-b', name: 'Bea' }, active: true, expiresAt: Date.now() + 6_000,
  } };
  act(() => rendered.rerender(<CollaborationProvider><Probe /></CollaborationProvider>));
  expect(screen.getByText('typing:Bea')).toBeInTheDocument();
  realtime.lastMessage = { type: COLLABORATION_TYPING_EVENT, payload: {
    version: 1, ticketId: 'ticket-a', actor: { id: 'agent-b', name: 'Bea' }, active: false, expiresAt: Date.now() + 6_000,
  } };
  act(() => rendered.rerender(<CollaborationProvider><Probe /></CollaborationProvider>));
  expect(screen.getByText('typing:')).toBeInTheDocument();
  expect(parseCollaborationTypingMessage({ type: COLLABORATION_TYPING_EVENT, payload: {
    version: 1, ticketId: 'ticket-a', actor: { id: 'agent-b', name: 'Bea' }, active: true, expiresAt: Date.now() + 1,
  } })).not.toBeNull();
  expect(parseCollaborationTypingMessage({ type: COLLABORATION_TYPING_EVENT, payload: {
    version: 1, ticketId: 'ticket-a', actor: { id: 'agent-b' }, active: true, expiresAt: Date.now() + 1,
  } })).toBeNull();
  expect(parseCollaborationTypingMessage({ type: COLLABORATION_TYPING_EVENT, payload: {
    version: 1, ticketId: 'ticket-a', actor: { id: 'agent-b', name: 'Bea' }, active: true, expiresAt: Date.now() + 60_000,
  } })).toBeNull();
});

it('does not rerun ticket cleanup when an unrelated realtime message rerenders the provider', () => {
  const rendered = render(<CollaborationProvider><TicketLifecycleProbe /></CollaborationProvider>);
  expect(realtime.updateLocation).toHaveBeenCalledWith('ticket:ticket-a');
  fireEvent.click(screen.getByRole('button', { name: 'Start typing' }));
  expect(realtime.sendRealtime).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ active: true }) }));
  realtime.lastMessage = { type: 'ticket.updated', payload: { id: 'unrelated-ticket' } };
  act(() => rendered.rerender(<CollaborationProvider><TicketLifecycleProbe /></CollaborationProvider>));
  expect(realtime.updateLocation).not.toHaveBeenCalledWith(null);
  expect(realtime.sendRealtime).not.toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ active: false }) }));
});

it('caps received typing hints and clears them on reconnect or a changed session', () => {
  const rendered = view();
  for (let index = 0; index <= 128; index++) {
    realtime.lastMessage = { type: COLLABORATION_TYPING_EVENT, payload: {
      version: 1, ticketId: 'ticket-a', actor: { id: `agent-${index}`, name: `Agent ${index}` }, active: true, expiresAt: Date.now() + 6_000,
    } };
    act(() => rendered.rerender(<CollaborationProvider><Probe /></CollaborationProvider>));
  }
  expect(screen.getByText('typing-count:128')).toBeInTheDocument();
  realtime.isConnected = false;
  act(() => rendered.rerender(<CollaborationProvider><Probe /></CollaborationProvider>));
  expect(screen.getByText('typing-count:0')).toBeInTheDocument();
  realtime.isConnected = true;
  realtime.lastMessage = null;
  act(() => rendered.rerender(<CollaborationProvider><Probe /></CollaborationProvider>));
  realtime.lastMessage = { type: COLLABORATION_TYPING_EVENT, payload: {
    version: 1, ticketId: 'ticket-a', actor: { id: 'agent-a', name: 'Ada' }, active: true, expiresAt: Date.now() + 6_000,
  } };
  act(() => rendered.rerender(<CollaborationProvider><Probe /></CollaborationProvider>));
  expect(screen.getByText('typing-count:1')).toBeInTheDocument();
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(screen.getByText('typing-count:0')).toBeInTheDocument();
  visibility.mockRestore();
  realtime.lastMessage = { type: COLLABORATION_TYPING_EVENT, payload: {
    version: 1, ticketId: 'ticket-a', actor: { id: 'agent-b', name: 'Bea' }, active: true, expiresAt: Date.now() + 6_000,
  } };
  act(() => rendered.rerender(<CollaborationProvider><Probe /></CollaborationProvider>));
  expect(screen.getByText('typing-count:1')).toBeInTheDocument();
  act(() => useAuthStore.getState().setAuth('new-session', { id: 'operator', tenant_id: 'tenant-a', email: 'operator@example.invalid', full_name: 'Operator', role: 'agent', mfa_enabled: true }));
  expect(screen.getByText('typing-count:0')).toBeInTheDocument();
});
