import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EmailChannelPage } from '../pages/EmailChannelPage';
const api = vi.hoisted(() => ({get:vi.fn(), post:vi.fn(), put:vi.fn(), delete:vi.fn()}));
vi.mock('../api/client', () => ({dashboardApi:api}));
vi.mock('../hooks/useGroups', () => ({useGroups:() => ({data:[{id:'group-a',name:'Synthetic group'}]})}));
let client: QueryClient;
beforeEach(() => {
 client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
 api.get.mockImplementation(async(path:string) => path==='/settings'?{RESEND_API_KEY:'••••••••',RESEND_FROM_EMAIL:'support@example.invalid'}:[]);
});
afterEach(() => {cleanup();client.clear();vi.resetAllMocks();});
function open(){render(<QueryClientProvider client={client}><EmailChannelPage/></QueryClientProvider>);}
it('keeps provider failure visible independently of add email, prevents duplicate saves and retains edits across refetch',async()=>{
 let reject!:(e:Error)=>void;
 api.put.mockImplementationOnce(()=>new Promise((_r,j)=>{reject=j;})).mockResolvedValueOnce({});
 open();const from=await screen.findByLabelText('Default From Email');
 await waitFor(()=>expect(from).toHaveValue('support@example.invalid'));
 fireEvent.change(from,{target:{value:'changed@example.invalid'}});
 await act(async()=>{await client.invalidateQueries({queryKey:['settings']});});
 expect(from).toHaveValue('changed@example.invalid');
 const form=screen.getByRole('form',{name:'Outbound email configuration'});
 fireEvent.submit(form);fireEvent.submit(form);
 expect(api.put).toHaveBeenCalledTimes(1);expect(from).toBeDisabled();
 await act(async()=>reject(new Error('private provider detail')));
 expect(await screen.findByRole('alert')).toHaveTextContent('Configuration save could not be confirmed');
 expect(screen.queryByText('private provider detail')).not.toBeInTheDocument();
 expect(from).toHaveValue('changed@example.invalid');
 fireEvent.submit(form);
 await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('delivery has not been verified'));
 expect(api.put).toHaveBeenLastCalledWith('/settings',{RESEND_FROM_EMAIL:'changed@example.invalid'});
});
it('prevents a failed settings load from enabling writes and supports explicit retry',async()=>{
 api.get.mockImplementation(async(path:string)=>{if(path==='/settings')throw new Error('private failure');return[];});
 open();expect(await screen.findByRole('alert')).toHaveTextContent('Configuration could not be loaded');
 expect(screen.getByLabelText('Resend API Key')).toBeDisabled();
 fireEvent.submit(screen.getByRole('form',{name:'Outbound email configuration'}));expect(api.put).not.toHaveBeenCalled();
 api.get.mockImplementation(async(path:string)=>path==='/settings'?{RESEND_API_KEY:'••••••••',RESEND_FROM_EMAIL:'support@example.invalid'}:[]);
 fireEvent.click(screen.getByRole('button',{name:'Retry configuration'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Save Configuration'})).toBeEnabled());
});
it('labels the add form, guards pending creation and retains failed entries with focus and cancellation recovery',async()=>{
 let reject!:(e:Error)=>void;api.post.mockImplementationOnce(()=>new Promise((_r,j)=>{reject=j;}));
 open();const opener=screen.getByRole('button',{name:'Add Email'});fireEvent.click(opener);
 const email=screen.getByLabelText('Email Address *');expect(email).toHaveFocus();
 fireEvent.change(email,{target:{value:'new@example.invalid'}});
 fireEvent.change(screen.getByLabelText('Display Name'),{target:{value:'Synthetic support'}});
 fireEvent.change(screen.getByLabelText('Assign to Group'),{target:{value:'group-a'}});
 const form=screen.getByRole('form',{name:'Add support email'});fireEvent.submit(form);fireEvent.submit(form);
 await waitFor(()=>expect(api.post).toHaveBeenCalledTimes(1));expect(email).toBeDisabled();expect(screen.getByRole('button',{name:'Cancel'})).toBeDisabled();
 await act(async()=>reject(new Error('private error')));
 const alert=await screen.findByRole('alert');expect(alert).toHaveFocus();expect(alert).toHaveTextContent('check the channel list before retrying');expect(email).toHaveValue('new@example.invalid');
 expect(api.post).toHaveBeenCalledWith('/channels/emails',{email_address:'new@example.invalid',name:'Synthetic support',group_id:'group-a',is_default:false});
 fireEvent.click(screen.getByRole('button',{name:'Cancel'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Add Email'})).toHaveFocus());
 fireEvent.click(screen.getByRole('button',{name:'Add Email'}));expect(screen.getByLabelText('Email Address *')).toHaveValue('new@example.invalid');
});
it('announces saved configuration without claiming provider delivery and returns to the add opener',async()=>{
 api.post.mockResolvedValue({id:'synthetic'});open();fireEvent.click(screen.getByRole('button',{name:'Add Email'}));
 fireEvent.change(screen.getByLabelText('Email Address *'),{target:{value:'new@example.invalid'}});
 fireEvent.submit(screen.getByRole('form',{name:'Add support email'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Add Email'})).toHaveFocus());
 expect(screen.getByRole('status')).toHaveTextContent('Provider delivery has not been verified');
});
