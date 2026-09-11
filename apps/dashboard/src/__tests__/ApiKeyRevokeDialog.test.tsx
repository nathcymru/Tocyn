import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiKeyPage } from '../pages/ApiKeyPage';
const api=vi.hoisted(()=>({get:vi.fn(),post:vi.fn(),delete:vi.fn()}));
vi.mock('../api/client',()=>({dashboardApi:api}));
const originalClipboard=Object.getOwnPropertyDescriptor(navigator,'clipboard');
const key={id:'key-a',name:'Synthetic key',prefix:'fixture',created_at:'2026-09-10'};
beforeEach(()=>{api.get.mockResolvedValue([key]);vi.spyOn(HTMLElement.prototype,'getClientRects').mockImplementation(function(this:HTMLElement){return (this.isConnected&&!this.closest('[hidden]')?[new DOMRect(0,0,100,44)]:[]) as unknown as DOMRectList;});});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.resetAllMocks();if(originalClipboard)Object.defineProperty(navigator,'clipboard',originalClipboard);else Reflect.deleteProperty(navigator,'clipboard');});
async function confirm(name='Synthetic key'){
 const opener=await screen.findByRole('button',{name:`Revoke ${name}`});opener.focus();fireEvent.click(opener);
 const dialog=await screen.findByRole('dialog',{name:`Revoke API key: ${name}`});await waitFor(()=>expect(within(dialog).getByRole('button',{name:'Cancel'})).toHaveFocus());return{opener,dialog};
}
it('cancels revocation and returns focus without sending a mutation',async()=>{
 render(<ApiKeyPage/>);const {opener}=await confirm();fireEvent.keyDown(document.activeElement!,{key:'Escape'});
 await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());await waitFor(()=>expect(opener).toHaveFocus());expect(api.delete).not.toHaveBeenCalled();
});
it('retains a failed target, blocks duplicate/pending dismissal, and removes only an acknowledged revocation',async()=>{
 let reject!:(error:Error)=>void;api.delete.mockImplementationOnce(()=>new Promise((_resolve,r)=>{reject=r;})).mockResolvedValueOnce({});
 render(<ApiKeyPage/>);const {dialog}=await confirm();const revoke=within(dialog).getByRole('button',{name:'Revoke key'});fireEvent.click(revoke);fireEvent.click(revoke);expect(api.delete).toHaveBeenCalledTimes(1);
 expect(within(dialog).getByRole('button',{name:'Cancel'})).toBeDisabled();fireEvent.keyDown(document.activeElement!,{key:'Escape'});expect(screen.getByRole('dialog')).toBeInTheDocument();
 await act(async()=>reject(new Error('synthetic untrusted failure text')));expect(await screen.findByRole('alert')).toHaveTextContent('could not be confirmed');expect(screen.queryByText('synthetic untrusted failure text')).not.toBeInTheDocument();
 fireEvent.click(within(dialog).getByRole('button',{name:'Revoke key'}));await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
 expect(api.delete).toHaveBeenLastCalledWith('/api-keys/key-a');expect(screen.queryByRole('button',{name:'Revoke Synthetic key'})).not.toBeInTheDocument();expect(screen.getByRole('status')).toHaveTextContent('API key revoked.');
 await waitFor(()=>expect(screen.getByRole('heading',{name:'API Keys'})).toHaveFocus());
});
async function create(){
 fireEvent.click(screen.getByRole('button',{name:'Create New Key'}));const input=await screen.findByRole('textbox',{name:'Key Name'});await waitFor(()=>expect(input).toHaveFocus());fireEvent.change(input,{target:{value:'Created key'}});fireEvent.submit(input.closest('form')!);
 await screen.findByText('synthetic-one-time-value');
}
it('clears the matching one-time display after successful revocation',async()=>{
 api.post.mockResolvedValue({id:'key-a',name:key.name,apiKey:'synthetic-one-time-value'});api.delete.mockResolvedValue({});render(<ApiKeyPage/>);await screen.findByRole('button',{name:'Revoke Synthetic key'});await create();
 const {dialog}=await confirm();fireEvent.click(within(dialog).getByRole('button',{name:'Revoke key'}));await waitFor(()=>expect(screen.queryByText('synthetic-one-time-value')).not.toBeInTheDocument());
});
it('does not resurrect a revoked row when an earlier list refresh resolves late',async()=>{
 let refresh!:(value:unknown)=>void;api.get.mockResolvedValueOnce([key]).mockImplementationOnce(()=>new Promise(resolve=>{refresh=resolve;}));
 api.post.mockResolvedValue({id:'key-b',name:'Created key',apiKey:'synthetic-one-time-value'});api.delete.mockResolvedValue({});render(<ApiKeyPage/>);await screen.findByRole('button',{name:'Revoke Synthetic key'});await create();
 const {dialog}=await confirm();fireEvent.click(within(dialog).getByRole('button',{name:'Revoke key'}));await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
 await act(async()=>refresh([key,{...key,id:'key-b',name:'Created key'}]));expect(screen.queryByRole('button',{name:'Revoke Synthetic key'})).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Revoke Created key'})).toBeInTheDocument();expect(screen.getByText('synthetic-one-time-value')).toBeInTheDocument();
});

it('guards creation and retains the name after an uncertain result before an explicit retry',async()=>{
 let reject!:(error:Error)=>void;api.post.mockImplementationOnce(()=>new Promise((_resolve,r)=>{reject=r;})).mockResolvedValueOnce({id:'key-b',name:'Draft',apiKey:'synthetic-one-time-value'});
 render(<ApiKeyPage/>);fireEvent.click(screen.getByRole('button',{name:'Create New Key'}));const dialog=await screen.findByRole('dialog',{name:'Create New API Key'});
 const name=within(dialog).getByRole('textbox',{name:'Key Name'});await waitFor(()=>expect(name).toHaveFocus());fireEvent.change(name,{target:{value:'Draft'}});const form=within(dialog).getByRole('form');
 fireEvent.submit(form);fireEvent.submit(form);expect(api.post).toHaveBeenCalledTimes(1);expect(name).toBeDisabled();expect(within(dialog).getByRole('button',{name:'Cancel'})).toBeDisabled();
 fireEvent.keyDown(document.activeElement!,{key:'Escape'});expect(screen.getByRole('dialog')).toBeInTheDocument();
 await act(async()=>reject(new Error('synthetic uncertain response')));expect(await screen.findByRole('alert')).toHaveTextContent('could not be confirmed');expect(name).toHaveValue('Draft');
 expect(api.get).toHaveBeenCalledTimes(2);fireEvent.submit(form);await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
 const firstHeaders=new Headers(api.post.mock.calls[0][2]?.headers);const retryHeaders=new Headers(api.post.mock.calls[1][2]?.headers);
 expect(firstHeaders.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);expect(retryHeaders.get('Idempotency-Key')).toBe(firstHeaders.get('Idempotency-Key'));
 expect(api.post).toHaveBeenLastCalledWith('/api-keys',{name:'Draft'},expect.objectContaining({headers:expect.any(Object)}));await waitFor(()=>expect(screen.getByRole('heading',{name:'New API Key Generated'})).toHaveFocus());
});
it('shows metadata-only uncertain creation and requires revocation before a replacement',async()=>{
 api.post.mockRejectedValue({code:'api_key_plaintext_unavailable',body:{code:'api_key_plaintext_unavailable',key:{id:'key-u',name:'Uncertain',prefix:'uncertain',created_at:'2026-09-11'}}});
 api.delete.mockResolvedValue({});render(<ApiKeyPage/>);fireEvent.click(screen.getByRole('button',{name:'Create New Key'}));
 const input=await screen.findByRole('textbox',{name:'Key Name'});fireEvent.change(input,{target:{value:'Uncertain'}});fireEvent.submit(input.closest('form')!);
 const warning=await screen.findByRole('alert');expect(warning).toHaveTextContent('plaintext unavailable');expect(warning).toHaveTextContent('uncertain');
 await waitFor(()=>expect(within(warning).getByRole('heading',{name:'API key created; plaintext unavailable'})).toHaveFocus());
 expect(warning).not.toHaveTextContent('synthetic-one-time-value');expect(screen.getByRole('button',{name:'Create New Key'})).toBeDisabled();
 fireEvent.click(within(warning).getByRole('button',{name:'Revoke unavailable key'}));const dialog=await screen.findByRole('dialog',{name:'Revoke API key: Uncertain'});
 fireEvent.click(within(dialog).getByRole('button',{name:'Revoke key'}));await waitFor(()=>expect(screen.queryByText(/plaintext unavailable/i)).not.toBeInTheDocument());
 expect(api.delete).toHaveBeenLastCalledWith('/api-keys/key-u');expect(screen.getByRole('button',{name:'Create New Key'})).toBeEnabled();
});
it('reports clipboard success only after resolution and keeps copy failures recoverable',async()=>{
 const write=vi.fn();let finish!:()=>void;write.mockImplementationOnce(()=>Promise.reject(new Error('synthetic clipboard failure'))).mockImplementationOnce(()=>new Promise(resolve=>{finish=()=>resolve(undefined);}));
 Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:write}});
 api.post.mockResolvedValue({id:'key-b',name:'Created key',apiKey:'synthetic-one-time-value'});render(<ApiKeyPage/>);await create();const copy=screen.getByRole('button',{name:'Copy API key'});
 fireEvent.click(copy);expect(await screen.findByRole('alert')).toHaveTextContent('could not be copied');expect(screen.queryByText('API key copied.')).not.toBeInTheDocument();
 fireEvent.click(copy);fireEvent.click(copy);expect(copy).toBeDisabled();expect(write).toHaveBeenCalledTimes(2);expect(screen.queryByText('API key copied.')).not.toBeInTheDocument();
 await act(async()=>finish());expect(screen.getByText('API key copied.')).toBeInTheDocument();expect(write).toHaveBeenLastCalledWith('synthetic-one-time-value');
 fireEvent.click(screen.getByRole('button',{name:"I've saved my key"}));expect(screen.queryByText('synthetic-one-time-value')).not.toBeInTheDocument();expect(screen.queryByText('API key copied.')).not.toBeInTheDocument();
});

it('reports unavailable key metadata instead of claiming an empty key list',async()=>{
 api.get.mockRejectedValue(new Error('synthetic list failure'));render(<ApiKeyPage/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('could not be refreshed');expect(screen.getByText('API key list unavailable.')).toBeInTheDocument();expect(screen.queryByText('No API keys found.')).not.toBeInTheDocument();
});

it('restores keyboard focus to retry when an uncertain creation is reopened',async()=>{
 api.post.mockRejectedValue(new Error('synthetic lost response'));render(<ApiKeyPage/>);
 fireEvent.click(screen.getByRole('button',{name:'Create New Key'}));
 const input=await screen.findByRole('textbox',{name:'Key Name'});fireEvent.change(input,{target:{value:'Draft'}});fireEvent.submit(input.closest('form')!);
 await screen.findByRole('button',{name:'Retry creation'});fireEvent.click(screen.getByRole('button',{name:'Cancel'}));
 await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());fireEvent.click(screen.getByRole('button',{name:'Create New Key'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Retry creation'})).toHaveFocus());
});
