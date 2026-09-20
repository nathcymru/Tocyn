import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { KnowledgeBrowser } from '../components/KnowledgeBrowser';
import { dashboardApi } from '../api/client';
import { useAuthStore } from '../store/authStore';
import type { KnowledgeDoc } from '../types';
vi.mock('../api/client', () => ({dashboardApi:{get:vi.fn()}}));
const articles=[{id:'a',title:'Password guide'},{id:'b',title:'Billing guide'}] as KnowledgeDoc[];
afterEach(()=>{cleanup();vi.resetAllMocks();});
function show(){const insert=vi.fn();const view=render(<KnowledgeBrowser articles={articles} disabled={false} onInsert={insert}/>);return {insert,...view};}
it('searches titles only on explicit submission and clears a no-match query',()=>{
 show();fireEvent.change(screen.getByLabelText('Search knowledge titles'),{target:{value:'PASSWORD'}});
 expect(screen.queryByRole('status')).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Search titles'}));
 expect(screen.getByRole('status')).toHaveTextContent('1 matching');expect(screen.queryByRole('button',{name:'Preview Billing guide'})).not.toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Search knowledge titles'),{target:{value:'unknown'}});fireEvent.click(screen.getByRole('button',{name:'Search titles'}));expect(screen.getByText('No knowledge titles match this search.')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Clear knowledge search'}));expect(screen.getByRole('button',{name:'Preview Billing guide'})).toBeInTheDocument();
});
it('previews plain text with bounded display and returns focus without inserting',async()=>{
 let resolve!:(v:{content:string})=>void;vi.mocked(dashboardApi.get).mockReturnValue(new Promise(r=>resolve=r));const f=show();const trigger=screen.getByRole('button',{name:'Preview Password guide'});fireEvent.click(trigger);
 const loading=screen.getByRole('status',{name:'Loading knowledge preview'});
 expect(loading).toHaveAttribute('aria-busy','true');
 expect(loading).toHaveTextContent('Loading knowledge preview…');
 expect(loading.querySelectorAll('[class*="skeleton"]')).toHaveLength(3);
 expect(screen.getByRole('heading',{name:'Preview: Password guide'})).toHaveFocus();
 await act(async()=>resolve({content:'<script>unsafe()</script>'+ 'x'.repeat(4000)}));expect(screen.getByText(/Preview shows the first/)).toBeInTheDocument();expect(screen.getByText(/<script>unsafe/).textContent).toHaveLength(4000);expect(document.querySelector('script')).toBeNull();expect(f.insert).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Close preview'}));expect(trigger).toHaveFocus();
});
it('shows a retryable failure and discards earlier article and closed responses',async()=>{
 const pending:Array<(v:{content:string})=>void>=[];vi.mocked(dashboardApi.get).mockRejectedValueOnce(new Error('Unavailable'));const f=show();fireEvent.click(screen.getByRole('button',{name:'Preview Password guide'}));const error=await screen.findByRole('alert');
 expect(error).toHaveClass('alert__root');
 expect(error.querySelector('.alert__description')).toHaveTextContent('Your draft is unchanged');
 vi.mocked(dashboardApi.get).mockImplementation(()=>new Promise(r=>pending.push(r)));fireEvent.click(screen.getByRole('button',{name:'Retry preview'}));
 expect(screen.queryByRole('alert')).not.toBeInTheDocument();
 expect(screen.getByRole('status',{name:'Loading knowledge preview'})).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Preview Billing guide'}));
 await act(async()=>pending[0]({content:'Stale text'}));expect(screen.queryByText('Stale text')).not.toBeInTheDocument();await act(async()=>pending[1]({content:'Current text'}));await screen.findByText('Current text');
 fireEvent.click(screen.getByRole('button',{name:'Preview Password guide'}));fireEvent.click(screen.getByRole('button',{name:'Close preview'}));await act(async()=>pending[2]({content:'Closed text'}));expect(screen.queryByText('Closed text')).not.toBeInTheDocument();expect(f.insert).not.toHaveBeenCalled();
});
it('discards a response after the authenticated identity changes',async()=>{
 let resolve!:(v:{content:string})=>void;vi.mocked(dashboardApi.get).mockReturnValue(new Promise(r=>resolve=r));show();fireEvent.click(screen.getByRole('button',{name:'Preview Password guide'}));
 act(()=>useAuthStore.setState(s=>({sessionGeneration:s.sessionGeneration+1})));
 await act(async()=>resolve({content:'Prior identity text'}));expect(screen.queryByText('Prior identity text')).not.toBeInTheDocument();
});
