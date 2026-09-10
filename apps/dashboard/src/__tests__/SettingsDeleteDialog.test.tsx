import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FiltersSettingsPage } from '../pages/FiltersSettingsPage';
import { AutomationPage } from '../pages/AutomationPage';
import type { TocynConfirmDialogProps } from '@luminatick/ui/dialog';
interface ExtendedConfirmation extends TocynConfirmDialogProps { auditLabel?: string }
const descriptionContract:Pick<ExtendedConfirmation,'description'|'confirmLabel'|'auditLabel'>={description:'Confirmation',confirmLabel:'Delete',auditLabel:'synthetic'};
const fixture=vi.hoisted(()=>({remove:vi.fn(),get:vi.fn()}));
vi.mock('../api/client',()=>({dashboardApi:{get:fixture.get,delete:fixture.remove}}));
vi.mock('../hooks/useFilters',()=>({useFilters:()=>({data:[{id:'filter-a',name:'Synthetic filter',conditions:[]}],isLoading:false}),useCreateFilter:()=>({mutateAsync:vi.fn()}),useUpdateFilter:()=>({mutateAsync:vi.fn()}),useDeleteFilter:()=>({mutateAsync:fixture.remove})}));
beforeEach(()=>{
 fixture.get.mockResolvedValue([{id:'rule-a',name:'Synthetic rule',is_active:true,event_type:'ticket.created',action_type:'webhook',conditions:'[]'}]);
 vi.spyOn(HTMLElement.prototype,'getClientRects').mockImplementation(function(this:HTMLElement){return (this.isConnected&&!this.closest('[hidden]')?[new DOMRect(0,0,100,44)]:[]) as unknown as DOMRectList;});
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.resetAllMocks();});
for(const entry of [
 {kind:'filter',Page:FiltersSettingsPage,title:'Delete filter: Synthetic filter',opener:'Delete Synthetic filter',confirm:'Delete filter',heading:'Custom Filters',payload:'filter-a'},
 {kind:'rule',Page:AutomationPage,title:'Delete rule: Synthetic rule',opener:'Delete Synthetic rule',confirm:'Delete rule',heading:'Automation Rules',payload:'/automations/rule-a'},
]){
 async function open(){render(<entry.Page/>);const opener=await screen.findByRole('button',{name:entry.opener});opener.focus();fireEvent.click(opener);const dialog=await screen.findByRole('dialog',{name:entry.title});await waitFor(()=>expect(within(dialog).getByRole('button',{name:'Cancel'})).toHaveFocus());return{opener,dialog};}
 it(`names/describes ${entry.kind} confirmation and restores focus on cancellation without mutation`,async()=>{
  const {opener,dialog}=await open();expect(dialog).toHaveAccessibleDescription(/cannot be undone/);
  expect(within(dialog).getByRole('button',{name:'Cancel'})).toHaveAttribute('type','button');
  fireEvent.keyDown(document.activeElement!,{key:'Escape'});await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());await waitFor(()=>expect(opener).toHaveFocus());expect(fixture.remove).not.toHaveBeenCalled();
 });
 it(`guards pending ${entry.kind} deletion and preserves the target on failure for retry`,async()=>{
  let reject!:(error:Error)=>void;fixture.remove.mockImplementationOnce(()=>new Promise((_resolve,r)=>{reject=r;})).mockResolvedValueOnce({});
  const {dialog}=await open();const remove=within(dialog).getByRole('button',{name:entry.confirm});fireEvent.click(remove);fireEvent.click(remove);expect(fixture.remove).toHaveBeenCalledTimes(1);
  expect(within(dialog).getByRole('button',{name:'Cancel'})).toBeDisabled();fireEvent.keyDown(document.activeElement!,{key:'Escape'});expect(screen.getByRole('dialog')).toBeInTheDocument();
  await act(async()=>reject(new Error('synthetic failure')));expect(await screen.findByRole('alert')).toHaveTextContent('could not be deleted');
  fireEvent.click(within(dialog).getByRole('button',{name:entry.confirm}));await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(fixture.remove).toHaveBeenLastCalledWith(entry.payload);await waitFor(()=>expect(screen.getByRole('heading',{name:entry.heading})).toHaveFocus());
  expect(screen.getByRole('status')).toHaveTextContent(/deleted/);
 });
}
