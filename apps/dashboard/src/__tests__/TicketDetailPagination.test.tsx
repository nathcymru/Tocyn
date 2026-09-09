// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter,Route,Routes} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {TicketDetailPage} from '../pages/TicketDetailPage';
import {dashboardApi} from '../api/client';
vi.mock('../api/client',()=>({dashboardApi:{get:vi.fn(),post:vi.fn(),postForm:vi.fn(),patch:vi.fn(),download:vi.fn()}}));
vi.mock('../hooks/useGroups',()=>({useGroups:()=>({data:[]}),useAgents:()=>({data:[]})}));
vi.mock('../hooks/useSettings',()=>({useSettings:()=>({data:{TICKET_PREFIX:'#'}})}));
vi.mock('../hooks/useTicketFields',()=>({useTicketFields:()=>({data:[]})}));
vi.mock('../hooks/useRealtime',()=>({useRealtime:()=>({presence:[],updateLocation:()=>{},lastMessage:null})}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
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
