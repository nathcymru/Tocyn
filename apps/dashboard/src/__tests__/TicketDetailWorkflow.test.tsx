import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TicketDetailPage } from '../pages/TicketDetailPage';
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
function initialTicket(){return{id:'workflow-ticket',subject:'Operator workflow ticket',customer_email:'customer@example.invalid',ticket_no:62,status:'open',priority:'normal',assigned_to:'assigned-agent' as string|null,group_id:'assigned-group' as string|null,created_at:'2026-09-09T00:00:00Z',articles:[{id:'initial-message',body:'Customer question',sender_type:'customer',is_internal:false,created_at:'2026-09-09T00:00:00Z'}],pagination:{limit:20,next_cursor:null,has_more:false}};}
function transport(handle:(path:string,options:RequestInit)=>Response|Promise<Response>, fields: unknown[] = []) {
  vi.stubGlobal('fetch',vi.fn(async (url:string,options:RequestInit)=>{
    const path=new URL(url,'http://localhost').pathname;
    if(path.startsWith('/api/tickets/')||path==='/api/attachments/upload')return handle(path,options);
    if(path==='/api/groups')return json([{id:'assigned-group',name:'Assigned group'}]);
    if(path==='/api/users/agents')return json([{id:'assigned-agent',full_name:'Assigned agent'}]);
    if(path==='/api/settings')return json({});
    if(path==='/api/ticket-fields')return json(fields);
    return json([]);
  }));
}
function showDetail(){render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/tickets/workflow-ticket']}><Routes><Route path="/tickets/:id" element={<TicketDetailPage/>}/></Routes></MemoryRouter></QueryClientProvider>);}
beforeEach(()=>{
  client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
  ticket=initialTicket();vi.stubGlobal('WebSocket',Socket);vi.stubGlobal('alert',vi.fn());
  useAuthStore.getState().setAuth('synthetic-operator-session',{id:'operator',email:'operator@example.invalid',full_name:'Operator',role:'admin',mfa_enabled:true});
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
  expect(vi.mocked(fetch).mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
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
  for (const select of screen.getAllByRole('combobox')) expect(select).toHaveAttribute('aria-disabled', 'true');
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
  fireEvent.change(screen.getByLabelText('Reply attachments'),{target:{files:[new File(['a'],'a.txt'),new File(['b'],'b.txt')]}});
  fireEvent.change(screen.getByRole('textbox',{name:'Reply message'}),{target:{value:'Partial attachment retry'}});
  const send=screen.getByRole('button',{name:'Send Reply'});send.focus();fireEvent.click(send);
  await waitFor(()=>expect(uploads).toBe(2));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(send).toHaveAttribute('aria-disabled','true');expect(document.activeElement).toBe(send);
  fireEvent.click(send);expect(uploads).toBe(2);
  sibling.resolve(json({key:'synthetic/sibling'}));await screen.findByRole('alert');
  fireEvent.click(send);await waitFor(()=>expect(posts).toBe(1));expect(uploads).toBe(3);
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
