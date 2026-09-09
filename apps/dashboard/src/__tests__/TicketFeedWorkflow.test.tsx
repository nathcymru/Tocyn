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
  // jsdom has no browser dialog top layer; the actual browser checks cover native focus containment.
  Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}});
  Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.removeAttribute('open');}});
  client = new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
  useAuthStore.getState().setAuth('synthetic-session',{id:'operator',email:'operator@example.invalid',full_name:'Operator',role:'admin',mfa_enabled:true});
});
afterEach(() => {cleanup();client.clear();useAuthStore.getState().logout();localStorage.clear();vi.restoreAllMocks();vi.unstubAllGlobals();Reflect.deleteProperty(HTMLDialogElement.prototype,'showModal');Reflect.deleteProperty(HTMLDialogElement.prototype,'close');});

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
  fireEvent.change(screen.getByRole('textbox',{name:'Subject'}),{target:{value:'Operator-created follow-up'}});
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

it('names the native create dialog, focuses its first field, and returns focus on cancellation', async () => {
  transport(()=>page());showFeed();await screen.findByRole('link',{name:ticket.subject});
  const trigger=screen.getByRole('button',{name:'New Ticket'});
  trigger.focus();fireEvent.click(trigger);
  const dialog=screen.getByRole('dialog',{name:'Create New Ticket'});
  expect(screen.getByRole('textbox',{name:'Subject'})).toHaveFocus();
  fireEvent(dialog,new Event('cancel',{bubbles:false,cancelable:true}));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
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
