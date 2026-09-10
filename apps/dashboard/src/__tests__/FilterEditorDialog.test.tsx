import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FiltersSettingsPage } from '../pages/FiltersSettingsPage';
const mutations=vi.hoisted(()=>({create:vi.fn(),update:vi.fn(),remove:vi.fn()}));
vi.mock('../hooks/useFilters',()=>({useFilters:()=>({data:[],isLoading:false}),useCreateFilter:()=>({mutateAsync:mutations.create,isPending:false}),useUpdateFilter:()=>({mutateAsync:mutations.update,isPending:false}),useDeleteFilter:()=>({mutateAsync:mutations.remove,isPending:false})}));
beforeEach(()=>{vi.spyOn(HTMLElement.prototype,'getClientRects').mockImplementation(function(this:HTMLElement){return (this.isConnected&&!this.closest('[hidden]')?[new DOMRect(0,0,100,44)]:[]) as unknown as DOMRectList;});});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.resetAllMocks();});
async function openEditor(){
 render(<FiltersSettingsPage/>);const opener=screen.getByRole('button',{name:'Create Filter'});opener.focus();fireEvent.click(opener);
 const dialog=await screen.findByRole('dialog',{name:'Create Filter'});const name=within(dialog).getByRole('textbox',{name:'Filter Name'});
 await waitFor(()=>expect(name).toHaveFocus());return {opener,dialog,name};
}
it('bounds duplicate submissions and preserves the dialog through pending Escape, then returns focus on success',async()=>{
 let finish!:()=>void;mutations.create.mockImplementation(()=>new Promise(resolve=>{finish=()=>resolve({});}));
 const {opener,dialog,name}=await openEditor();fireEvent.change(name,{target:{value:'Synthetic filter'}});
 const form=within(dialog).getByRole('form',{name:'Create Filter'});fireEvent.submit(form);fireEvent.submit(form);
 expect(mutations.create).toHaveBeenCalledTimes(1);expect(name).toBeDisabled();
 expect(within(dialog).getByRole('button',{name:'Close filter editor'})).toBeDisabled();
 fireEvent.keyDown(document.activeElement!,{key:'Escape'});expect(screen.getByRole('dialog')).toBeInTheDocument();
 await act(async()=>finish());await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
 await waitFor(()=>expect(opener).toHaveFocus());
});
it('retains a failed draft and sends its labelled conditions on retry',async()=>{
 mutations.create.mockRejectedValueOnce(new Error('synthetic failure')).mockResolvedValueOnce({});
 const {dialog,name}=await openEditor();fireEvent.change(name,{target:{value:'Keep my draft'}});
 fireEvent.click(within(dialog).getByRole('button',{name:'Add Condition'}));
 expect(within(dialog).getByRole('combobox',{name:'Condition 1 field'})).toBeInTheDocument();
 expect(within(dialog).getByRole('combobox',{name:'Condition 1 operator'})).toBeInTheDocument();
 fireEvent.change(within(dialog).getByRole('textbox',{name:'Condition 1 value'}),{target:{value:'open'}});
 fireEvent.submit(within(dialog).getByRole('form'));
 expect(await screen.findByRole('alert')).toHaveTextContent('Your changes have been kept');expect(name).toHaveValue('Keep my draft');
 fireEvent.submit(within(dialog).getByRole('form'));await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
 expect(mutations.create).toHaveBeenCalledTimes(2);expect(mutations.create.mock.calls[1][0]).toMatchObject({name:'Keep my draft',conditions:[{value:'open'}]});
});
it('cancels by Escape without submitting and restores the opener',async()=>{
 const {opener}=await openEditor();fireEvent.keyDown(document.activeElement!,{key:'Escape'});
 await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());await waitFor(()=>expect(opener).toHaveFocus());expect(mutations.create).not.toHaveBeenCalled();
});
