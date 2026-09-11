import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { Profiler, type ProfilerOnRenderCallback } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TicketDetailPage } from '../pages/TicketDetailPage';
import { CollaborationProvider } from '../components/CollaborationContext';
import { useAuthStore } from '../store/authStore';

class Socket {
  static OPEN=1;static latest:Socket;
  readyState=1;onopen:(()=>void)|null=null;onclose:(()=>void)|null=null;
  onmessage:((event:{data:string})=>void)|null=null;onerror:(()=>void)|null=null;
  constructor(){Socket.latest=this;}
  send(){} close(){}
  emit(payload:unknown){this.onmessage?.({data:JSON.stringify(payload)});}
}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
function deferred<T>() {let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return{promise,resolve};}
let client:QueryClient;
let ticket:ReturnType<typeof initialTicket>;
function initialTicket(){return{id:'workflow-ticket',subject:'Operator workflow ticket',customer_email:'customer@example.invalid',ticket_no:62,status:'open',priority:'normal',assigned_to:'22222222-2222-4222-8222-222222222222' as string|null,group_id:'assigned-group' as string|null,created_at:'2026-09-09T00:00:00Z',articles:[{id:'initial-message',body:'Customer question',sender_type:'customer',is_internal:false,created_at:'2026-09-09T00:00:00Z'}],pagination:{limit:20,next_cursor:null,has_more:false}};}
const unavailableSla={response:{state:'unavailable',phase:'unavailable',completedAt:null,dueAt:null,remainingWorkingMilliseconds:null,targetWorkingMilliseconds:null},resolution:{state:'unavailable',phase:'unavailable',completedAt:null,dueAt:null,remainingWorkingMilliseconds:null,targetWorkingMilliseconds:null},handlerName:null};
function transport(handle:(path:string,options:RequestInit,url:string)=>Response|Promise<Response>, fields: unknown[] = [], workspace?: (options: RequestInit) => Response | undefined, sla: (path: string, options: RequestInit) => Response | Promise<Response> = () => json(unavailableSla), collision: boolean | (() => number) = false) {
  vi.stubGlobal('fetch',vi.fn(async (url:string,options:RequestInit)=>{
    const path=new URL(url,'http://localhost').pathname;
    if(path==='/api/workspace/state') {
      if(options.method==='PUT') return json({revision:1,view:'all',sort:'updated_desc',filters:{},listQuery:'',listAnchor:'page:1',selectedTicketId:'workflow-ticket',panel:'details',updatedAt:'2026-09-11T00:00:00Z'});
      return json({revision:0,view:'all',sort:'updated_desc',filters:{},listQuery:'',listAnchor:'page:1',selectedTicketId:null,panel:'details',updatedAt:'2026-09-11T00:00:00Z'});
    }
    if(path.startsWith('/api/workspace/drafts')) {
      const override = workspace?.(options); if (override) return override;
      if(options.method === 'GET' || !options.method) return new Response(null,{status:204});
      if(options.method === 'DELETE') return new Response(null,{status:204});
      const body=JSON.parse(String(options.body));
      return json({ticketId:'workflow-ticket',generation:'99999999-9999-4999-8999-999999999999',revision:1,mode:body.mode,body:body.body,bodyFormat:body.bodyFormat,attachments:body.attachments,baseConversationRevision:0,expiresAt:null,updatedAt:'2026-09-10T00:00:00Z'});
    }
    if(path === '/api/tickets/workflow-ticket/reply-capability') return json({version:1,ticketId:'workflow-ticket',modes:[
      {visibility:'public',channel:'email',delivery:'email_attempted',recipient:'ticket_customer',record:'ticket_article',body:{acceptedFormats:['plain','markdown-v1'],maxCharacters:16000},attachments:{maxCount:10,maxBytesPerFile:10485760,contentTypes:['image/png','image/jpeg','image/gif','image/webp','application/pdf','text/plain','text/csv']}},
      {visibility:'internal',channel:'internal',delivery:'recorded_only',recipient:null,record:'ticket_article',body:{acceptedFormats:['plain','markdown-v1'],maxCharacters:16000},attachments:{maxCount:10,maxBytesPerFile:10485760,contentTypes:['image/png','image/jpeg','image/gif','image/webp','application/pdf','text/plain','text/csv']}}
    ], ...(collision ? { collision: { version: 1, protocol: 'draft-precondition-v1', conversationRevision: typeof collision === 'function' ? collision() : 0 },
      internalMentions: { version: 1, protocol: 'internal-activity-v1', maxRecipients: 16 } } : {})});
    if(path===`/api/tickets/${ticket.id}/sla`) return sla(path,options);
    if(path.startsWith('/api/tickets/')||path.startsWith('/api/attachments/'))return handle(path,options,url);
    if(path==='/api/groups')return json([{id:'assigned-group',name:'Assigned group'}]);
    if(path==='/api/users/agents')return json([{id:'22222222-2222-4222-8222-222222222222',full_name:'Assigned agent'}]);
    if(path==='/api/settings')return json({});
    if(path==='/api/ticket-fields')return json(fields);
    return json([]);
  }));
}
function showDetail(onRender?: ProfilerOnRenderCallback){
  const router = createMemoryRouter([{ path: '/tickets/:id', element: <TicketDetailPage /> }], { initialEntries: ['/tickets/workflow-ticket'] });
  render(<QueryClientProvider client={client}><CollaborationProvider><Profiler id="ticket-detail-workflow" onRender={onRender ?? (() => undefined)}><RouterProvider router={router} /></Profiler></CollaborationProvider></QueryClientProvider>);
}
beforeEach(()=>{
  client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
  ticket=initialTicket();vi.stubGlobal('WebSocket',Socket);vi.stubGlobal('alert',vi.fn());
  useAuthStore.getState().setAuth('synthetic-operator-session',{id:'operator',tenant_id:'tenant-a',email:'operator@example.invalid',full_name:'Operator',role:'admin',mfa_enabled:true});
});
afterEach(()=>{cleanup();client.clear();useAuthStore.getState().logout();localStorage.clear();vi.unstubAllGlobals();});

it.each([
  [0, '0 B'], [62, '62 B'], [1536, '1.5 KB'], [1048576, '1 MB'],
])('displays canonical attachment size %s in truthful units', async (size, expected) => {
  const data = { ...ticket, articles: ticket.articles.map(article => ({ ...article,
    attachments: [{ id: 'size-fixture', filename: 'size.txt', size, file_size: 4096 }],
  })) };
  transport(() => json(data));
  showDetail();
  expect(await screen.findByRole('button', { name: /size\.txt/ })).toHaveTextContent(expected);
});

it('converts the legacy attachment byte field when canonical size is absent', async () => {
  const data = { ...ticket, articles: ticket.articles.map(article => ({ ...article,
    attachments: [{ id: 'legacy-fixture', file_name: 'legacy.txt', file_size: 2048 }],
  })) };
  transport(() => json(data)); showDetail();
  expect(await screen.findByRole('button', { name: /legacy\.txt/ })).toHaveTextContent('2 KB');
});

it('previews an article raster attachment only through its authenticated download endpoint', async () => {
  const data = { ...ticket, articles: ticket.articles.map(article => ({ ...article,
    attachments: [{ id: 'image-fixture', filename: 'article-image.png', size: 15, contentType: 'image/png' }],
  })) };
  const createObjectURL = vi.fn(() => 'blob:article-image');
  const NativeURL = URL;
  vi.stubGlobal('URL', class extends NativeURL { static createObjectURL = createObjectURL; static revokeObjectURL = vi.fn(); });
  transport((path) => path === '/api/attachments/image-fixture/download'
    ? new Response('synthetic-image', { status: 200, headers: { 'Content-Type': 'image/png' } })
    : json(data));
  showDetail();
  expect(await screen.findByRole('button', { name: 'Preview image article-image.png' })).toBeTruthy();
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/attachments/image-fixture/download'))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Preview image article-image.png' }));
  await screen.findByRole('img', { name: 'Preview of article-image.png' });
  const request = vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes('/attachments/image-fixture/download'));
  expect(new Headers(request?.[1]?.headers).get('Authorization')).toBe('Bearer synthetic-operator-session');
  expect(createObjectURL).toHaveBeenCalledWith(expect.objectContaining({ type: 'image/png' }));
});

it('snapshots native file selection before clearing the input and preserves explicit removal focus', async () => {
  transport(() => json(ticket));
  showDetail(); await screen.findByText('Customer question');
  const input = screen.getByLabelText('Reply attachments') as HTMLInputElement;
  const file = new File(['synthetic'], 'selected.txt', { type: 'text/plain' });
  let nativeFiles = [file];
  Object.defineProperty(input, 'files', { configurable: true, get: () => nativeFiles });
  Object.defineProperty(input, 'value', { configurable: true, get: () => '', set: () => { nativeFiles = []; } });
  // A browser clears FileList when value is cleared. Queue another update so the
  // attachment updater executes after the event, rather than an eager test-only path.
  act(() => {
    fireEvent.change(screen.getByRole('textbox', { name: 'Reply message' }), { target: { value: 'Draft' } });
    fireEvent.change(input);
  });
  const remove = await screen.findByRole('button', { name: 'Remove selected.txt' });
  expect(nativeFiles).toHaveLength(0);
  expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true);
  remove.focus(); fireEvent.click(remove);
  expect(screen.queryByRole('button', { name: 'Remove selected.txt' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Attach files' })).toHaveFocus();
  expect(screen.getByText('Attachment removed.')).toHaveAttribute('role', 'status');
});

it('distinguishes a recoverable detail failure from not found and recovers through an explicit retry',async()=>{
  let failed=true;transport(()=>failed?json({error:'Temporarily unavailable'},503):json(ticket));
  showDetail();expect(await screen.findByRole('alert')).toHaveTextContent('Could not load ticket');
  expect(screen.queryByText('Ticket not found.')).not.toBeInTheDocument();
  failed=false;fireEvent.click(screen.getByRole('button',{name:'Retry loading ticket'}));
  await screen.findByRole('heading',{name:ticket.subject});
});

it('shows a mounted service-level failure and retries its shared detail query without blocking the ticket', async () => {
  let failSla = true;
  transport(() => json(ticket), [], undefined, () => failSla ? json({ error: 'Unavailable' }, 503) : json({ ...unavailableSla, resolution: { state: 'on-track', phase: 'running', completedAt: null, dueAt: '2026-09-11T10:00:00.000Z', remainingWorkingMilliseconds: 60000, targetWorkingMilliseconds: 3600000 } }));
  showDetail();
  await screen.findByRole('heading', { name: ticket.subject });
  expect(await screen.findByText('Service level is unavailable.')).toBeTruthy();
  failSla = false;
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect((await screen.findAllByText(/^Due /)).length).toBe(2);
});

it('persists explicit assignment clearing and exposes pending/rejected state changes without displaying false success',async()=>{
  const patches:Record<string,unknown>[]=[];const pending=deferred<Response>();let hold=false;
  transport((_path,options)=>{
    if(options.method==='PATCH'){
      const data=JSON.parse(String(options.body));patches.push(data);
      if(hold)return pending.promise;
      Object.assign(ticket,data);return json({success:true});
    }
    return json(ticket);
  });
  showDetail();await screen.findByRole('heading',{name:ticket.subject});
  fireEvent.change(screen.getByRole('combobox',{name:'Assigned To'}),{target:{value:''}});
  await waitFor(()=>expect(patches).toContainEqual({assigned_to:null}));
  await waitFor(()=>expect(screen.getByRole('combobox',{name:'Assigned To'})).toHaveValue(''));
  fireEvent.change(screen.getByRole('combobox',{name:'Group'}),{target:{value:''}});
  await waitFor(()=>expect(patches).toContainEqual({group_id:null}));
  await waitFor(()=>expect(screen.getByRole('combobox',{name:'Group'})).toHaveValue(''));
  hold=true;const pendingStatus=screen.getByRole('combobox',{name:'Status'});pendingStatus.focus();fireEvent.change(pendingStatus,{target:{value:'closed'}});
  await waitFor(()=>expect(screen.getByRole('combobox',{name:'Status'})).toHaveAttribute('aria-disabled','true'));
  expect(document.activeElement).toBe(screen.getByRole('combobox',{name:'Status'}));
  fireEvent.change(screen.getByRole('combobox',{name:'Status'}),{target:{value:'resolved'}});
  expect(patches.filter(patch=>'status' in patch)).toHaveLength(1);
  pending.resolve(json({error:'State change rejected'},403));
  expect(await screen.findByRole('alert')).toHaveTextContent('State change rejected');
  expect(screen.getByRole('combobox',{name:'Status'})).toBe(pendingStatus);
  expect(pendingStatus).toHaveValue('open');
  expect(pendingStatus).toHaveAttribute('aria-disabled','false');
  expect(pendingStatus).toHaveFocus();
});

it.each([
  ['Status', { status: 'pending' }, 'pending'],
  ['Priority', { priority: 'high' }, 'high'],
  ['Assigned To', { assigned_to: null }, ''],
  ['Group', { group_id: null }, ''],
] as const)('refreshes the native %s control after its authoritative update without losing focus', async (name, change, expected) => {
  transport((_path, options) => {
    if (options.method === 'PATCH') {
      Object.assign(ticket, JSON.parse(String(options.body)));
      return json({ success: true });
    }
    return json(ticket);
  });
  showDetail(); await screen.findByRole('heading', { name: ticket.subject });
  const previous = screen.getByRole('combobox', { name });
  previous.focus(); fireEvent.change(previous, { target: { value: expected } });
  await waitFor(() => {
    const refreshed = screen.getByRole('combobox', { name });
    expect(refreshed).not.toBe(previous);
    expect(refreshed).toHaveValue(expected);
    expect(refreshed).toHaveFocus();
  });
  expect(ticket).toMatchObject(change);
});

it('does not steal focus after a confirmed select update when the operator moves elsewhere', async () => {
  const pending = deferred<Response>();
  transport((_path, options) => {
    if (options.method === 'PATCH') return pending.promise;
    return json(ticket);
  });
  showDetail(); await screen.findByRole('heading', { name: ticket.subject });
  const priority = screen.getByRole('combobox', { name: 'Priority' });
  priority.focus(); fireEvent.change(priority, { target: { value: 'high' } });
  const status = screen.getByRole('combobox', { name: 'Status' });
  status.focus();
  Object.assign(ticket, { priority: 'high' });
  await act(async () => { pending.resolve(json({ success: true })); });
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Priority' })).not.toBe(priority));
  expect(status).toHaveFocus();
});

it('keeps a committed select read-only until its detail refresh succeeds without repeating the PATCH', async () => {
  let patches = 0;
  let confirmationAvailable = false;
  transport((_path, options) => {
    if (options.method === 'PATCH') {
      patches++;
      Object.assign(ticket, JSON.parse(String(options.body)));
      return json({ success: true });
    }
    return patches === 0 || confirmationAvailable ? json(ticket) : json({ error: 'Confirmation unavailable' }, 503);
  });
  showDetail(); await screen.findByRole('heading', { name: ticket.subject });
  const priority = screen.getByRole('combobox', { name: 'Priority' });
  priority.focus(); fireEvent.change(priority, { target: { value: 'high' } });
  await screen.findByRole('alert');
  expect(screen.getByText('Ticket details saved. Refresh the ticket before making another change.')).toHaveAttribute('role', 'status');
  expect(screen.getByRole('combobox', { name: 'Priority' })).toBe(priority);
  expect(priority).toHaveAttribute('aria-disabled', 'true');
  fireEvent.change(priority, { target: { value: 'urgent' } });
  expect(priority).toHaveValue('normal');
  expect(patches).toBe(1);
  confirmationAvailable = true;
  const retry = screen.getByRole('button', { name: 'Retry loading ticket' });
  retry.focus(); fireEvent.click(retry);
  await waitFor(() => {
    const refreshed = screen.getByRole('combobox', { name: 'Priority' });
    expect(refreshed).not.toBe(priority);
    expect(refreshed).toHaveValue('high');
    expect(refreshed).toHaveAttribute('aria-disabled', 'false');
    expect(refreshed).toHaveFocus();
  });
  expect(patches).toBe(1);
});

it('transitions a custom waiting state with its required private facts and retains input after a CAS conflict', async () => {
  const transition = { ticket_id: 'workflow-ticket', definition_id: 'awaiting-customer', lifecycle: 'pending', internal_label: 'Waiting on customer', public_label: 'We need your reply', waiting_reason: 'Awaiting account number', next_action: 'Follow up tomorrow', changed_at: '2026-09-11T00:00:00Z', revision: 4 };
  const definitions = [
    { id: 'awaiting-customer', legacy_status: 'pending', internal_label: 'Waiting on customer', public_label: 'We need your reply', waiting_reason_required: 1, next_action_required: 1, is_compatibility_default: 0, is_active: 1 },
    { id: 'legacy-open', legacy_status: 'open', internal_label: 'Open', public_label: 'Open', waiting_reason_required: 0, next_action_required: 0, is_compatibility_default: 1, is_active: 1 },
  ];
  let attempts = 0;
  let refreshed = false;
  transport((path, options) => {
    if (path === '/api/tickets/workflow-ticket/support-state') {
      if (options.method === 'PATCH') { attempts++; return attempts === 1 ? json({ error: 'State changed elsewhere' }, 409) : json({ ...transition, revision: 5 }); }
      return json(refreshed ? { ...transition, waiting_reason: 'Another operator changed this', next_action: 'Check inbox', revision: 5 } : transition);
    }
    return json(ticket);
  });
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
    if (new URL(url, 'http://localhost').pathname === '/api/support-states') return json(definitions);
    return original(url, options);
  }));
  showDetail(); await screen.findByRole('heading', { name: ticket.subject });
  fireEvent.click(screen.getByRole('button', { name: 'Manage support state' }));
  await screen.findByRole('combobox', { name: 'Support state' });
  expect(screen.getByText(/Customer-facing label: We need your reply/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Waiting reason'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save support state' }));
  expect(screen.getByRole('alert')).toHaveTextContent('waiting reason is required');
  fireEvent.change(screen.getByLabelText('Waiting reason'), { target: { value: 'Waiting for their account number' } });
  fireEvent.change(screen.getByLabelText('Next action'), { target: { value: 'Follow up tomorrow' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save support state' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('changed elsewhere');
  expect(screen.getByLabelText('Waiting reason')).toHaveValue('Waiting for their account number');
  expect(screen.getByLabelText('Next action')).toHaveValue('Follow up tomorrow');
  refreshed = true;
  fireEvent.click(screen.getByRole('button', { name: 'Refresh current support state' }));
  await screen.findByText('Current support state refreshed. Your local input is retained; review it before saving.');
  expect(screen.getByLabelText('Waiting reason')).toHaveValue('Waiting for their account number');
  expect(screen.getByLabelText('Next action')).toHaveValue('Follow up tomorrow');
  fireEvent.click(screen.getByRole('button', { name: 'Save support state' }));
  await screen.findByText('Support state saved.');
  const requests = vi.mocked(fetch).mock.calls.filter(([url, options]) => new URL(String(url), 'http://localhost').pathname.endsWith('/support-state') && options?.method === 'PATCH');
  expect(JSON.parse(String(requests[0]?.[1]?.body))).toMatchObject({ definitionId: 'awaiting-customer', expectedRevision: 4, waitingReason: 'Waiting for their account number', nextAction: 'Follow up tomorrow' });
  expect(JSON.parse(String(requests[1]?.[1]?.body))).toMatchObject({ expectedRevision: 5, waitingReason: 'Waiting for their account number', nextAction: 'Follow up tomorrow' });
});

it('discovers a later current support state, recovers its page load, and enforces its required facts', async () => {
  const current = { ticket_id: 'workflow-ticket', definition_id: 'late-waiting', lifecycle: 'pending', internal_label: 'Later queue', public_label: 'We need more information', waiting_reason: '', next_action: '', changed_at: '2026-09-11T00:00:00Z', revision: 4 };
  const firstPage = [{ id: 'legacy-open', legacy_status: 'open', internal_label: 'Open', public_label: 'Open', waiting_reason_required: 0, next_action_required: 0, is_compatibility_default: 1, is_active: 1 }];
  const laterPage = [{ id: 'late-waiting', legacy_status: 'pending', internal_label: 'Later queue', public_label: 'We need more information', waiting_reason_required: 1, next_action_required: 1, is_compatibility_default: 0, is_active: 1 }];
  let pageAttempts = 0;
  let saved: Record<string, unknown> | undefined;
  transport((path, options) => {
    if (path === '/api/tickets/workflow-ticket/support-state') {
      if (options.method === 'PATCH') { saved = JSON.parse(String(options.body)); return json({ ...current, waiting_reason: 'Need account number', next_action: 'Follow up tomorrow', revision: 5 }); }
      return json(current);
    }
    return json(ticket);
  });
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
    const request = new URL(url, 'http://localhost');
    if (request.pathname === '/api/support-states') {
      if (!request.searchParams.has('cursor')) return new Response(JSON.stringify(firstPage), { headers: { 'Content-Type': 'application/json', 'X-Next-Cursor': 'later-page' } });
      pageAttempts += 1;
      if (pageAttempts === 1) throw new Error('synthetic later-state failure');
      return json(laterPage);
    }
    return original(url, options);
  }));
  showDetail(); await screen.findByRole('heading', { name: ticket.subject });
  fireEvent.click(screen.getByRole('button', { name: 'Manage support state' }));
  const select = await screen.findByRole('combobox', { name: 'Support state' });
  expect(select).toHaveValue('late-waiting');
  expect(screen.getByRole('option', { name: 'Later queue (pending) — state details loading' })).toBeInTheDocument();
  expect(screen.getByText(/Customer-facing label: We need more information/)).toBeInTheDocument();
  expect(screen.getByLabelText('Waiting reason')).toHaveAttribute('aria-required', 'false');
  expect(screen.getByRole('button', { name: 'Save support state' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Load more support states' }));
  expect(await screen.findByText('Could not load more support states. Try again.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Load more support states' }));
  await waitFor(() => expect(screen.getByRole('option', { name: 'Later queue (pending)' })).toBeInTheDocument());
  expect(screen.getByLabelText('Waiting reason')).toHaveAttribute('aria-required', 'true');
  expect(screen.getByLabelText('Next action')).toHaveAttribute('aria-required', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Save support state' }));
  expect(screen.getByRole('alert')).toHaveTextContent('waiting reason is required');
  fireEvent.change(screen.getByLabelText('Waiting reason'), { target: { value: 'Need account number' } });
  fireEvent.change(screen.getByLabelText('Next action'), { target: { value: 'Follow up tomorrow' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save support state' }));
  await screen.findByText('Support state saved.');
  expect(saved).toMatchObject({ definitionId: 'late-waiting', expectedRevision: 4, waitingReason: 'Need account number', nextAction: 'Follow up tomorrow' });
});

it('uses a synchronous support-state flight guard to prevent duplicate delayed saves and locks fields while pending', async () => {
  const transition = { ticket_id: 'workflow-ticket', definition_id: 'awaiting-customer', lifecycle: 'pending', internal_label: 'Waiting on customer', public_label: 'We need your reply', waiting_reason: 'Awaiting account number', next_action: 'Follow up tomorrow', changed_at: '2026-09-11T00:00:00Z', revision: 4 };
  const definitions = [{ id: 'awaiting-customer', legacy_status: 'pending', internal_label: 'Waiting on customer', public_label: 'We need your reply', waiting_reason_required: 1, next_action_required: 1, is_compatibility_default: 0, is_active: 1 }];
  const delayed = deferred<Response>(); let writes = 0;
  transport((path, options) => {
    if (path === '/api/tickets/workflow-ticket/support-state') {
      if (options.method === 'PATCH') { writes++; return delayed.promise; }
      return json(transition);
    }
    return json(ticket);
  });
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => new URL(url, 'http://localhost').pathname === '/api/support-states' ? json(definitions) : original(url, options)));
  showDetail(); await screen.findByRole('heading', { name: ticket.subject });
  fireEvent.click(screen.getByRole('button', { name: 'Manage support state' }));
  await screen.findByRole('combobox', { name: 'Support state' });
  const waiting = screen.getByLabelText('Waiting reason');
  fireEvent.change(waiting, { target: { value: 'Awaiting a response' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save support state' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save support state' }));
  await waitFor(() => expect(writes).toBe(1));
  expect(waiting).toBeDisabled();
  expect(screen.getByRole('combobox', { name: 'Support state' })).toBeDisabled();
  await act(async () => delayed.resolve(json({ ...transition, waiting_reason: 'Awaiting a response', revision: 5 })));
  await screen.findByText('Support state saved.');
  expect(screen.getByLabelText('Waiting reason')).toHaveValue('Awaiting a response');
});

it('keeps explicit confirmation recovery available after a successful background refresh', async () => {
  let patches = 0;
  let confirmationAvailable = false;
  transport((_path, options) => {
    if (options.method === 'PATCH') {
      patches++;
      Object.assign(ticket, JSON.parse(String(options.body)));
      return json({ success: true });
    }
    return patches === 0 || confirmationAvailable ? json(ticket) : json({ error: 'Confirmation unavailable' }, 503);
  });
  showDetail(); await screen.findByRole('heading', { name: ticket.subject });
  const priority = screen.getByRole('combobox', { name: 'Priority' });
  fireEvent.change(priority, { target: { value: 'high' } });
  await screen.findByRole('alert');
  const retry = screen.getByRole('button', { name: 'Retry loading ticket' });
  retry.focus();
  confirmationAvailable = true;
  await act(() => client.invalidateQueries({ queryKey: ['ticket', 'workflow-ticket'] }));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Retry loading ticket' })).toBe(retry);
  expect(retry).toHaveFocus();
  expect(screen.getByRole('combobox', { name: 'Priority' })).toBe(priority);
  expect(priority).toHaveValue('high');
  expect(priority).toHaveAttribute('aria-disabled', 'true');
  fireEvent.change(priority, { target: { value: 'urgent' } });
  expect(priority).toHaveValue('high');
  expect(patches).toBe(1);
  fireEvent.click(retry);
  await waitFor(() => {
    const refreshed = screen.getByRole('combobox', { name: 'Priority' });
    expect(refreshed).not.toBe(priority);
    expect(refreshed).toHaveAttribute('aria-disabled', 'false');
    expect(refreshed).toHaveValue('high');
    expect(refreshed).toHaveFocus();
  });
  expect(screen.queryByRole('button', { name: 'Retry loading ticket' })).not.toBeInTheDocument();
  expect(screen.getByText('Ticket details saved.')).toHaveAttribute('role', 'status');
  expect(patches).toBe(1);
});

it('advertises and guards the separate confirmation read after mutation pending ends', async () => {
  let patches = 0;
  let postPatchReads = 0;
  const confirmation = deferred<Response>();
  transport((_path, options) => {
    if (options.method === 'PATCH') {
      patches++;
      Object.assign(ticket, JSON.parse(String(options.body)));
      return json({ success: true });
    }
    if (patches && ++postPatchReads > 1) return confirmation.promise;
    return json(ticket);
  });
  showDetail(); await screen.findByRole('heading', { name: ticket.subject });
  const priority = screen.getByRole('combobox', { name: 'Priority' });
  priority.focus(); fireEvent.change(priority, { target: { value: 'high' } });
  await waitFor(() => expect(postPatchReads).toBe(2));
  for (const select of screen.getAllByRole('combobox').filter(element => element.getAttribute('aria-label') !== 'Message format')) expect(select).toHaveAttribute('aria-disabled', 'true');
  expect(screen.getByRole('combobox', { name: 'Message format' })).not.toBeDisabled();
  expect(screen.getByRole('combobox', { name: 'Priority' })).toBe(priority);
  expect(priority).toHaveFocus();
  fireEvent.change(priority, { target: { value: 'urgent' } });
  expect(priority).toHaveValue('high');
  expect(patches).toBe(1);
  await act(async () => { confirmation.resolve(json(ticket)); });
  await waitFor(() => {
    const refreshed = screen.getByRole('combobox', { name: 'Priority' });
    expect(refreshed).not.toBe(priority);
    expect(refreshed).toHaveAttribute('aria-disabled', 'false');
    expect(refreshed).toHaveValue('high');
    expect(refreshed).toHaveFocus();
  });
  expect(patches).toBe(1);
});

it.each(['another control', 'document body'])('does not steal focus when the operator moves to %s during confirmation retry', async destination => {
  let patches = 0;
  let confirmationAvailable = false;
  const confirmationRead = deferred<Response>();
  let confirmationStarted!: () => void;
  const confirmationStartedPromise = new Promise<void>(resolve => { confirmationStarted = resolve; });
  transport((_path, options) => {
    if (options.method === 'PATCH') {
      patches++;
      Object.assign(ticket, JSON.parse(String(options.body)));
      return json({ success: true });
    }
    if (patches === 0) return json(ticket);
    if (!confirmationAvailable) return json({ error: 'Confirmation unavailable' }, 503);
    confirmationStarted();
    return confirmationRead.promise;
  });
  showDetail(); await screen.findByRole('heading', { name: ticket.subject });
  const priority = screen.getByRole('combobox', { name: 'Priority' });
  fireEvent.change(priority, { target: { value: 'high' } });
  await screen.findByRole('alert');
  confirmationAvailable = true;
  const retry = screen.getByRole('button', { name: 'Retry loading ticket' });
  retry.focus(); fireEvent.click(retry);
  await confirmationStartedPromise;
  const status = screen.getByRole('combobox', { name: 'Status' });
  if (destination === 'another control') status.focus();
  else retry.blur();
  const expectedFocus = destination === 'another control' ? status : document.body;
  expect(document.activeElement).toBe(expectedFocus);
  await act(async () => { confirmationRead.resolve(json(ticket)); });
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Priority' })).not.toBe(priority));
  expect(document.activeElement).toBe(expectedFocus);
  expect(patches).toBe(1);
});

it('preserves a rejected reply draft and recovers once, refreshing both detail and feed after commit',async()=>{
  let posts=0;const pending=deferred<Response>();
  client.setQueryData(['tickets',{}],{data:[]});
  transport((_path,options)=>{
    if(options.method==='POST'){
      posts++;
      if(posts===1)return pending.promise;
      const data=JSON.parse(String(options.body));
      ticket.articles.push({id:'staff-response',body:data.body,sender_type:'agent',is_internal:data.is_internal,created_at:'2026-09-09T00:01:00Z'});
      return json(ticket.articles.at(-1),201);
    }
    return json(ticket);
  });
  showDetail();await screen.findByText('Customer question');
  const composer=screen.getByRole('textbox',{name:'Reply message'});
  fireEvent.change(composer,{target:{value:'Synthetic public reply'}});
  screen.getByRole('button',{name:'Send Reply'}).focus();
  fireEvent.click(screen.getByRole('button',{name:'Send Reply'}));
  await waitFor(()=>expect(composer).toHaveAttribute('readonly'));
  expect(document.activeElement).toBe(screen.getByRole('button',{name:'Send Reply'}));
  fireEvent.change(composer,{target:{value:'Ignored pending edit'}});
  expect(composer).toHaveValue('Synthetic public reply');
  fireEvent.click(screen.getByRole('button',{name:'Internal Note'}));
  expect(screen.getByRole('button',{name:'Public Reply'})).toHaveAttribute('aria-pressed','true');
  fireEvent.submit(composer.closest('form')!);expect(posts).toBe(1);
  pending.resolve(json({error:'Reply temporarily unavailable'},503));
  expect(await screen.findByRole('alert')).toHaveTextContent('Reply temporarily unavailable');
  expect(composer).toHaveValue('Synthetic public reply');
  fireEvent.click(screen.getByRole('button',{name:'Send Reply'}));
  await screen.findByText('Synthetic public reply',{selector:'div'});
  expect(composer).toHaveValue('');
  expect(posts).toBe(2);
  expect(client.getQueryState(['tickets',{}])?.isInvalidated).toBe(true);
  expect(window.alert).not.toHaveBeenCalled();
});

it('does not expose or send mention fields when the route has not advertised durable mentions', async () => {
  const requests: RequestInit[] = [];
  transport((path, options) => {
    if (path === `/api/tickets/${ticket.id}/articles`) { requests.push(options); return json({ id: 'legacy-internal-note' }, 201); }
    return json(ticket);
  });
  showDetail(); await screen.findByText('Customer question');
  fireEvent.click(screen.getByRole('button', { name: 'Internal Note' }));
  expect(screen.queryByRole('group', { name: 'Mention colleagues' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: 'Reply message' }), { target: { value: 'Legacy private note' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add Note' }));
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(JSON.parse(String(requests[0].body))).not.toHaveProperty('mentioned_user_ids');
});

it('keeps a selected internal mention through recipient denial and retries the same acknowledged intent', async () => {
  const requests: RequestInit[] = []; let sends = 0;
  transport((path, options) => {
    if (path === `/api/tickets/${ticket.id}/articles`) {
      requests.push(options); sends++;
      return sends === 1 ? json({ error: 'Mention recipient access changed', code: 'mention_recipient_unavailable' }, 409) : json({ id: 'private-mention-note' }, 201);
    }
    return json(ticket);
  }, [], undefined, undefined, true);
  showDetail(); await screen.findByText('Customer question');
  fireEvent.click(screen.getByRole('button', { name: 'Internal Note' }));
  const mention = await screen.findByRole('checkbox', { name: 'Assigned agent' });
  mention.focus(); expect(mention).toHaveFocus(); fireEvent.click(mention);
  expect(mention).toBeChecked();
  fireEvent.change(screen.getByRole('textbox', { name: 'Reply message' }), { target: { value: 'Private handoff' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add Note' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('alert')).toHaveTextContent('Mention recipient access changed');
  expect(screen.queryByRole('button', { name: 'Rebase saved draft' })).not.toBeInTheDocument();
  expect(mention).toBeChecked();
  expect(screen.getByRole('textbox', { name: 'Reply message' })).toHaveValue('Private handoff');
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(JSON.parse(String(requests[0].body))).toMatchObject({ is_internal: true,
    mentioned_user_ids: ['22222222-2222-4222-8222-222222222222'] });

  fireEvent.click(screen.getByRole('button', { name: 'Add Note' }));
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(new Headers(requests[1].headers).get('Idempotency-Key')).toBe(new Headers(requests[0].headers).get('Idempotency-Key'));
});

it('refreshes the conversation and feed for the server article.created payload',async()=>{
  let reads=0;client.setQueryData(['tickets',{}],{data:[]});
  transport(()=>{reads++;return json(ticket);});
  showDetail();await screen.findByText('Customer question');const before=reads;
  ticket.articles.push({id:'remote-response',body:'New response from another operator',sender_type:'agent',is_internal:false,created_at:'2026-09-09T00:01:00Z'});
  act(()=>Socket.latest.emit({type:'article.created',payload:{ticket_id:ticket.id,article_id:'remote-response'}}));
  await screen.findByText('New response from another operator');
  expect(reads).toBeGreaterThan(before);
  expect(client.getQueryState(['tickets',{}])?.isInvalidated).toBe(true);
});

it('does not restore an attachment removed while its upload is pending', async () => {
  const upload = deferred<Response>();
  transport(path => path === '/api/attachments/upload' ? upload.promise : json(ticket));
  showDetail(); await screen.findByText('Customer question');
  fireEvent.change(screen.getByLabelText('Reply attachments'), { target: { files: [new File(['a'], 'removed.txt', { type: 'text/plain' })] } });
  fireEvent.click(screen.getByRole('button', { name: 'Remove removed.txt' }));
  await act(async () => { upload.resolve(json({ key: 'synthetic/removed' })); });
  expect(screen.queryByText('removed.txt')).not.toBeInTheDocument();
});

it('uploads dropped and pasted images through the existing authenticated attachment path', async () => {
  const uploaded: File[] = [];
  transport((path, options) => {
    if (path === '/api/attachments/upload') {
      uploaded.push((options.body as FormData).get('file') as File);
      return json({ key: `synthetic/${uploaded.at(-1)?.name}` });
    }
    return json(ticket);
  });
  showDetail(); await screen.findByText('Customer question');
  const composer = screen.getByLabelText('Rich message composer');
  const dropped = new File(['png'], 'dropped.png', { type: 'image/png' });
  const pasted = new File(['webp'], 'pasted.webp', { type: 'image/webp' });
  fireEvent.drop(composer, { dataTransfer: { files: [dropped] } });
  fireEvent.paste(composer, { clipboardData: { files: [pasted] } });
  await waitFor(() => expect(uploaded).toEqual([dropped, pasted]));
  expect(screen.getByRole('button', { name: 'Remove dropped.png' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Remove pasted.webp' })).toBeInTheDocument();
});

it('promotes a completed upload in one committed attachment row and keeps it after draft save', async () => {
  const upload = deferred<Response>();
  const commits: Array<{ filename: number; remove: number }> = [];
  transport(path => path === '/api/attachments/upload' ? upload.promise : json(ticket));
  showDetail(() => {
    const filename = Array.from(document.querySelectorAll('span')).filter(element => element.textContent === 'promote.txt').length;
    const remove = document.querySelectorAll('button[aria-label="Remove promote.txt"]').length;
    commits.push({ filename, remove });
  });
  await screen.findByText('Customer question');
  fireEvent.change(screen.getByLabelText('Reply attachments'), { target: { files: [new File(['a'], 'promote.txt', { type: 'text/plain' })] } });
  expect(await screen.findByText('Uploading…')).toBeInTheDocument();
  await act(async () => { upload.resolve(json({ key: 'synthetic/promote' })); });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Remove promote.txt' })).toBeInTheDocument());
  await screen.findByText('Draft saved.');
  expect(screen.getByRole('button', { name: 'Remove promote.txt' })).toBeInTheDocument();
  expect(commits.every(commit => commit.filename <= 1 && commit.remove <= 1)).toBe(true);
});

it('retains a failed dropped image and retries it without changing the draft attachment path', async () => {
  let attempts = 0;
  transport((path) => {
    if (path === '/api/attachments/upload') {
      attempts++;
      return attempts === 1 ? json({ error: 'Image upload unavailable' }, 503) : json({ key: 'synthetic/retried-image' });
    }
    return json(ticket);
  });
  showDetail(); await screen.findByText('Customer question');
  fireEvent.drop(screen.getByLabelText('Rich message composer'), { dataTransfer: { files: [new File(['png'], 'retry.png', { type: 'image/png' })] } });
  expect(await screen.findByText('Upload failed.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry upload' }));
  await waitFor(() => expect(attempts).toBe(2));
  expect(screen.getByRole('button', { name: 'Remove retry.png' })).toBeInTheDocument();
});

it('preserves both attachments when two uploads complete in the same turn', async () => {
  const first = deferred<Response>(); const second = deferred<Response>(); let count = 0;
  transport(path => path === '/api/attachments/upload' ? (++count === 1 ? first.promise : second.promise) : json(ticket));
  showDetail(); await screen.findByText('Customer question');
  fireEvent.change(screen.getByLabelText('Reply attachments'), { target: { files: [new File(['a'], 'one.txt', { type: 'text/plain' }), new File(['b'], 'two.txt', { type: 'text/plain' })] } });
  await act(async () => { first.resolve(json({ key: 'synthetic/one' })); second.resolve(json({ key: 'synthetic/two' })); });
  expect(screen.queryByText('Uploading…')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Remove one.txt' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Remove two.txt' })).toBeInTheDocument();
});

it('retries acknowledged-send cleanup without sending the article again', async () => {
  let posts=0; let deletes=0;
  transport((_path, options) => {
    if(options.method==='POST') { posts++; return json({id:'confirmed-article'},201); }
    return json(ticket);
  }, [], options => options.method==='DELETE' && ++deletes===1 ? json({error:'Cleanup unavailable'},503) : undefined);
  showDetail(); await screen.findByText('Customer question');
  fireEvent.change(screen.getByRole('textbox',{name:'Reply message'}),{target:{value:'Only send once'}});
  fireEvent.click(screen.getByRole('button',{name:'Send Reply'}));
  const retry=await screen.findByRole('button',{name:'Retry sent-draft cleanup'});
  await waitFor(()=>expect(retry).toHaveAttribute('aria-disabled','false'));
  fireEvent.click(screen.getByRole('button',{name:'Send Reply'}));
  expect(posts).toBe(1);
  fireEvent.click(retry);
  await waitFor(()=>expect(screen.queryByRole('button',{name:'Retry sent-draft cleanup'})).not.toBeInTheDocument());
  expect(posts).toBe(1); expect(deletes).toBe(2);
  expect(screen.getByRole('textbox',{name:'Reply message'})).toHaveValue('');
});


it('retains uploaded attachments after a rejected internal note and reuses them on explicit retry',async()=>{
  let uploads=0;const posts:Record<string,unknown>[]=[];
  transport((path,options)=>{
    if(path==='/api/attachments/upload'){uploads++;return json({key:'synthetic/scoped-upload'});}
    if(options.method==='POST'){
      const body=JSON.parse(String(options.body));posts.push(body);
      if(posts.length===1)return json({error:'Note temporarily unavailable'},503);
      ticket.articles.push({id:'internal-response',body:body.body,sender_type:'agent',is_internal:body.is_internal,created_at:'2026-09-09T00:01:00Z'});
      return json(ticket.articles.at(-1),201);
    }
    return json(ticket);
  });
  showDetail();await screen.findByText('Customer question');
  fireEvent.click(screen.getByRole('button',{name:'Internal Note'}));
  expect(screen.getByRole('button',{name:'Internal Note'})).toHaveAttribute('aria-pressed','true');
  fireEvent.change(screen.getByLabelText('Reply attachments'),{target:{files:[new File(['synthetic attachment'],'note.txt',{type:'text/plain'})]}});
  await waitFor(()=>expect(screen.queryByText('Uploading…')).not.toBeInTheDocument());
  expect(screen.getByRole('button',{name:'Add Note'})).toHaveAttribute('aria-disabled','true');
  fireEvent.change(screen.getByRole('textbox',{name:'Reply message'}),{target:{value:'Synthetic private note'}});
  fireEvent.click(screen.getByRole('button',{name:'Add Note'}));
  await screen.findByRole('alert');
  expect(screen.getByText('note.txt')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Add Note'}));
  await screen.findByText('Synthetic private note',{selector:'div'});
  expect(uploads).toBe(1);expect(posts).toHaveLength(2);
  expect(posts[0]).toEqual(posts[1]);expect(posts[1].is_internal).toBe(true);
  expect(posts[1].attachments).toEqual([{filename:'note.txt',contentType:'text/plain',size:20,storageKey:'synthetic/scoped-upload'}]);
  expect(screen.queryByRole('button',{name:'Remove note.txt'})).not.toBeInTheDocument();
});

it('retains confirmed conversation content when a refresh fails and explicitly recovers',async()=>{
  let failed=false;transport(()=>failed?json({error:'Refresh unavailable'},503):json(ticket));
  showDetail();await screen.findByText('Customer question');
  failed=true;await act(()=>client.invalidateQueries({queryKey:['ticket','workflow-ticket']}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Showing the last confirmed details');
  expect(screen.getByText('Customer question')).toBeInTheDocument();
  failed=false;fireEvent.click(screen.getByRole('button',{name:'Retry loading ticket'}));
  await waitFor(()=>expect(screen.queryByRole('alert')).not.toBeInTheDocument());
});


it('waits for all pending attachment outcomes before unlocking a partial-failure retry',async()=>{
  const sibling=deferred<Response>();let uploads=0;let posts=0;
  transport((path,options)=>{
    if(path==='/api/attachments/upload'){
      uploads++;if(uploads===1)return json({error:'First upload rejected'},503);
      if(uploads===2)return sibling.promise;
      return json({key:'synthetic/retry-first'});
    }
    if(options.method==='POST'){posts++;return json({id:'note'},201);}
    return json(ticket);
  });
  showDetail();await screen.findByText('Customer question');
  fireEvent.change(screen.getByLabelText('Reply attachments'),{target:{files:[new File(['a'], 'a.txt', { type: 'text/plain' }),new File(['b'], 'b.txt', { type: 'text/plain' })]}});
  fireEvent.change(screen.getByRole('textbox',{name:'Reply message'}),{target:{value:'Partial attachment retry'}});
  const send=screen.getByRole('button',{name:'Send Reply'});send.focus();fireEvent.click(send);
  await waitFor(()=>expect(uploads).toBe(2));
  expect(screen.getByText('Upload failed.')).toBeInTheDocument();
  expect(send).toHaveAttribute('aria-disabled','true');expect(document.activeElement).toBe(send);
  fireEvent.click(send);expect(uploads).toBe(2);
  sibling.resolve(json({key:'synthetic/sibling'}));await screen.findByText('Upload failed.');
  fireEvent.click(send);await waitFor(()=>expect(uploads).toBe(3));
  await waitFor(()=>expect(screen.queryByText('Uploading…')).not.toBeInTheDocument());
  fireEvent.click(send);await waitFor(()=>expect(posts).toBe(1));
});

it('replaces a pre-commit read when event and mutation invalidations overlap',async()=>{
  const stale=deferred<Response>();let hold=false;let reads=0;
  transport((_path,options)=>{
    if(options.method==='PATCH'){
      Object.assign(ticket,JSON.parse(String(options.body)));
      Socket.latest.emit({type:'ticket.updated',payload:{id:ticket.id}});
      return json({success:true});
    }
    reads++;if(hold){hold=false;return stale.promise;}return json(ticket);
  });
  showDetail();await screen.findByText('Customer question');
  const old=structuredClone(ticket);hold=true;
  let oldRequest:Promise<void>;
  act(()=>{oldRequest=client.invalidateQueries({queryKey:['ticket','workflow-ticket']});});
  await waitFor(()=>expect(reads).toBe(2));
  ticket.articles.push({id:'live-message',body:'Post-event authoritative message',sender_type:'agent',is_internal:false,created_at:'2026-09-09T00:01:00Z'});
  act(()=>Socket.latest.emit({type:'article.created',payload:{ticket_id:ticket.id}}));
  fireEvent.change(screen.getByRole('combobox',{name:'Status'}),{target:{value:'resolved'}});
  await waitFor(()=>expect(screen.getByRole('combobox',{name:'Status'})).toHaveValue('resolved'));
  await screen.findByText('Post-event authoritative message');
  await act(async()=>{stale.resolve(json(old));await oldRequest!;});
  expect(screen.getByRole('combobox',{name:'Status'})).toHaveValue('resolved');
  expect(screen.getByText('Post-event authoritative message')).toBeInTheDocument();
  expect(reads).toBeGreaterThan(2);
});


it('associates every retained custom field label with its native control', async () => {
  const fields = ['text','textarea','select','checkbox'].map((field_type, i) => ({id:`field-${i}`,name:`field_${i}`,label:`Custom ${field_type}`,field_type,options:field_type==='select'?'One,Two':null,is_active:true}));
  transport(() => json(ticket), fields);
  showDetail();
  for (const field of fields) {
    const input = await screen.findByLabelText(field.label);
    expect(input).toHaveAccessibleName(field.label);
    expect(input.id).toBeTruthy();
  }
  expect(screen.getByRole('combobox',{name:'Custom select'})).toBeVisible();
  expect(screen.getByRole('checkbox',{name:'Custom checkbox'})).toBeVisible();
});


it('bounds two same-turn image drops to ten admitted uploads', async () => {
  let uploads = 0;
  const held = deferred<Response>();
  transport(path => {
    if (path === '/api/attachments/upload') { uploads++; return held.promise; }
    return json(ticket);
  });
  showDetail();
  await screen.findByText('Customer question');
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Reply message' })).not.toHaveAttribute('readonly'));
  const composer = screen.getByRole('region', { name: 'Rich message composer' });
  const files = Array.from({ length: 8 }, (_, index) => new File(['synthetic'], `image-${index}.png`, { type: 'image/png' }));
  act(() => {
    fireEvent.drop(composer, { dataTransfer: { files } });
    fireEvent.drop(composer, { dataTransfer: { files } });
  });
  await waitFor(() => expect(uploads).toBe(10));
  expect(screen.getAllByRole('button', { name: /^Remove image-/ })).toHaveLength(10);
});


it('renders only explicitly versioned articles as Markdown and preserves legacy literal text', async () => {
  const data = { ...ticket, articles: [
    { ...ticket.articles[0], id: 'legacy', body: '**legacy literal**' },
    { ...ticket.articles[0], id: 'versioned', body: '**formatted reply**', body_format: 'markdown-v1' },
  ] };
  transport(() => json(data)); showDetail();
  expect(await screen.findByText('**legacy literal**')).not.toHaveProperty('tagName', 'STRONG');
  expect(await screen.findByText('formatted reply')).toHaveProperty('tagName', 'STRONG');
});

it('retains the draft and prevents send until reply-capability failure is recovered', async () => {
  let posts = 0;
  transport((_path, options) => { if (options.method === 'POST') posts++; return json(ticket); });
  const original = vi.mocked(fetch).getMockImplementation()!;
  let unavailable = true;
  vi.mocked(fetch).mockImplementation((input, options) => String(input).endsWith('/reply-capability') && unavailable
    ? Promise.resolve(json({ error: 'Unavailable' }, 503)) : original(input, options));
  showDetail(); await screen.findByText('Customer question');
  const retry = await screen.findByRole('button', { name: 'Retry reply options' });
  fireEvent.change(screen.getByRole('textbox', { name: 'Reply message' }), { target: { value: 'Retained while options unavailable' } });
  const send = screen.getByRole('button', { name: 'Send Reply' });
  expect(send).toHaveAttribute('aria-disabled', 'true'); fireEvent.click(send);
  expect(posts).toBe(0);
  unavailable = false; fireEvent.click(retry);
  await waitFor(() => expect(send).toHaveAttribute('aria-disabled', 'false'));
  expect(screen.getByRole('textbox', { name: 'Reply message' })).toHaveValue('Retained while options unavailable');
});


it('sends an acknowledged collision-safe draft with one stable idempotency key', async () => {
  const requests: RequestInit[] = [];
  transport((path, options) => {
    if (path === `/api/tickets/${ticket.id}/articles`) { requests.push(options); return json({ id: 'collision-reply' }); }
    return json(ticket);
  }, [], undefined, undefined, true);
  showDetail(); await screen.findByRole('heading', { name: ticket.subject });
  fireEvent.change(screen.getByRole('textbox', { name: 'Reply message' }), { target: { value: 'Acknowledged collision-safe reply' } });
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url, init]) => String(url).endsWith('/workspace/drafts/workflow-ticket') && init?.method === 'PUT')).toBe(true));
  fireEvent.click(screen.getByRole('button', { name: /send reply/i }));
  await waitFor(() => expect(requests).toHaveLength(1));
  const body = JSON.parse(String(requests[0].body));
  expect(body.draft).toMatchObject({ generation: '99999999-9999-4999-8999-999999999999', revision: 1, baseConversationRevision: 0 });
  expect(new Headers(requests[0].headers).get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
});

it('requires manually loading the bounded newest conversation page before a stale draft can be rebased', async () => {
  let conversationRevision = 0;
  let materialAvailable = false;
  let sendAttempts = 0;
  let cursorReads = 0;
  const rebaseRequests: unknown[] = [];
  const olderPage = { ...ticket, pagination: { limit: 1, next_cursor: 'page-2', has_more: true } };
  const newestPage = { ...ticket, articles: [{
    id: 'newest-customer-material', body: 'Newest customer material', sender_type: 'customer', is_internal: false, created_at: '2026-09-10T00:00:00Z',
  }], pagination: { limit: 1, next_cursor: null, has_more: false } };
  transport((path, options, url) => {
    if (path === `/api/tickets/${ticket.id}/articles`) {
      sendAttempts++;
      if (sendAttempts === 1) { materialAvailable = true; conversationRevision = 1; return json({ code: 'staff_reply_stale', error: 'stale' }, 409); }
      return json({ id: 'manual-reviewed-send' });
    }
    if (path === `/api/tickets/${ticket.id}`) {
      if (url.includes('article_cursor=page-2')) { cursorReads++; return json(newestPage); }
      return json(materialAvailable ? olderPage : ticket);
    }
    return json(ticket);
  }, [], options => {
    if (!options.body) return undefined;
    const body = JSON.parse(String(options.body));
    if ('expectedReviewedConversationRevision' in body) {
      rebaseRequests.push(body);
      return json({ ticketId: ticket.id, generation: '99999999-9999-4999-8999-999999999999', revision: 2,
        mode: 'public', body: 'Retain paginated draft', bodyFormat: 'plain', attachments: [], baseConversationRevision: 1, expiresAt: null, updatedAt: '2026-09-10T00:00:00Z' });
    }
    return json({ ticketId: ticket.id, generation: '99999999-9999-4999-8999-999999999999', revision: 1,
      mode: body.mode, body: body.body, bodyFormat: body.bodyFormat, attachments: body.attachments, baseConversationRevision: 0, expiresAt: null, updatedAt: '2026-09-10T00:00:00Z' });
  }, undefined, () => conversationRevision);
  showDetail(); await screen.findByText('Customer question');
  const message = screen.getByRole('textbox', { name: 'Reply message' });
  fireEvent.change(message, { target: { value: 'Retain paginated draft' } });
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url, init]) => String(url).endsWith('/workspace/drafts/workflow-ticket') && init?.method === 'PUT')).toBe(true));
  fireEvent.click(screen.getByRole('button', { name: 'Send Reply' }));
  await screen.findByText(/Review and rebase before sending/);

  fireEvent.click(screen.getByRole('button', { name: 'Refresh and review conversation' }));
  await screen.findByText(/More messages are available\. Load them/i);
  expect(screen.queryByRole('button', { name: 'Rebase saved draft' })).not.toBeInTheDocument();
  expect(rebaseRequests).toHaveLength(0);
  expect(message).toHaveValue('Retain paginated draft');

  fireEvent.click(screen.getByRole('button', { name: 'Load more messages' }));
  await screen.findByText('Newest customer material');
  expect(cursorReads).toBe(1);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh and review conversation' }));
  await screen.findByRole('button', { name: 'Rebase saved draft' });
  fireEvent.click(screen.getByRole('button', { name: 'Rebase saved draft' }));
  await screen.findByText(/Draft rebased to the reviewed conversation/);
  expect(rebaseRequests).toEqual([expect.objectContaining({ expectedReviewedConversationRevision: 1, expectedRevision: 1 })]);
  expect(message).toHaveValue('Retain paginated draft');
});

it('requires a rendered conversation review and explicit CAS rebase after a stale reply before manual resend', async () => {
  let conversationRevision = 0;
  let injectMaterialBetweenTicketAndRevisionRead = false;
  let sendAttempts = 0;
  const replyRequests: RequestInit[] = [];
  const material = { ...ticket, articles: [...ticket.articles, {
    id: 'new-customer-material', body: 'A newer customer reply', sender_type: 'customer', is_internal: false, created_at: '2026-09-10T00:00:00Z',
  }] };
  transport((path, options) => {
    if (path === `/api/tickets/${ticket.id}/articles`) {
      replyRequests.push(options);
      sendAttempts++;
      return sendAttempts === 1 ? json({ code: 'staff_reply_stale', error: 'stale' }, 409) : json({ id: 'manual-reviewed-send' });
    }
    if (path === `/api/tickets/${ticket.id}`) {
      if (injectMaterialBetweenTicketAndRevisionRead) {
        injectMaterialBetweenTicketAndRevisionRead = false;
        conversationRevision = 1;
        return json(ticket);
      }
      return json(conversationRevision === 1 ? material : ticket);
    }
    return json(ticket);
  }, [], options => {
    if (!options.body) return undefined;
    const body = JSON.parse(String(options.body));
    if ('expectedReviewedConversationRevision' in body) {
      expect(body).toMatchObject({ expectedReviewedConversationRevision: 1, expectedRevision: 1 });
      return json({ ticketId: ticket.id, generation: '99999999-9999-4999-8999-999999999999', revision: 2,
        mode: 'public', body: 'Keep this draft through review', bodyFormat: 'plain', attachments: [], baseConversationRevision: 1, expiresAt: null, updatedAt: '2026-09-10T00:00:00Z' });
    }
    return json({ ticketId: ticket.id, generation: '99999999-9999-4999-8999-999999999999', revision: 1,
      mode: body.mode, body: body.body, bodyFormat: body.bodyFormat, attachments: body.attachments, baseConversationRevision: 0, expiresAt: null, updatedAt: '2026-09-10T00:00:00Z' });
  }, undefined, () => conversationRevision);
  showDetail(); await screen.findByText('Customer question');
  const message = screen.getByRole('textbox', { name: 'Reply message' });
  fireEvent.change(message, { target: { value: 'Keep this draft through review' } });
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url, init]) => String(url).endsWith('/workspace/drafts/workflow-ticket') && init?.method === 'PUT')).toBe(true));
  fireEvent.click(screen.getByRole('button', { name: 'Send Reply' }));
  await screen.findByText(/Review and rebase before sending/);
  expect(message).toHaveValue('Keep this draft through review');
  expect(screen.getByRole('button', { name: 'Send Reply' })).toHaveAttribute('aria-disabled', 'true');

  injectMaterialBetweenTicketAndRevisionRead = true;
  fireEvent.click(screen.getByRole('button', { name: 'Refresh and review conversation' }));
  await screen.findByText(/conversation changed while it was being refreshed/i);
  expect(screen.queryByText('A newer customer reply')).not.toBeInTheDocument();
  expect(message).toHaveValue('Keep this draft through review');

  fireEvent.click(screen.getByRole('button', { name: 'Refresh and review conversation' }));
  await screen.findByText('A newer customer reply');
  await screen.findByRole('button', { name: 'Rebase saved draft' });
  expect(message).toHaveValue('Keep this draft through review');
  fireEvent.click(screen.getByRole('button', { name: 'Rebase saved draft' }));
  await screen.findByText(/Draft rebased to the reviewed conversation/);
  expect(message).toHaveValue('Keep this draft through review');

  fireEvent.click(screen.getByRole('button', { name: 'Send Reply' }));
  await waitFor(() => expect(replyRequests).toHaveLength(2));
  expect(JSON.parse(String(replyRequests[1].body)).draft).toMatchObject({ revision: 2, baseConversationRevision: 1 });
});
