// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {createMemoryRouter,RouterProvider} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {TicketDetailPage} from '../pages/TicketDetailPage';
import {useAuthStore} from '../store/authStore';
const presence = vi.hoisted(() => ({current: [] as {userId:string;name:string;location:string}[]}));
vi.mock('../hooks/useRealtime',()=>({useRealtime:()=>({presence:presence.current,updateLocation:()=>{},lastMessage:null})}));
const article=(id:string,body:string)=>({id,body,sender_type:'customer',created_at:'2026-09-09 00:00:00',attachments:[]});
const ticket={id:'ticket',subject:'A bounded staff conversation',status:'open',priority:'normal',ticket_no:1,created_at:'2026-09-09 00:00:00',updated_at:'2026-09-09 00:00:00',customer_email:'synthetic@example.invalid',custom_fields:{},articles:[]};
const unavailableSla={response:{state:'unavailable',phase:'unavailable',completedAt:null,dueAt:null,remainingWorkingMilliseconds:null,targetWorkingMilliseconds:null},resolution:{state:'unavailable',phase:'unavailable',completedAt:null,dueAt:null,remainingWorkingMilliseconds:null,targetWorkingMilliseconds:null},handlerName:null};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
let request:(path:string,init:RequestInit)=>Promise<Response>|Response;
function renderDetail(client:QueryClient) {
  const router=createMemoryRouter([{path:'/tickets/:id',element:<TicketDetailPage/>}],{initialEntries:['/tickets/ticket']});
  render(<QueryClientProvider client={client}><RouterProvider router={router}/></QueryClientProvider>);
}
function calls(path:string) { return vi.mocked(fetch).mock.calls.filter(([url])=>String(url).includes(path)); }
afterEach(()=>{cleanup();useAuthStore.getState().logout();localStorage.clear();vi.unstubAllGlobals();presence.current=[];});
function setup(response:typeof request) {
  request=response;
  useAuthStore.getState().setAuth('synthetic-session',{id:'operator',tenant_id:'tenant-a',email:'operator@example.invalid',full_name:'Operator',role:'admin',mfa_enabled:true});
  vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit={})=>{
    const target=new URL(url,'http://localhost');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer synthetic-session');
    const path=`${target.pathname}${target.search}`;
    if(path==='/api/groups')return json([]);
    if(path==='/api/users/agents')return json([]);
    if(path==='/api/settings')return json({TICKET_PREFIX:'#'});
    if(path==='/api/ticket-fields')return json([]);
    if(path==='/api/workspace/drafts/ticket')return new Response(null,{status:204});
    if(path==='/api/tickets/ticket/sla')return json(unavailableSla);
    return request(path,init);
  }));
}
describe('dashboard conversation pagination',()=>{
  it('uses the page cursor, retains prior messages and focus, and announces completion',async()=>{
    let finishPage!: () => void;
    const pendingPage = new Promise<void>(resolve => { finishPage = resolve; });
    setup(async(path)=>{
      if (path.includes('article_cursor=')) await pendingPage;
      return json({ ...ticket,articles:[path.includes('article_cursor=')?article('second','Later staff-visible reply'):article('first','Accepted initial message')],pagination:path.includes('article_cursor=')?{has_more:false,next_cursor:null}:{has_more:true,next_cursor:'opaque-cursor'} });
    });
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
    renderDetail(client);
    const button=await screen.findByRole('button',{name:'Load more messages'});button.focus();fireEvent.click(button);
    await screen.findByRole('button', {name: 'Loading messages…'});
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(calls('article_cursor=opaque-cursor')).toHaveLength(1);
    finishPage();
    await screen.findByText('Later staff-visible reply');
    expect(screen.getByText('Accepted initial message')).toBeTruthy();
    expect(calls('/api/tickets/ticket?article_cursor=opaque-cursor')).toHaveLength(1);
    await waitFor(()=>expect(screen.getByText('Showing 2 messages. All messages are loaded.').textContent).toContain('Showing 2 messages. All messages are loaded.'));
    expect(screen.getByText('Showing 2 messages. All messages are loaded.').getAttribute('role')).toBe('status');
    expect(screen.getByRole('button',{name:'All messages loaded'})).toBe(button);expect(document.activeElement).toBe(button);
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(button);
    expect(calls('article_cursor=opaque-cursor')).toHaveLength(1);
    await client.invalidateQueries({queryKey:['ticket','ticket']});
    expect(screen.getByText('Accepted initial message')).toBeTruthy();expect(screen.getByText('Later staff-visible reply')).toBeTruthy();
    client.clear();
  });
});

it('keeps QA controls visible and named, guards pending writes and exposes retry feedback without raw errors',async()=>{
  const current={...article('qa-article','Synthetic QA message'),qa_type:null as string|null};
  let fail!:(error:Error)=>void;
  let attempts=0;setup((path,init)=>{
    if(path==='/api/tickets/ticket')return json({...ticket,articles:[current],pagination:{has_more:false,next_cursor:null}});
    if(path==='/api/knowledge/articles/qa-article/qa') {
      attempts++;
      return attempts===1 ? new Promise((_resolve,reject)=>{fail=reject;}) : json({});
    }
    return json([]);
  });
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  renderDetail(client);
  const question=await screen.findByRole('button',{name:'Mark as SOP (internal procedure)'});
  expect(question).toHaveAttribute('aria-pressed','false');
  expect(question.parentElement?.parentElement?.className).not.toContain('opacity-0');
  fireEvent.click(question);fireEvent.click(question);
  expect(calls('/api/knowledge/articles/qa-article/qa')).toHaveLength(1);expect(question).toBeDisabled();
  await act(async()=>fail(new Error('private synthetic failure detail')));
  expect(await screen.findByRole('alert')).toHaveTextContent('QA marking could not be confirmed');
  expect(screen.queryByText(/private synthetic failure detail/)).not.toBeInTheDocument();
  expect(question).toBeEnabled();
  current.qa_type='sop';
  fireEvent.click(question);
  await waitFor(()=>expect(question).toHaveAttribute('aria-pressed','true'));
  expect(JSON.parse(String(calls('/api/knowledge/articles/qa-article/qa').at(-1)?.[1]?.body))).toEqual({type:'sop'});
  expect(screen.getByText('QA marked')).toBeInTheDocument();expect(screen.queryByText('INDEXED')).not.toBeInTheDocument();
  client.clear();
});

it('exposes all verified viewer names beyond the three visible avatars',async()=>{
  presence.current=Array.from({length:4},(_,index)=>({userId:String(index),name:`Synthetic viewer ${index}`,location:'ticket:ticket'}));
  presence.current.push({userId:'other',name:'Different ticket viewer',location:'ticket:other'});
  setup(()=>json({...ticket,articles:[],pagination:{has_more:false,next_cursor:null}}));
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  renderDetail(client);
  expect(await screen.findByText('Viewing this ticket: Synthetic viewer 0, Synthetic viewer 1, Synthetic viewer 2, Synthetic viewer 3')).toBeInTheDocument();
  expect(screen.queryByText(/Different ticket viewer/)).not.toBeInTheDocument();client.clear();
});


it('retains legacy Question records visibly without sending a conversion request',async()=>{
  setup(()=>json({...ticket,articles:[{...article('legacy','Existing synthetic message'),qa_type:'question'}],pagination:{has_more:false,next_cursor:null}}));
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  renderDetail(client);
  expect(await screen.findByText(/Legacy Question marker retained/)).toBeInTheDocument();
  const sop=screen.getByRole('button',{name:'Mark as SOP (internal procedure)'});expect(sop).toBeDisabled();
  expect(screen.getByRole('button',{name:'Mark as answer'})).toBeDisabled();
  fireEvent.click(sop);expect(calls('/api/knowledge/articles/legacy/qa')).toHaveLength(0);expect(screen.getByText('Existing synthetic message')).toBeInTheDocument();
  client.clear();
});
