import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TicketDetailPage } from '../pages/TicketDetailPage';
import { portalApi } from '../api/client';
vi.mock('../api/client',()=>({portalApi:{get:vi.fn(),post:vi.fn(),postForm:vi.fn(),download:vi.fn()}}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
const ticket={id:'ticket',subject:'A bounded conversation',status:'open',ticket_no:1,created_at:'2026-09-09 00:00:00'};
const article=(id:string,body:string)=>({id,body,sender_type:'customer',created_at:'2026-09-09 00:00:00',attachments:[]});
function mount(){render(<MemoryRouter initialEntries={['/tickets/ticket']}><Routes><Route path="/tickets/:id" element={<TicketDetailPage/>}/></Routes></MemoryRouter>);}
describe('visible conversation pagination',()=>{
  it('retains existing messages, loads the advertised cursor, and announces completion without losing the control',async()=>{
    let finishPage!: () => void;
    const pendingPage = new Promise<void>(resolve => { finishPage = resolve; });
    vi.mocked(portalApi.get).mockImplementation(async(path)=>{
      if(path==='/config')return {TICKET_PREFIX:'#'} as never;
      if(path.includes('article_cursor='))await pendingPage;
      if(path.includes('article_cursor='))return {ticket,articles:[article('second','Later accepted reply')],pagination:{has_more:false,next_cursor:null}} as never;
      return {ticket,articles:[article('first','First accepted message')],pagination:{has_more:true,next_cursor:'opaque-cursor'}} as never;
    });
    mount();
    const button=await screen.findByRole('button',{name:'Load more messages'});
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('aria-controls')).toBe('conversation-messages');
    button.focus();fireEvent.click(button);
    await screen.findByRole('button', {name: 'Loading messages…'});
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(vi.mocked(portalApi.get).mock.calls.filter(([path]) => path.includes('article_cursor='))).toHaveLength(1);
    finishPage();
    await screen.findByText('Later accepted reply');
    expect(screen.getByText('First accepted message')).toBeTruthy();
    expect(portalApi.get).toHaveBeenCalledWith('/tickets/ticket?article_cursor=opaque-cursor');
    expect(screen.getByRole('status').textContent).toContain('All messages are loaded');
    expect(screen.getByRole('button',{name:'All messages loaded'})).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(button);
    expect(vi.mocked(portalApi.get).mock.calls.filter(([path]) => path.includes('article_cursor='))).toHaveLength(1);
  });
  it('announces a failed page and permits retry without hiding accepted messages',async()=>{
    vi.mocked(portalApi.get).mockImplementation(async(path)=>{
      if(path==='/config')return {TICKET_PREFIX:'#'} as never;
      if(path.includes('article_cursor='))throw new Error('Could not load the next page');
      return {ticket,articles:[article('first','Preserved message')],pagination:{has_more:true,next_cursor:'opaque-cursor'}} as never;
    });
    mount();fireEvent.click(await screen.findByRole('button',{name:'Load more messages'}));
    await waitFor(()=>expect(screen.getByRole('status').textContent).toContain('Could not load the next page'));
    expect(screen.getByText('Preserved message')).toBeTruthy();
    expect(screen.getByRole('button',{name:'Load more messages'}).hasAttribute('disabled')).toBe(false);
  });
});
