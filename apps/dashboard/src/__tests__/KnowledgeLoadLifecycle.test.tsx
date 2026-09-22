import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { TicketDetailPage } from '../pages/TicketDetailPage';
import { CollaborationProvider } from '../components/CollaborationContext';
import { useAuthStore } from '../store/authStore';

class Socket { static OPEN=1; readyState=1; onopen:null|(()=>void)=null; onclose:null|(()=>void)=null; onmessage:null|((event:{data:string})=>void)=null; onerror:null|(()=>void)=null; send(){} close(){} }
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const preference=(revision:number,panel:'conversation'|'details'='conversation',selectedTicketId:string|null=null)=>({revision,view:'all',sort:'updated_desc',filters:{},listQuery:'',listAnchor:'page:1',selectedTicketId,panel,updatedAt:'2026-09-11T00:00:00Z'});
const ticket={id:'workspace-ticket',subject:'Workspace ticket',customer_email:'customer@example.invalid',ticket_no:1,status:'open',priority:'normal',assigned_to:null,group_id:null,created_at:'2026-09-11T00:00:00Z',articles:[],pagination:{limit:20,next_cursor:null,has_more:false}};
const history={events:[{id:'event-1',kind:'ticket.intake',recordedAt:'2026-09-11T00:00:00Z',source:'dashboard',visibility:'public' as const,actor:{kind:'staff',id:'agent-a',provenance:'mfa-staff' as const},facts:{},articleId:null}],nextCursor:null};
const unavailableSla={response:{state:'unavailable',phase:'unavailable',completedAt:null,dueAt:null,remainingWorkingMilliseconds:null,targetWorkingMilliseconds:null},resolution:{state:'unavailable',phase:'unavailable',completedAt:null,dueAt:null,remainingWorkingMilliseconds:null,targetWorkingMilliseconds:null},handlerName:null};

const presentation = vi.hoisted(() => ({ enabled: true, contextDefault: 'remember' as 'remember'|'conversation'|'details' }));
vi.mock('../components/theme/OperatorThemeProvider', () => ({
  useOptionalOperatorPreferencesContext: () => ({ advanceAfterResolve: presentation.enabled, contextDefault: presentation.contextDefault, status: 'restored' }),
}));
let client: QueryClient;
function show(deferContent = false) {
  const contentPending: Array<(response: Response) => void> = [];
  const pending: Array<(response: Response) => void> = [];
  let saved = false;
  let failConfirmation = false;
  const onResolved = vi.fn();
  const writes: unknown[] = [];
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit = {}) => {
    const path = new URL(url, 'http://localhost').pathname;
    if (path === '/api/knowledge/articles') return new Promise<Response>(resolve => pending.push(resolve));
    if (path === '/api/knowledge/articles/answer/content') return deferContent ? new Promise<Response>(resolve => contentPending.push(resolve)) : json({content:'Verified synthetic answer'});
    if (/^\/api\/tickets\/[^/]+$/.test(path)) {
      if (options.method === 'PATCH') { writes.push(JSON.parse(String(options.body))); saved = true; failConfirmation = true; return json({success: true}); }
      if (failConfirmation) return json({error: 'Synthetic confirmation unavailable'}, 503);
      return json({...ticket, id:path.split('/').at(-1), status: saved ? 'resolved' : 'open'});
    }
    if (path === '/api/workspace/state') return json(options.method === 'PUT' ? {...JSON.parse(String(options.body)), revision: 4} : preference(3));
    if (path.startsWith('/api/workspace/drafts')) return new Response(null, {status: 204});
    if (path.endsWith('/history')) return json(history);
    if (path.endsWith('/sla')) return json(unavailableSla);
    if (path === '/api/settings') return json({});
    return json([]);
  }));
  useAuthStore.getState().setAuth('synthetic-session', {id:'operator',tenant_id:'tenant-a',email:'operator@example.invalid',full_name:'Operator',role:'admin',mfa_enabled:true});
  client = new QueryClient({defaultOptions:{queries:{retry:false}, mutations:{retry:false}}});
  const router = createMemoryRouter([{path:'/inbox/all/:id',element:<TicketDetailPage onResolved={onResolved}/>}],{initialEntries:['/inbox/all/workspace-ticket']});
  render(<QueryClientProvider client={client}><CollaborationProvider><RouterProvider router={router}/></CollaborationProvider></QueryClientProvider>);
  return {router,pending,contentPending};
}
afterEach(() => {cleanup();client?.clear();useAuthStore.getState().logout();presentation.enabled=true;presentation.contextDefault='remember';localStorage.clear();vi.unstubAllGlobals();vi.restoreAllMocks();});


const answer = (title = 'Synthetic answer') => [{id:'answer',title,status:'active',tier:'answer'}];
async function openKnowledge() { fireEvent.click(await screen.findByRole('button',{name:'Show ticket context'})); await screen.findByText('Loading tenant knowledge…'); }
async function setReplyText(value: string) {
  const editor = screen.getByRole('textbox', { name: 'Reply message' });
  editor.focus();
  await userEvent.clear(editor);
  await userEvent.type(editor, value, { skipClick: true });
  return editor;
}
const editorParagraphs = (editor: HTMLElement) => Array.from(editor.querySelectorAll('p'), paragraph => paragraph.textContent);

it('loads eligible knowledge and inserts it after existing draft text with feedback and focus', async () => {
  const f=show();await openKnowledge();
  await act(async()=>f.pending[0](json([...answer(),{id:'pending',title:'Pending hidden',status:'pending',tier:'answer'}])));
  const insert=await screen.findByRole('button',{name:'Insert Synthetic answer into reply'});
  expect(screen.queryByText('Loading tenant knowledge…')).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:/Pending hidden/})).not.toBeInTheDocument();
  const editor=await setReplyText('Keep draft');fireEvent.click(insert);
  await screen.findByText('Inserted knowledge: Synthetic answer');
  await waitFor(()=>expect(editorParagraphs(editor)).toEqual(['Keep draft','Verified synthetic answer']));
  await waitFor(()=>expect(editor).toHaveFocus());
});

it('shows failure and completes an explicit retry', async () => {
  const f=show();await openKnowledge();await act(async()=>f.pending[0](json({error:'Unavailable'},503)));
  fireEvent.click(await screen.findByRole('button',{name:'Retry knowledge'}));
  await waitFor(()=>expect(f.pending).toHaveLength(2));await act(async()=>f.pending[1](json(answer())));
  await screen.findByRole('button',{name:'Insert Synthetic answer into reply'});
  expect(screen.queryByRole('button',{name:'Retry knowledge'})).not.toBeInTheDocument();
});

it('reopens pending knowledge without retaining a cancelled loading state', async () => {
  const f=show();await openKnowledge();fireEvent.click(screen.getByRole('button',{name:'Hide ticket context'}));await openKnowledge();
  await waitFor(()=>expect(f.pending).toHaveLength(2));await act(async()=>f.pending[0](json(answer('Stale answer'))));
  expect(screen.queryByRole('button',{name:/Stale answer/})).not.toBeInTheDocument();
  await act(async()=>f.pending[1](json(answer())));await screen.findByRole('button',{name:'Insert Synthetic answer into reply'});
});

it.each(['ticket','identity'])('discards a pending response after %s remount', async (boundary) => {
  const f=show();await openKnowledge();
  await act(async()=>{if(boundary==='ticket')await f.router.navigate('/inbox/all/another-ticket');else useAuthStore.getState().setAuth('other-session',{id:'operator-b',tenant_id:'tenant-b',email:'other@example.invalid',full_name:'Other',role:'admin',mfa_enabled:true});});
  // The new keyed detail owns a separate request; expose context if restored closed.
  await screen.findByRole('combobox',{name:'Status'});
  if(screen.queryByRole('button',{name:'Show ticket context'}))fireEvent.click(screen.getByRole('button',{name:'Show ticket context'}));
  await waitFor(()=>expect(f.pending).toHaveLength(2));
  await act(async()=>f.pending[0](json(answer('Old identity answer'))));
  expect(screen.queryByRole('button',{name:/Old identity answer/})).not.toBeInTheDocument();
  await act(async()=>f.pending[1](json(answer('Current answer'))));await screen.findByRole('button',{name:'Insert Current answer into reply'});
});


it('inserts into the latest draft after a pending fresh content read', async () => {
  const f=show(true);await openKnowledge();await act(async()=>f.pending[0](json(answer())));
  const editor=await setReplyText('Original');
  fireEvent.click(await screen.findByRole('button',{name:'Insert Synthetic answer into reply'}));
  await waitFor(()=>expect(f.contentPending).toHaveLength(1));expect(screen.getByText('Loading Synthetic answer for insertion…')).toBeInTheDocument();await setReplyText('Original plus new typing');
  await act(async()=>f.contentPending[0](json({content:'Verified synthetic answer'})));
  await waitFor(()=>expect(editorParagraphs(editor)).toEqual(['Original plus new typing','Verified synthetic answer']));
  await screen.findByText('Inserted knowledge: Synthetic answer');await waitFor(()=>expect(editor).toHaveFocus());
});


it('previews content without changing the mounted conversation draft', async () => {
  const f=show();await openKnowledge();await act(async()=>f.pending[0](json(answer())));
  const editor=await setReplyText('Keep preview draft');
  fireEvent.click(await screen.findByRole('button',{name:'Preview Synthetic answer'}));await screen.findByText('Verified synthetic answer');
  expect(editor).toHaveTextContent('Keep preview draft');expect(screen.queryByText('Inserted knowledge: Synthetic answer')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Close preview'}));expect(screen.getByRole('button',{name:'Preview Synthetic answer'})).toHaveFocus();expect(editor).toHaveTextContent('Keep preview draft');
});


it('does not restore discarded text or announce insertion after a pending content read', async () => {
  const f=show(true);await openKnowledge();await act(async()=>f.pending[0](json(answer())));
  const editor=await setReplyText('Discard this draft');
  fireEvent.click(await screen.findByRole('button',{name:'Insert Synthetic answer into reply'}));
  await waitFor(()=>expect(f.contentPending).toHaveLength(1));
  fireEvent.click(await screen.findByRole('button',{name:'Discard draft'}));
  await screen.findByText('Draft discarded.');
  await act(async()=>f.contentPending[0](json({content:'Late content must not return'})));
  expect(editor.textContent).toBe('');
  expect(screen.queryByText('Inserted knowledge: Synthetic answer')).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Insert Synthetic answer into reply'})).toBeEnabled();
});
