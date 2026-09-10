// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter,Route,Routes} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {TicketDetailPage} from '../pages/TicketDetailPage';
import {dashboardApi} from '../api/client';
vi.mock('../api/client',()=>({dashboardApi:{get:vi.fn(),post:vi.fn(),postForm:vi.fn(),patch:vi.fn(),download:vi.fn()}}));
vi.mock('../hooks/useGroups',()=>({useGroups:()=>({data:[]}),useAgents:()=>({data:[]})}));
vi.mock('../hooks/useSettings',()=>({useSettings:()=>({data:{TICKET_PREFIX:'#'}})}));
vi.mock('../hooks/useTicketFields',()=>({useTicketFields:()=>({data:[]})}));
const presence = vi.hoisted(() => ({current: [] as {userId:string;name:string;location:string}[]}));
vi.mock('../hooks/useRealtime',()=>({useRealtime:()=>({presence:presence.current,updateLocation:()=>{},lastMessage:null})}));
afterEach(()=>{cleanup();vi.clearAllMocks();presence.current=[];});
const article=(id:string,body:string)=>({id,body,sender_type:'customer',created_at:'2026-09-09 00:00:00',attachments:[]});
const ticket={id:'ticket',subject:'A bounded staff conversation',status:'open',priority:'normal',ticket_no:1,created_at:'2026-09-09 00:00:00',updated_at:'2026-09-09 00:00:00',customer_email:'synthetic@example.invalid',custom_fields:{},articles:[]};
describe('dashboard conversation pagination',()=>{
  it('uses the page cursor, retains prior messages and focus, and announces completion',async()=>{
    let finishPage!: () => void;
    const pendingPage = new Promise<void>(resolve => { finishPage = resolve; });
    vi.mocked(dashboardApi.get).mockImplementation(async(path)=>{
      if (path.includes('article_cursor=')) await pendingPage;
      return { ...ticket,articles:[path.includes('article_cursor=')?article('second','Later staff-visible reply'):article('first','Accepted initial message')],pagination:path.includes('article_cursor=')?{has_more:false,next_cursor:null}:{has_more:true,next_cursor:'opaque-cursor'} } as never;
    });
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/tickets/ticket']}><Routes><Route path="/tickets/:id" element={<TicketDetailPage/>}/></Routes></MemoryRouter></QueryClientProvider>);
    const button=await screen.findByRole('button',{name:'Load more messages'});button.focus();fireEvent.click(button);
    await screen.findByRole('button', {name: 'Loading messages…'});
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(vi.mocked(dashboardApi.get).mock.calls.filter(([path]) => path.includes('article_cursor='))).toHaveLength(1);
    finishPage();
    await screen.findByText('Later staff-visible reply');
    expect(screen.getByText('Accepted initial message')).toBeTruthy();
    expect(dashboardApi.get).toHaveBeenCalledWith('/tickets/ticket?article_cursor=opaque-cursor');
    await waitFor(()=>expect(screen.getByRole('status').textContent).toContain('Showing 2 messages. All messages are loaded.'));
    expect(screen.getByRole('button',{name:'All messages loaded'})).toBe(button);expect(document.activeElement).toBe(button);
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(button);
    expect(vi.mocked(dashboardApi.get).mock.calls.filter(([path]) => path.includes('article_cursor='))).toHaveLength(1);
    await client.invalidateQueries({queryKey:['ticket','ticket']});
    expect(screen.getByText('Accepted initial message')).toBeTruthy();expect(screen.getByText('Later staff-visible reply')).toBeTruthy();
    client.clear();
  });
});

it('keeps QA controls visible and named, guards pending writes and exposes retry feedback without raw errors',async()=>{
  const current={...article('qa-article','Synthetic QA message'),qa_type:null as string|null};
  vi.mocked(dashboardApi.get).mockImplementation(async()=>({...ticket,articles:[current],pagination:{has_more:false,next_cursor:null}}) as never);
  let fail!:(error:Error)=>void;
  vi.mocked(dashboardApi.post).mockImplementationOnce(()=>new Promise((_resolve,reject)=>{fail=reject;}));
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/tickets/ticket']}><Routes><Route path="/tickets/:id" element={<TicketDetailPage/>}/></Routes></MemoryRouter></QueryClientProvider>);
  const question=await screen.findByRole('button',{name:'Mark as SOP (internal procedure)'});
  expect(question).toHaveAttribute('aria-pressed','false');
  expect(question.parentElement?.parentElement?.className).not.toContain('opacity-0');
  fireEvent.click(question);fireEvent.click(question);
  expect(dashboardApi.post).toHaveBeenCalledTimes(1);expect(question).toBeDisabled();
  await act(async()=>fail(new Error('private synthetic failure detail')));
  expect(await screen.findByRole('alert')).toHaveTextContent('QA marking could not be confirmed');
  expect(screen.queryByText(/private synthetic failure detail/)).not.toBeInTheDocument();
  expect(question).toBeEnabled();
  vi.mocked(dashboardApi.post).mockImplementationOnce(async()=>{current.qa_type='sop';return {} as never;});
  fireEvent.click(question);
  await waitFor(()=>expect(question).toHaveAttribute('aria-pressed','true'));
  expect(dashboardApi.post).toHaveBeenLastCalledWith('/knowledge/articles/qa-article/qa',{type:'sop'});
  expect(screen.getByText('QA marked')).toBeInTheDocument();expect(screen.queryByText('INDEXED')).not.toBeInTheDocument();
  client.clear();
});

it('exposes all verified viewer names beyond the three visible avatars',async()=>{
  presence.current=Array.from({length:4},(_,index)=>({userId:String(index),name:`Synthetic viewer ${index}`,location:'ticket:ticket'}));
  presence.current.push({userId:'other',name:'Different ticket viewer',location:'ticket:other'});
  vi.mocked(dashboardApi.get).mockResolvedValue({...ticket,articles:[],pagination:{has_more:false,next_cursor:null}} as never);
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/tickets/ticket']}><Routes><Route path="/tickets/:id" element={<TicketDetailPage/>}/></Routes></MemoryRouter></QueryClientProvider>);
  expect(await screen.findByText('Viewing this ticket: Synthetic viewer 0, Synthetic viewer 1, Synthetic viewer 2, Synthetic viewer 3')).toBeInTheDocument();
  expect(screen.queryByText(/Different ticket viewer/)).not.toBeInTheDocument();client.clear();
});


it('retains legacy Question records visibly without sending a conversion request',async()=>{
  vi.mocked(dashboardApi.get).mockResolvedValue({...ticket,articles:[{...article('legacy','Existing synthetic message'),qa_type:'question'}],pagination:{has_more:false,next_cursor:null}} as never);
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/tickets/ticket']}><Routes><Route path="/tickets/:id" element={<TicketDetailPage/>}/></Routes></MemoryRouter></QueryClientProvider>);
  expect(await screen.findByText(/Legacy Question marker retained/)).toBeInTheDocument();
  const sop=screen.getByRole('button',{name:'Mark as SOP (internal procedure)'});expect(sop).toBeDisabled();
  expect(screen.getByRole('button',{name:'Mark as answer'})).toBeDisabled();
  fireEvent.click(sop);expect(dashboardApi.post).not.toHaveBeenCalled();expect(screen.getByText('Existing synthetic message')).toBeInTheDocument();
  client.clear();
});
