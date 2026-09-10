import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TicketListPage } from '../pages/TicketListPage';
import { useAuthStore } from '../store/authStore';

let client:QueryClient;
const ticket = {id:'synthetic-ticket',subject:'API intake awaiting operator',customer_email:'customer@example.invalid',status:'open',priority:'normal',ticket_no:1,created_at:'2026-09-09T00:00:00Z',updated_at:'2026-09-09T00:00:00Z'};
const json = (body:unknown,status=200) => new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const page = () => json({data:[ticket],meta:{page:1,limit:20,total:1,total_pages:1}});
function transport(tickets:(options:RequestInit)=>Response|Promise<Response>) {
  vi.stubGlobal('fetch',vi.fn((url:string,options:RequestInit) => {
    if (url.startsWith('/api/tickets')) return Promise.resolve(tickets(options));
    if (url === '/api/settings') return Promise.resolve(json({TICKET_PREFIX:'#'}));
    return Promise.resolve(json([]));
  }));
}
function showFeed() {
  render(<QueryClientProvider client={client}><MemoryRouter><TicketListPage/></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  // JSDOM has no layout; browser focus containment remains a separate gate.
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function(this: HTMLElement) {
    return (this.isConnected && !this.closest('[hidden]') && this.getAttribute('type') !== 'hidden'
      ? [new DOMRect(0,0,100,30)] : []) as unknown as DOMRectList;
  });
  client = new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
  useAuthStore.getState().setAuth('synthetic-session',{id:'operator',email:'operator@example.invalid',full_name:'Operator',role:'admin',mfa_enabled:true});
});
afterEach(() => {cleanup();client.clear();useAuthStore.getState().logout();localStorage.clear();vi.restoreAllMocks();vi.unstubAllGlobals();});

it('distinguishes a failed feed from an empty feed and lets the operator retry', async () => {
  let fails=true;
  transport(() => fails ? json({error:'Temporarily unavailable'},503) : page());
  showFeed();
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load tickets');
  expect(screen.queryByText('No tickets found.')).not.toBeInTheDocument();
  fails=false;fireEvent.click(screen.getByRole('button',{name:'Retry loading tickets'}));
  await screen.findByRole('link',{name:ticket.subject});
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('textbox',{name:'Search tickets'})).toBeInTheDocument();
});

it('keeps confirmed feed data visible with a clear warning when a refresh fails', async () => {
  let fails=false;transport(() => fails ? json({error:'Temporary failure'},503) : page());
  showFeed();await screen.findByRole('link',{name:ticket.subject});
  fails=true;await act(async () => {await client.invalidateQueries({queryKey:['tickets']});});
  expect(await screen.findByRole('alert')).toHaveTextContent('Showing the last loaded results');
  expect(screen.getByRole('link',{name:ticket.subject})).toBeInTheDocument();
});

it('preserves the creation draft on rejection and displays successful recovery in the feed', async () => {
  let posts=0;let created=false;
  transport(options => {
    if (options.method === 'POST') {
      posts++;
      expect(JSON.parse(options.body as string)).toMatchObject({subject:'Operator-created follow-up',customer_email:'customer@example.invalid',body:'Synthetic operator message'});
      if (posts === 1) return json({error:'Creation is temporarily unavailable'},503);
      created=true;return json({...ticket,subject:'Operator-created follow-up'},201);
    }
    return created ? json({data:[{...ticket,subject:'Operator-created follow-up'}],meta:{page:1,limit:20,total:1,total_pages:1}}) : json({data:[],meta:{page:1,limit:20,total:0,total_pages:1}});
  });
  showFeed();await screen.findByText('No tickets found.');
  fireEvent.click(screen.getByRole('button',{name:'New Ticket'}));
  const draftSubject = await screen.findByRole('textbox',{name:'Subject'});
  await waitFor(() => expect(draftSubject).toHaveFocus());
  fireEvent.change(draftSubject,{target:{value:'Operator-created follow-up'}});
  fireEvent.change(screen.getByRole('textbox',{name:'Customer Email'}),{target:{value:'customer@example.invalid'}});
  fireEvent.change(screen.getByRole('textbox',{name:'Initial Message'}),{target:{value:'Synthetic operator message'}});
  fireEvent.click(screen.getByRole('button',{name:'Create Ticket'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Creation is temporarily unavailable');
  expect(screen.getByRole('textbox',{name:'Initial Message'})).toHaveValue('Synthetic operator message');
  fireEvent.click(screen.getByRole('button',{name:'Create Ticket'}));
  await screen.findByRole('link',{name:'Operator-created follow-up'});
  await waitFor(() => expect(screen.queryByRole('textbox',{name:'Initial Message'})).not.toBeInTheDocument());
  expect(posts).toBe(2);
});

it('names the shared create dialog, focuses its first field, and returns focus on cancellation', async () => {
  transport(()=>page());showFeed();await screen.findByRole('link',{name:ticket.subject});
  const trigger=screen.getByRole('button',{name:'New Ticket'});
  trigger.focus();fireEvent.click(trigger);
  await screen.findByRole('dialog',{name:'Create New Ticket'});
  await waitFor(() => expect(screen.getByRole('textbox',{name:'Subject'})).toHaveFocus());
  fireEvent.keyDown(document.activeElement!, {key:'Escape',code:'Escape'});
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(() => expect(trigger).toHaveFocus());
});

it('uses the requested page, search, and saved filter when loading the feed', async () => {
  const queries:URLSearchParams[]=[];
  vi.stubGlobal('fetch',vi.fn(async (url:string) => {
    if(url.startsWith('/api/tickets?')) {
      const query=new URL(url,'http://localhost').searchParams;queries.push(query);
      const current=Number(query.get('page'));
      return json({data:[{...ticket,subject:`Result page ${current}`}],meta:{page:current,limit:1,total:2,total_pages:2}});
    }
    if(url==='/api/settings/filters') return json([{id:'open-filter',name:'Awaiting response'}]);
    return json(url==='/api/settings'?{}:[]);
  }));
  showFeed();await screen.findByRole('link',{name:'Result page 1'});
  fireEvent.click(screen.getByRole('button',{name:'Next'}));
  await screen.findByRole('link',{name:'Result page 2'});
  expect(queries.at(-1)?.get('page')).toBe('2');
  const search=screen.getByRole('textbox',{name:'Search tickets'});
  fireEvent.change(search,{target:{value:'API intake'}});fireEvent.keyDown(search,{key:'Enter'});
  await waitFor(()=>expect(queries.at(-1)?.get('search')).toBe('API intake'));
  expect(queries.at(-1)?.get('page')).toBe('1');
  fireEvent.click(screen.getByRole('button',{name:'Awaiting response'}));
  await waitFor(()=>expect(queries.at(-1)?.get('filter_id')).toBe('open-filter'));
  expect(queries.at(-1)?.get('page')).toBe('1');
  expect(queries.at(-1)?.get('search')).toBe('API intake');
});

it.each([null,62])('displays and copies the actual ticket reference when the number is %s',async number=>{
  const writeText=vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator',Object.create(navigator,{clipboard:{value:{writeText}}}));
  transport(()=>json({data:[{...ticket,ticket_no:number}],meta:{page:1,limit:20,total:1,total_pages:1}}));
  showFeed();await screen.findByRole('link',{name:ticket.subject});
  const reference=number===null?ticket.id:'#62';
  expect(screen.getByText(reference)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Copy ticket reference'}));
  expect(writeText).toHaveBeenCalledWith(reference);
});

it('retains focus while retrying a failed feed and moves it to recovered results', async () => {
  let finish!: (response: Response) => void;
  let reads = 0;
  transport(() => ++reads === 1 ? json({ error: 'Unavailable' }, 503) : new Promise(resolve => { finish = resolve; }));
  showFeed();
  const retry = await screen.findByRole('button', { name: 'Retry loading tickets' });
  retry.focus(); fireEvent.click(retry);
  await waitFor(() => expect(retry).toHaveAttribute('aria-disabled', 'true'));
  expect(retry).not.toBeDisabled(); expect(retry).toHaveFocus();
  fireEvent.click(retry); expect(reads).toBe(2);
  await act(async () => { finish(page()); });
  expect(await screen.findByRole('heading', { name: 'Tickets' })).toHaveFocus();
  expect(screen.getByRole('status', { name: 'Ticket list status' })).toHaveTextContent('Tickets refreshed');
});

it('keeps the pending creation draft and native controls focused until its failure is recoverable', async () => {
  let finish!: (response: Response) => void;
  let posts = 0;
  transport(options => options.method === 'POST' ? (posts++, new Promise(resolve => { finish = resolve; })) : page());
  showFeed(); await screen.findByRole('link', { name: ticket.subject });
  fireEvent.click(screen.getByRole('button', { name: 'New Ticket' }));
  const subject = await screen.findByRole('textbox', { name: 'Subject' });
  await waitFor(() => expect(subject).toHaveFocus());
  fireEvent.change(subject, { target: { value: 'Submitted subject' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Customer Email' }), { target: { value: ticket.customer_email } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Initial Message' }), { target: { value: 'Submitted message' } });
  const submit = screen.getByRole('button', { name: 'Create Ticket' });
  submit.focus(); fireEvent.click(submit);
  await waitFor(() => expect(submit).toHaveAttribute('aria-disabled', 'true'));
  expect(submit).not.toBeDisabled(); expect(submit).toHaveFocus();
  fireEvent.change(subject, { target: { value: 'Changed while pending' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Priority' }), { target: { value: 'urgent' } });
  fireEvent.click(submit);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.keyDown(document.activeElement!, {key:'Escape',code:'Escape'});
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(subject).toHaveValue('Submitted subject');
  expect(screen.getByRole('combobox', { name: 'Priority' })).toHaveValue('normal');
  expect(screen.getByRole('status', { name: 'Ticket creation status' })).toHaveTextContent('Creating ticket');
  expect(posts).toBe(1);
  await act(async () => { finish(json({ error: 'Intake stopped' }, 503)); });
  expect(await screen.findByRole('alert')).toHaveTextContent('Intake stopped');
  expect(subject).toHaveAttribute('aria-describedby', 'create-ticket-error');
  expect(submit).toHaveFocus();
});

it('names ticket actions and restores trigger focus when the disclosure is dismissed', async () => {
  transport(() => page()); showFeed();
  const trigger = await screen.findByRole('button', { name: 'Actions for #1' });
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(trigger);
  await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'true'));
  const action = await screen.findByRole('link', { name: 'View Ticket' });
  action.focus(); fireEvent.keyDown(action, { key: 'Escape' });
  await waitFor(() => expect(trigger).toHaveFocus()); expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('link', { name: 'View Ticket' })).not.toBeInTheDocument();
});

it('announces clipboard failure without losing the visible reference or control focus', async () => {
  vi.stubGlobal('navigator', Object.create(navigator, { clipboard: { value: { writeText: vi.fn().mockRejectedValue(new Error('Denied')) } } }));
  transport(() => page()); showFeed();
  const copy = await screen.findByRole('button', { name: 'Copy ticket reference' });
  copy.focus(); fireEvent.click(copy);
  expect(await screen.findByRole('alert')).toHaveTextContent('Select and copy the visible reference');
  expect(screen.getByText('#1')).toBeInTheDocument(); expect(copy).toHaveFocus();
});

it('retains pagination focus and announces previous results while the next page is pending', async () => {
  let finish!: (response: Response) => void;
  let reads = 0;
  transport(() => ++reads === 1 ? json({ data: [ticket], meta: { page: 1, total: 2, limit: 1, total_pages: 2 } }) : new Promise(resolve => { finish = resolve; }));
  showFeed();
  const next = await screen.findByRole('button', { name: 'Next' });
  next.focus(); fireEvent.click(next);
  await waitFor(() => expect(next).toHaveAttribute('aria-disabled', 'true'));
  expect(next).not.toBeDisabled(); expect(next).toHaveFocus();
  expect(screen.getByRole('status', { name: 'Ticket list status' })).toHaveTextContent('Previous results remain visible');
  fireEvent.click(next); expect(reads).toBe(2);
  await act(async () => { finish(json({ data: [{ ...ticket, id: 'next', subject: 'Next page ticket' }], meta: { page: 2, total: 2, limit: 1, total_pages: 2 } })); });
  expect(await screen.findByRole('link', { name: 'Next page ticket' })).toBeInTheDocument();
  expect(next).toHaveFocus(); expect(next).toHaveAttribute('aria-disabled', 'true');
  expect(screen.getByRole('status', { name: 'Ticket pages' })).toHaveTextContent('page 2 of 2');
});

it('moves focus from failed pagination to explicit recovery without presenting an empty feed', async () => {
  let finish!: (response: Response) => void;
  let reads = 0;
  transport(() => ++reads === 1 ? json({ data: [ticket], meta: { page: 1, total: 2, limit: 1, total_pages: 2 } }) : new Promise(resolve => { finish = resolve; }));
  showFeed();
  const next = await screen.findByRole('button', { name: 'Next' });
  next.focus(); fireEvent.click(next);
  await waitFor(() => expect(reads).toBe(2));
  await act(async () => { finish(json({ error: 'Page unavailable' }, 503)); });
  expect(await screen.findByRole('button', { name: 'Retry loading tickets' })).toHaveFocus();
  expect(screen.getByRole('alert')).toHaveTextContent('Could not load tickets');
  expect(screen.queryByText('No tickets found.')).not.toBeInTheDocument();
});
