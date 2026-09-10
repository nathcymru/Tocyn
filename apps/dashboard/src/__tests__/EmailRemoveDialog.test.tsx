import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EmailChannelPage } from '../pages/EmailChannelPage';
const api=vi.hoisted(()=>({get:vi.fn(),delete:vi.fn()}));
vi.mock('../api/client',()=>({dashboardApi:api}));
vi.mock('../hooks/useGroups',()=>({useGroups:()=>({data:[]})}));
let client:QueryClient;
beforeEach(()=>{client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});api.get.mockImplementation(async(path:string)=>path==='/settings'?{}:[{id:'channel-a',email_address:'support@example.invalid',name:'Synthetic support',is_default:false}]);vi.spyOn(HTMLElement.prototype,'getClientRects').mockImplementation(function(this:HTMLElement){return (this.isConnected&&!this.closest('[hidden]')?[new DOMRect(0,0,100,44)]:[]) as unknown as DOMRectList;});});
afterEach(()=>{cleanup();client.clear();vi.restoreAllMocks();vi.resetAllMocks();});
async function open(){render(<QueryClientProvider client={client}><EmailChannelPage/></QueryClientProvider>);const opener=await screen.findByRole('button',{name:'Remove support@example.invalid'});opener.focus();fireEvent.click(opener);const dialog=await screen.findByRole('dialog',{name:'Remove email channel: support@example.invalid'});await waitFor(()=>expect(within(dialog).getByRole('button',{name:'Cancel'})).toHaveFocus());return{opener,dialog};}
it('requires confirmation and restores focus on cancellation without a provider or deletion request',async()=>{
 const {opener}=await open();fireEvent.keyDown(document.activeElement!,{key:'Escape'});await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());await waitFor(()=>expect(opener).toHaveFocus());expect(api.delete).not.toHaveBeenCalled();
});
it('guards pending removal and preserves an unconfirmed target for retry',async()=>{
 let reject!:(error:Error)=>void;api.delete.mockImplementationOnce(()=>new Promise((_resolve,r)=>{reject=r;})).mockResolvedValueOnce({});const {dialog}=await open();const remove=within(dialog).getByRole('button',{name:'Remove channel'});fireEvent.click(remove);fireEvent.click(remove);await waitFor(()=>expect(api.delete).toHaveBeenCalledTimes(1));
 expect(within(dialog).getByRole('button',{name:'Cancel'})).toBeDisabled();fireEvent.keyDown(document.activeElement!,{key:'Escape'});expect(screen.getByRole('dialog')).toBeInTheDocument();await act(async()=>reject(new Error('synthetic failure')));
 expect(await screen.findByRole('alert')).toHaveTextContent('could not be confirmed');expect(dialog).toHaveTextContent('support@example.invalid');fireEvent.click(within(dialog).getByRole('button',{name:'Remove channel'}));await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
 expect(api.delete).toHaveBeenLastCalledWith('/channels/emails/channel-a');expect(screen.getByRole('status')).toHaveTextContent('Email channel removed.');await waitFor(()=>expect(screen.getByRole('heading',{name:'Email Channels'})).toHaveFocus());
});
