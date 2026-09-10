import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TicketFieldsPage } from '../pages/TicketFieldsPage';
import { dashboardApi } from '../api/client';
vi.mock('../hooks/useTicketFields',()=>({useTicketFields:()=>({data:[],isLoading:false})}));
vi.mock('../api/client',()=>({dashboardApi:{post:vi.fn()}}));
let client:QueryClient;
beforeEach(()=>{client=new QueryClient({defaultOptions:{mutations:{retry:false}}});vi.spyOn(HTMLElement.prototype,'getClientRects').mockImplementation(function(this:HTMLElement){return (this.isConnected&&!this.closest('[hidden]')?[new DOMRect(0,0,100,44)]:[]) as unknown as DOMRectList;});});
afterEach(()=>{cleanup();client.clear();vi.restoreAllMocks();vi.resetAllMocks();});
async function openEditor(){
 render(<QueryClientProvider client={client}><TicketFieldsPage/></QueryClientProvider>);
 const opener=screen.getByRole('button',{name:'Create Field'});opener.focus();fireEvent.click(opener);
 const dialog=await screen.findByRole('dialog',{name:'Create Ticket Field'});
 const label=within(dialog).getByRole('textbox',{name:'Display Label'});await waitFor(()=>expect(label).toHaveFocus());return{opener,dialog,label};
}
it('preserves generated and overridden names, options and active state in the submitted payload',async()=>{
 vi.mocked(dashboardApi.post).mockResolvedValue({});const invalidate=vi.spyOn(client,'invalidateQueries');
 const {opener,dialog,label}=await openEditor();fireEvent.change(label,{target:{value:'Device Model'}});
 const key=within(dialog).getByRole('textbox',{name:'Key Name'});expect(key).toHaveValue('device_model');
 fireEvent.change(key,{target:{value:'custom_key'}});fireEvent.change(label,{target:{value:'Model Name'}});expect(key).toHaveValue('custom_key');
 fireEvent.change(within(dialog).getByRole('combobox',{name:'Field Type'}),{target:{value:'select'}});
 fireEvent.change(within(dialog).getByRole('textbox',{name:'Options'}),{target:{value:'One, Two'}});
 fireEvent.click(within(dialog).getByRole('checkbox',{name:'Active'}));
 fireEvent.submit(within(dialog).getByRole('form'));
 await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
 expect(dashboardApi.post).toHaveBeenCalledWith('/ticket-fields',{name:'custom_key',label:'Model Name',field_type:'select',options:'One, Two',is_active:false});
 expect(invalidate).toHaveBeenCalledWith({queryKey:['ticket-fields']});await waitFor(()=>expect(opener).toHaveFocus());
});
it('blocks duplicate saves and pending dismissal, then retains a failed draft for retry',async()=>{
 let reject!:(error:Error)=>void;vi.mocked(dashboardApi.post).mockImplementationOnce(()=>new Promise((_resolve,r)=>{reject=r;})).mockResolvedValueOnce({});
 const {dialog,label}=await openEditor();fireEvent.change(label,{target:{value:'Keep draft'}});const form=within(dialog).getByRole('form');
 fireEvent.submit(form);fireEvent.submit(form);await waitFor(()=>expect(dashboardApi.post).toHaveBeenCalledTimes(1));
 await waitFor(()=>expect(within(dialog).getByRole('button',{name:'Close ticket field editor'})).toBeDisabled());
 fireEvent.keyDown(document.activeElement!,{key:'Escape'});expect(screen.getByRole('dialog')).toBeInTheDocument();
 await act(async()=>reject(new Error('synthetic failure')));
 expect(await screen.findByRole('alert')).toHaveTextContent('Your changes have been kept');expect(label).toHaveValue('Keep draft');
 fireEvent.submit(form);await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());expect(dashboardApi.post).toHaveBeenCalledTimes(2);
});
it('cancels without a request and starts a fresh draft when reopened',async()=>{
 const {opener,dialog,label}=await openEditor();fireEvent.change(label,{target:{value:'Discard me'}});
 fireEvent.click(within(dialog).getByRole('button',{name:'Cancel'}));await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
 await waitFor(()=>expect(opener).toHaveFocus());fireEvent.click(opener);
 const fresh=await screen.findByRole('dialog',{name:'Create Ticket Field'});expect(within(fresh).getByRole('textbox',{name:'Display Label'})).toHaveValue('');expect(dashboardApi.post).not.toHaveBeenCalled();
});

it('returns focus to the empty-state opener when that button opened the dialog',async()=>{
 render(<QueryClientProvider client={client}><TicketFieldsPage/></QueryClientProvider>);
 const opener=screen.getByRole('button',{name:'Create your first field'});opener.focus();fireEvent.click(opener);
 const dialog=await screen.findByRole('dialog',{name:'Create Ticket Field'});
 fireEvent.click(within(dialog).getByRole('button',{name:'Cancel'}));
 await waitFor(()=>expect(opener).toHaveFocus());
});
