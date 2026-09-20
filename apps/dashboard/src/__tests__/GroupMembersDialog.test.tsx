import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GroupsPage } from '../pages/GroupsPage';
const fixture=vi.hoisted(()=>({add:vi.fn(),remove:vi.fn(),create:vi.fn(),delete:vi.fn(),refetchGroups:vi.fn(),refetchMembers:vi.fn(),refetchAgents:vi.fn(),admin:true,membersError:false,membersEmpty:false,agentsError:false,agentsEmpty:false,groupsError:false,groupsEmpty:false}));
vi.mock('../store/authStore',()=>({useAuthStore:()=>({user:{role:fixture.admin?'admin':'agent'}})}));
vi.mock('../hooks/useGroups',()=>({
 useGroups:()=>({data:fixture.groupsEmpty?[]:[{id:'group-a',name:'Support',created_at:'2026-09-10'}],isLoading:false,isError:fixture.groupsError,refetch:fixture.refetchGroups}),
 useCreateGroup:()=>({mutateAsync:fixture.create}),useDeleteGroup:()=>({mutateAsync:fixture.delete}),
 useGroupMembers:()=>({data:fixture.membersEmpty?[]:[{id:'member-a',full_name:'Existing agent',email:'existing@example.invalid'}],isLoading:false,isError:fixture.membersError,refetch:fixture.refetchMembers}),
 useAgents:()=>({data:fixture.agentsEmpty?[]:[{id:'member-a',full_name:'Existing agent',email:'existing@example.invalid'},{id:'candidate-a',full_name:'Available agent',email:'available@example.invalid'}],isLoading:false,isError:fixture.agentsError,refetch:fixture.refetchAgents}),
 useAddMember:()=>({mutateAsync:fixture.add}),useRemoveMember:()=>({mutateAsync:fixture.remove}),
}));
beforeEach(()=>{
 fixture.admin=true;fixture.membersError=false;fixture.membersEmpty=false;fixture.agentsError=false;fixture.agentsEmpty=false;fixture.groupsError=false;fixture.groupsEmpty=false;
 // JSDOM has no layout; this supplies geometry only, not browser acceptance.
 vi.spyOn(HTMLElement.prototype,'getClientRects').mockImplementation(function(this:HTMLElement){return (this.isConnected&&!this.closest('[hidden]')?[new DOMRect(0,0,100,44)]:[]) as unknown as DOMRectList;});
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.resetAllMocks();});
async function openMembers(){
 render(<GroupsPage/>);const opener=screen.getByRole('button',{name:'Members'});opener.focus();fireEvent.click(opener);
 const dialog=await screen.findByRole('dialog',{name:'Manage Members: Support'});
 expect(dialog).toHaveAttribute('data-scope','dialog');expect(dialog).toHaveAttribute('data-part','content');expect(dialog).toHaveClass('dialog__content');
 expect(dialog.parentElement).toHaveClass('dialog__positioner');expect(document.querySelector('[data-scope="dialog"][data-part="backdrop"]')).toHaveClass('dialog__backdrop');
 expect(dialog.querySelector('[data-part="title"]')).toHaveTextContent('Manage Members: Support');
 await waitFor(()=>expect(within(dialog).getByRole('button',{name:'Close group members'})).toHaveFocus());return {opener,dialog};
}
it('keeps the Park table structure and unifies the member search icon with its input',async()=>{
 render(<GroupsPage/>);
 const table=screen.getByRole('table');
 expect(table.querySelector('tbody tr td')).toBeInTheDocument();
 expect(table.querySelector('tbody tr')?.className).not.toMatch(/d_flex|display_flex/);
 fireEvent.click(screen.getByRole('button',{name:'Members'}));
 const dialog=await screen.findByRole('dialog',{name:'Manage Members: Support'});
 expect(within(dialog).getByRole('textbox',{name:'Search agents'}).closest('[class*="input-group__root"]')).toBeInTheDocument();
});
it('offers a retryable empty state when the group list cannot be loaded',()=>{
 fixture.groupsError=true;fixture.groupsEmpty=true;
 render(<GroupsPage/>);
 expect(screen.getByRole('alert')).toHaveTextContent('Groups could not be loaded');
 fireEvent.click(screen.getByRole('button',{name:'Retry groups'}));
 expect(fixture.refetchGroups).toHaveBeenCalledOnce();
});
it('gives the zero-groups state the full card width instead of a four-column table cell', async () => {
 fixture.groupsEmpty=true;
 render(<GroupsPage/>);
 const empty=screen.getByRole('region',{name:'No groups found.'});
 expect(empty).toHaveClass('emptyState__root');
 expect(empty.parentElement).toHaveClass('card__body');
 expect(empty.closest('.card__root')).toBeInTheDocument();
 expect(empty.closest('table')).toBeNull();
 expect(screen.queryByRole('table')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Create Group'}));
 expect(await screen.findByRole('dialog',{name:'New Support Group'})).toBeInTheDocument();
});
it('keeps a non-admin zero-groups state without a create action', () => {
 fixture.groupsEmpty=true;fixture.admin=false;
 render(<GroupsPage/>);
 expect(screen.getByRole('region',{name:'No groups found.'})).toHaveTextContent('No groups are available in this workspace.');
 expect(screen.queryByRole('button',{name:'Create Group'})).not.toBeInTheDocument();
});
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
 const memberError=await screen.findByRole('alert');
 expect(memberError).toHaveClass('alert__root');expect(memberError).toHaveTextContent('Member could not be added');expect(search).toHaveValue('Available');
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
it('does not expose membership mutations to non-admins or offer adds with stale membership data',async()=>{
 fixture.admin=false;const {dialog}=await openMembers();expect(within(dialog).queryByRole('button',{name:/^(Add|Remove) /})).not.toBeInTheDocument();cleanup();
 fixture.admin=true;fixture.membersError=true;const reopened=await openMembers();
 const alert=within(reopened.dialog).getByRole('alert');
 expect(alert).toHaveClass('alert__root');expect(alert).toHaveTextContent('Group members could not be refreshed');
 expect(within(reopened.dialog).getByText('Existing agent')).toBeInTheDocument();
 expect(within(reopened.dialog).getByRole('button',{name:'Remove Existing agent'})).toBeDisabled();
 expect(within(reopened.dialog).getByRole('button',{name:'Add Available agent'})).toBeDisabled();
 fireEvent.click(within(reopened.dialog).getByRole('button',{name:'Retry members'}));
 expect(fixture.refetchMembers).toHaveBeenCalledOnce();
});

it('uses a retryable unavailable state rather than claiming no members on a failed first read',async()=>{
 fixture.membersError=true;fixture.membersEmpty=true;
 const {dialog}=await openMembers();
 expect(within(dialog).getByRole('alert')).toHaveTextContent('Group members could not be loaded');
 expect(within(dialog).getByRole('heading',{name:'Current Members'})).toBeInTheDocument();
 expect(within(dialog).queryByText('No members assigned yet.')).not.toBeInTheDocument();
 fireEvent.click(within(dialog).getByRole('button',{name:'Retry members'}));
 expect(fixture.refetchMembers).toHaveBeenCalledOnce();
});

it('retains stale agent rows behind a Park alert and suppresses false search results after refresh failure',async()=>{
 fixture.agentsError=true;
 const {dialog}=await openMembers();
 const alert=within(dialog).getByRole('alert');
 expect(alert).toHaveClass('alert__root');expect(alert).toHaveTextContent('Agents could not be refreshed');
 expect(within(dialog).getByRole('button',{name:'Add Available agent'})).toBeDisabled();
 fireEvent.change(within(dialog).getByRole('textbox',{name:'Search agents'}),{target:{value:'nobody'}});
 expect(within(dialog).queryByText('No matching agents found.')).not.toBeInTheDocument();
 fireEvent.click(within(dialog).getByRole('button',{name:'Retry agents'}));
 expect(fixture.refetchAgents).toHaveBeenCalledOnce();
});

it('uses a retryable unavailable state rather than an all-assigned claim when agents were never loaded',async()=>{
 fixture.agentsError=true;fixture.agentsEmpty=true;
 const {dialog}=await openMembers();
 expect(within(dialog).getByRole('alert')).toHaveTextContent('Agents could not be loaded');
 expect(within(dialog).queryByText('All available agents are already in this group.')).not.toBeInTheDocument();
 fireEvent.click(within(dialog).getByRole('button',{name:'Retry agents'}));
 expect(fixture.refetchAgents).toHaveBeenCalledOnce();
});

it('creates through labelled fields, retaining a failed draft and guarding duplicate submissions',async()=>{
 let reject!:(error:Error)=>void;fixture.create.mockImplementationOnce(()=>new Promise((_resolve,r)=>{reject=r;})).mockResolvedValueOnce({});
 render(<GroupsPage/>);const opener=screen.getByRole('button',{name:'Create Group'});opener.focus();fireEvent.click(opener);
 const dialog=await screen.findByRole('dialog',{name:'New Support Group'});const name=within(dialog).getByRole('textbox',{name:'Group Name'});
 expect(dialog).toHaveAttribute('data-scope','dialog');expect(dialog).toHaveAttribute('data-part','content');expect(dialog).toHaveClass('dialog__content');
 expect(dialog.parentElement).toHaveClass('dialog__positioner');expect(document.querySelector('[data-scope="dialog"][data-part="backdrop"]')).toHaveClass('dialog__backdrop');
 expect(dialog.querySelector('[data-part="title"]')).toHaveTextContent('New Support Group');
 expect(name.closest('[data-scope="field"][data-part="root"]')).toHaveClass('field__root');
 expect(name).toHaveAccessibleDescription('Use a short, clear team name.');
 const description=within(dialog).getByRole('textbox',{name:'Description (Optional)'});
 expect(description.closest('[data-scope="field"][data-part="root"]')).toHaveClass('field__root');
 expect(description).toHaveAccessibleDescription('Summarise the tickets this team handles.');
 await waitFor(()=>expect(name).toHaveFocus());fireEvent.change(name,{target:{value:'New team'}});
 fireEvent.change(description,{target:{value:'Synthetic team'}});
 const form=within(dialog).getByRole('form');
 expect(form.querySelector('.dialog__body')?.parentElement).toBe(form);
 expect(form.querySelector('.dialog__footer')?.parentElement).toBe(form);
 fireEvent.submit(form);fireEvent.submit(form);expect(fixture.create).toHaveBeenCalledTimes(1);
 expect(name).toBeDisabled();expect(within(dialog).getByRole('button',{name:'Close group editor'})).toBeDisabled();
 fireEvent.keyDown(document.activeElement!,{key:'Escape'});expect(screen.getByRole('dialog')).toBeInTheDocument();
 await act(async()=>reject(new Error('synthetic failure')));const createError=await screen.findByRole('alert');
 expect(createError).toHaveClass('alert__root');expect(createError).toHaveTextContent('Your draft has been kept');
 expect(name).toHaveValue('New team');fireEvent.submit(form);await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
 expect(fixture.create).toHaveBeenLastCalledWith({name:'New team',description:'Synthetic team'});await waitFor(()=>expect(opener).toHaveFocus());
});
it('preserves the existing cancelled group draft without submitting',async()=>{
 render(<GroupsPage/>);const opener=screen.getByRole('button',{name:'Create Group'});fireEvent.click(opener);
 const dialog=await screen.findByRole('dialog',{name:'New Support Group'});
 await waitFor(()=>expect(within(dialog).getByRole('textbox',{name:'Group Name'})).toHaveFocus());fireEvent.change(within(dialog).getByRole('textbox',{name:'Group Name'}),{target:{value:'Later'}});
 fireEvent.click(within(dialog).getByRole('button',{name:'Cancel'}));await waitFor(()=>expect(opener).toHaveFocus());
 fireEvent.click(opener);expect(await screen.findByRole('textbox',{name:'Group Name'})).toHaveValue('Later');expect(fixture.create).not.toHaveBeenCalled();
});
it('cancels group deletion safely and locks failed/retried deletion until completion',async()=>{
 let reject!:(error:Error)=>void;fixture.delete.mockImplementationOnce(()=>new Promise((_resolve,r)=>{reject=r;})).mockResolvedValueOnce({});
 render(<GroupsPage/>);const opener=screen.getByRole('button',{name:'Delete Support'});opener.focus();fireEvent.click(opener);
 let dialog=await screen.findByRole('dialog',{name:'Delete group: Support'});const cancel=within(dialog).getByRole('button',{name:'Cancel'});
 expect(dialog).toHaveAttribute('data-part','content');expect(dialog).toHaveClass('dialog__content');
 expect(dialog.parentElement).toHaveClass('dialog__positioner');expect(dialog.querySelector('[data-part="title"]')).toHaveTextContent('Delete group: Support');
 await waitFor(()=>expect(cancel).toHaveFocus());fireEvent.click(cancel);await waitFor(()=>expect(opener).toHaveFocus());expect(fixture.delete).not.toHaveBeenCalled();
 fireEvent.click(opener);dialog=await screen.findByRole('dialog',{name:'Delete group: Support'});
 const remove=within(dialog).getByRole('button',{name:'Delete group'});
 expect(remove).toHaveClass('button', 'button--variant_outline', 'color-palette_red');
 fireEvent.click(remove);fireEvent.click(remove);expect(fixture.delete).toHaveBeenCalledTimes(1);
 expect(within(dialog).getByRole('button',{name:'Cancel'})).toBeDisabled();fireEvent.keyDown(document.activeElement!,{key:'Escape'});expect(screen.getByRole('dialog')).toBeInTheDocument();
 await act(async()=>reject(new Error('synthetic failure')));const deleteError=await screen.findByRole('alert');
 expect(deleteError).toHaveClass('alert__root');expect(deleteError).toHaveTextContent('no active tickets');
 fireEvent.click(within(dialog).getByRole('button',{name:'Delete group'}));await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
 expect(fixture.delete).toHaveBeenLastCalledWith('group-a');expect(screen.getByRole('status')).toHaveTextContent('Group deleted.');
 await waitFor(()=>expect(screen.getByRole('heading',{name:'Group Management'})).toHaveFocus());
});
