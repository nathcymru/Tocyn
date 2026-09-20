import userEvent from '@testing-library/user-event';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TicketFieldsPage } from '../pages/TicketFieldsPage';
import { dashboardApi } from '../api/client';
const fieldQuery=vi.hoisted(()=>vi.fn());
vi.mock('../hooks/useTicketFields',()=>({useTicketFields:fieldQuery}));
vi.mock('../api/client',()=>({dashboardApi:{post:vi.fn()}}));
let client:QueryClient;
beforeEach(()=>{client=new QueryClient({defaultOptions:{mutations:{retry:false}}});fieldQuery.mockReturnValue({data:[],isLoading:false,isError:false});vi.spyOn(HTMLElement.prototype,'getClientRects').mockImplementation(function(this:HTMLElement){return (this.isConnected&&!this.closest('[hidden]')?[new DOMRect(0,0,100,44)]:[]) as unknown as DOMRectList;});});
afterEach(()=>{cleanup();client.clear();vi.restoreAllMocks();vi.resetAllMocks();});
async function openEditor(){
 render(<QueryClientProvider client={client}><TicketFieldsPage/></QueryClientProvider>);
 const opener=screen.getByRole('button',{name:'Create Field'});opener.focus();fireEvent.click(opener);
 const dialog=await screen.findByRole('dialog',{name:'Create Ticket Field'});
 const label=within(dialog).getByRole('textbox',{name:'Display Label'});await waitFor(()=>expect(label).toHaveFocus());return{opener,dialog,label};
}
it('uses installed Park Dialog anatomy and returns focus after idle Escape without discarding a field remotely',async()=>{
 const {opener,dialog}=await openEditor();
 expect(dialog).toHaveClass('dialog__content');
 expect(document.querySelector('.dialog__backdrop')).toBeInTheDocument();
 expect(dialog.querySelector('.dialog__header .dialog__title')).toHaveTextContent('Create Ticket Field');
 expect(dialog.querySelector('.dialog__body')).toBeInTheDocument();
 expect(dialog.querySelector('.dialog__footer')).toContainElement(within(dialog).getByRole('button',{name:'Cancel'}));
 fireEvent.pointerDown(document.body);fireEvent.click(document.body);
 expect(dialog).toBeInTheDocument();
 fireEvent.keyDown(document.activeElement!,{key:'Escape'});
 await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
 await waitFor(()=>expect(opener).toHaveFocus());
 expect(dashboardApi.post).not.toHaveBeenCalled();
});
it('preserves generated and overridden names, options and active state in the submitted payload',async()=>{
 vi.mocked(dashboardApi.post).mockResolvedValue({});const invalidate=vi.spyOn(client,'invalidateQueries');
 const {opener,dialog,label}=await openEditor();fireEvent.change(label,{target:{value:'Device Model'}});
 for(const name of ['Display Label','Key Name']){
  const input=within(dialog).getByRole('textbox',{name});
  const field=input.closest('[data-scope="field"][data-part="root"]');
  expect(field).toHaveClass('field__root');
  expect(field?.querySelector('[data-scope="field"][data-part="label"]')).toHaveTextContent(name);
 }
 const key=within(dialog).getByRole('textbox',{name:'Key Name'});expect(key).toHaveValue('device_model');
 expect(document.getElementById(key.getAttribute('aria-describedby')!)).toHaveClass('field__helperText');
 fireEvent.change(key,{target:{value:'custom_key'}});fireEvent.change(label,{target:{value:'Model Name'}});expect(key).toHaveValue('custom_key');
 const type=within(dialog).getByRole('combobox',{name:'Field Type'});
 expect(type.closest('[data-scope="select"][data-part="root"]')).toHaveClass('select__root');
 expect(type.closest('[data-scope="select"][data-part="root"]')?.querySelector('[data-part="label"]')).toHaveClass('select__label');
 await userEvent.click(type);
 await userEvent.click(await within(dialog).findByRole('option',{name:'Dropdown (Select)'}));
 const options=within(dialog).getByRole('textbox',{name:'Options'});
 expect(options.closest('[data-scope="field"][data-part="root"]')).toHaveClass('field__root');
 fireEvent.change(options,{target:{value:'One, Two'}});
 await userEvent.click(within(dialog).getByText('Active'));
 expect(within(dialog).getByRole('checkbox',{name:'Active'})).not.toBeChecked();
 fireEvent.submit(within(dialog).getByRole('form'));
 await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
 expect(dashboardApi.post).toHaveBeenCalledWith('/ticket-fields',{name:'custom_key',label:'Model Name',field_type:'select',options:'One, Two',is_active:false});
 expect(invalidate).toHaveBeenCalledWith({queryKey:['ticket-fields']});await waitFor(()=>expect(opener).toHaveFocus());
});
it('keeps the Park Select menu inside its dialog for pointer and keyboard access',async()=>{
 const {dialog}=await openEditor();
 const trigger=within(dialog).getByRole('combobox',{name:'Field Type'});
 await userEvent.click(trigger);
 const option=await within(dialog).findByRole('option',{name:'Dropdown (Select)'});
 expect(option.closest('[data-scope="select"][data-part="positioner"]')?.closest('[data-scope="dialog"][data-part="content"]')).toBe(dialog);
 await userEvent.keyboard('{End}{Enter}');
 expect(trigger).toHaveTextContent('Checkbox');
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

it('uses Park table rows and badges for loaded fields',()=>{
 fieldQuery.mockReturnValue({data:[{id:'field-1',label:'Device model',name:'device_model',field_type:'text',options:null,is_active:true}],isLoading:false,isError:false});
 render(<QueryClientProvider client={client}><TicketFieldsPage/></QueryClientProvider>);
 const table=screen.getByRole('table');
 expect(table.querySelector('tbody tr td')).toBeInTheDocument();
 expect(screen.getByText('Active').className).toContain('badge');
 expect(screen.getByText('Device model')).toBeInTheDocument();
});

it('keeps a retry action when the field list fails to load',()=>{
 const refetch=vi.fn();fieldQuery.mockReturnValue({data:undefined,isLoading:false,isError:true,refetch});
 render(<QueryClientProvider client={client}><TicketFieldsPage/></QueryClientProvider>);
 expect(screen.getByRole('alert')).toHaveTextContent('Ticket fields could not be loaded');
 fireEvent.click(screen.getByRole('button',{name:'Retry ticket fields'}));
 expect(refetch).toHaveBeenCalledOnce();
});

it('retains confirmed field rows and an inline retry after a refresh failure', () => {
 const refetch=vi.fn();
 fieldQuery.mockReturnValue({data:[{id:'field-1',label:'Device model',name:'device_model',field_type:'text',options:null,is_active:true}],isLoading:false,isError:true,refetch});
 render(<QueryClientProvider client={client}><TicketFieldsPage/></QueryClientProvider>);
 const warning=screen.getByRole('alert');
 expect(warning).toHaveClass('alert__root');
 expect(warning).toHaveTextContent('The last confirmed field definitions remain visible');
 expect(screen.getByRole('table')).toHaveTextContent('Device model');
 expect(screen.queryByText('Ticket fields could not be loaded')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Retry ticket fields'}));
 expect(refetch).toHaveBeenCalledOnce();
});
