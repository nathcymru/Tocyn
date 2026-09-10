import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WidgetChannelPage } from '../pages/WidgetChannelPage';
const api=vi.hoisted(()=>({get:vi.fn(),put:vi.fn()}));
vi.mock('../api/client',()=>({dashboardApi:api}));
const initial={'widget.features.aiChat':'true','widget.features.ticketForm':'true'};
const clipboardDescriptor=Object.getOwnPropertyDescriptor(navigator,'clipboard');let client:QueryClient;
beforeEach(()=>{api.get.mockResolvedValue(initial);client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});});
afterEach(()=>{cleanup();client.clear();vi.resetAllMocks();if(clipboardDescriptor)Object.defineProperty(navigator,'clipboard',clipboardDescriptor);else Reflect.deleteProperty(navigator,'clipboard');});
async function open(){render(<QueryClientProvider client={client}><WidgetChannelPage/></QueryClientProvider>);const chat=await screen.findByRole('checkbox',{name:'Chat Enabled'});await waitFor(()=>expect(chat).toBeEnabled());return{chat,save:screen.getByRole('button',{name:'Save Changes'})};}
it('guards duplicate saves, retains a failed choice and permits an explicit retry',async()=>{
 let reject!:(error:Error)=>void;api.put.mockImplementationOnce(()=>new Promise((_resolve,r)=>{reject=r;})).mockResolvedValueOnce({});
 const {chat,save}=await open();fireEvent.click(chat);expect(chat).not.toBeChecked();fireEvent.click(save);fireEvent.click(save);await waitFor(()=>expect(api.put).toHaveBeenCalledTimes(1));expect(chat).toBeDisabled();
 await act(async()=>reject(new Error('synthetic failure')));expect(await screen.findByRole('alert')).toHaveTextContent('Your choices have been kept');expect(chat).not.toBeChecked();expect(save).toBeEnabled();
 api.get.mockResolvedValue({...initial,'widget.features.aiChat':'false'});fireEvent.click(save);
 expect(await screen.findByRole('status')).toHaveTextContent('Widget settings saved.');expect(api.put).toHaveBeenLastCalledWith('/settings',{'widget.features.aiChat':'false','widget.features.ticketForm':'true'});await waitFor(()=>expect(save).toBeEnabled());
});
it('preserves unsaved choices across a background settings update',async()=>{
 const {chat}=await open();expect(chat).toHaveAccessibleDescription('Allow customers to chat with the AI support agent.');fireEvent.click(chat);
 await act(async()=>{client.setQueryData(['settings'],{...initial,unrelated:'new'});});expect(chat).not.toBeChecked();expect(api.put).not.toHaveBeenCalled();
});
it('blocks saving unavailable settings instead of writing defaults',async()=>{
 api.get.mockRejectedValue(new Error('synthetic unavailable'));render(<QueryClientProvider client={client}><WidgetChannelPage/></QueryClientProvider>);
 expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');expect(screen.getByRole('button',{name:'Save Changes'})).toBeDisabled();expect(api.put).not.toHaveBeenCalled();
});
it('waits for clipboard success and recovers from failure without claiming an installed widget',async()=>{
 let finish!:()=>void;const write=vi.fn().mockRejectedValueOnce(new Error('synthetic clipboard failure')).mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve;}));Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:write}});
 await open();const copy=screen.getByRole('button',{name:'Copy Snippet'});fireEvent.click(copy);expect(await screen.findByRole('alert')).toHaveTextContent('could not be copied');expect(screen.queryByText('Snippet copied.')).not.toBeInTheDocument();
 fireEvent.click(copy);fireEvent.click(copy);expect(write).toHaveBeenCalledTimes(2);expect(copy).toBeDisabled();expect(screen.queryByText('Snippet copied.')).not.toBeInTheDocument();await act(async()=>finish());expect(screen.getByRole('status')).toHaveTextContent('Snippet copied.');
 const snippet=write.mock.calls[1][0];expect(snippet).toContain('data-widget-key="YOUR_PUBLIC_WIDGET_KEY"');expect(snippet).not.toContain('LUMINA_WIDGET_CONFIG');expect(screen.getByText(/Integration example:/)).toBeInTheDocument();
});
