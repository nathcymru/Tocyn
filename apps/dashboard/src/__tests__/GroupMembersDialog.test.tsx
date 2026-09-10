import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GroupsPage } from '../pages/GroupsPage';
const fixture=vi.hoisted(()=>({add:vi.fn(),remove:vi.fn(),admin:true,membersError:false}));
vi.mock('../store/authStore',()=>({useAuthStore:()=>({user:{role:fixture.admin?'admin':'agent'}})}));
vi.mock('../hooks/useGroups',()=>({
 useGroups:()=>({data:[{id:'group-a',name:'Support',created_at:'2026-09-10'}],isLoading:false}),
 useCreateGroup:()=>({mutateAsync:vi.fn()}),useDeleteGroup:()=>({mutateAsync:vi.fn()}),
 useGroupMembers:()=>({data:[{id:'member-a',full_name:'Existing agent',email:'existing@example.invalid'}],isLoading:false,isError:fixture.membersError}),
 useAgents:()=>({data:[{id:'member-a',full_name:'Existing agent',email:'existing@example.invalid'},{id:'candidate-a',full_name:'Available agent',email:'available@example.invalid'}],isLoading:false,isError:false}),
 useAddMember:()=>({mutateAsync:fixture.add}),useRemoveMember:()=>({mutateAsync:fixture.remove}),
}));
beforeEach(()=>{
 fixture.admin=true;fixture.membersError=false;
 // JSDOM has no layout; this supplies geometry only, not browser acceptance.
 vi.spyOn(HTMLElement.prototype,'getClientRects').mockImplementation(function(this:HTMLElement){return (this.isConnected&&!this.closest('[hidden]')?[new DOMRect(0,0,100,44)]:[]) as unknown as DOMRectList;});
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.resetAllMocks();});
async function openMembers(){
 render(<GroupsPage/>);const opener=screen.getByRole('button',{name:'Members'});opener.focus();fireEvent.click(opener);
 const dialog=await screen.findByRole('dialog',{name:'Manage Members: Support'});
 await waitFor(()=>expect(within(dialog).getByRole('button',{name:'Close group members'})).toHaveFocus());return {opener,dialog};
}
it('labels member actions and restores the opener on Escape',async()=>{
 const {opener,dialog}=await openMembers();
 expect(within(dialog).getByRole('button',{name:'Remove Existing agent'})).not.toHaveClass('opacity-0');
 expect(within(dialog).getByRole('button',{name:'Add Available agent'})).toBeEnabled();
 expect(within(dialog).queryByRole('button',{name:'Add Existing agent'})).not.toBeInTheDocument();
 fireEvent.keyDown(document.activeElement!,{key:'Escape'});
 await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());await waitFor(()=>expect(opener).toHaveFocus());
});
it('locks overlapping changes and dismissal, retains failed search, and retries the same payload',async()=>{
 let reject!:(error:Error)=>void;fixture.add.mockImplementationOnce(()=>new Promise((_resolve,r)=>{reject=r;})).mockResolvedValueOnce({});
 const {dialog}=await openMembers();const search=within(dialog).getByRole('textbox',{name:'Search agents'});
 fireEvent.change(search,{target:{value:'Available'}});const add=within(dialog).getByRole('button',{name:'Add Available agent'});
 fireEvent.click(add);fireEvent.click(add);expect(fixture.add).toHaveBeenCalledTimes(1);
 expect(within(dialog).getByRole('button',{name:'Close group members'})).toBeDisabled();expect(within(dialog).getByRole('button',{name:'Remove Existing agent'})).toBeDisabled();
 fireEvent.keyDown(document.activeElement!,{key:'Escape'});expect(screen.getByRole('dialog')).toBeInTheDocument();
 await act(async()=>reject(new Error('synthetic failure')));
 expect(await screen.findByRole('alert')).toHaveTextContent('Member could not be added');expect(search).toHaveValue('Available');
 fireEvent.click(add);await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('Member added.'));
 expect(fixture.add).toHaveBeenLastCalledWith({groupId:'group-a',userId:'candidate-a'});
 await waitFor(()=>expect(within(dialog).getByRole('button',{name:'Close group members'})).toHaveFocus());
});
it('requires confirmation before removal and supports cancellation',async()=>{
 fixture.remove.mockResolvedValue({});const {dialog}=await openMembers();
 fireEvent.click(within(dialog).getByRole('button',{name:'Remove Existing agent'}));expect(fixture.remove).not.toHaveBeenCalled();
 await waitFor(()=>expect(within(dialog).getByRole('button',{name:'Remove member'})).toHaveFocus());
 fireEvent.click(within(dialog).getByRole('button',{name:'Cancel removal'}));expect(fixture.remove).not.toHaveBeenCalled();
 fireEvent.click(within(dialog).getByRole('button',{name:'Remove Existing agent'}));
 fireEvent.click(within(dialog).getByRole('button',{name:'Remove member'}));
 await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('Member removed.'));
 expect(fixture.remove).toHaveBeenCalledWith({groupId:'group-a',userId:'member-a'});
});
it('does not expose membership mutations to non-admins or offer adds with unavailable membership data',async()=>{
 fixture.admin=false;const {dialog}=await openMembers();expect(within(dialog).queryByRole('button',{name:/^(Add|Remove) /})).not.toBeInTheDocument();cleanup();
 fixture.admin=true;fixture.membersError=true;const reopened=await openMembers();
 expect(within(reopened.dialog).getByRole('alert')).toHaveTextContent('Group members could not be loaded');
 expect(within(reopened.dialog).getByRole('button',{name:'Add Available agent'})).toBeDisabled();
});
