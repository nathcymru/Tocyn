import userEvent from '@testing-library/user-event';
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
 for(const label of ['Resend API Key','Default From Email']){
  const input=screen.getByLabelText(label);
  const field=input.closest('[data-scope="field"][data-part="root"]');
  expect(field).toHaveClass('field__root');
  expect(field?.querySelector('[data-scope="field"][data-part="label"]')).toHaveTextContent(label);
  expect(document.getElementById(input.getAttribute('aria-describedby')!)).toHaveClass('field__helperText');
 }
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
 for(const label of ['Email Address *','Display Name']){
  const input=screen.getByLabelText(label);
  expect(input.closest('[data-scope="field"][data-part="root"]')).toHaveClass('field__root');
  expect(input.closest('[data-scope="field"][data-part="root"]')?.querySelector('[data-part="label"]')).toHaveClass('field__label');
 }
 const group=screen.getByRole('combobox',{name:'Assign to Group'});
 expect(group).toHaveAttribute('data-scope','select');
 expect(screen.getByText('Assign to Group').closest('[data-scope="select"][data-part="label"]')).toHaveClass('select__label');
 expect(document.getElementById(group.getAttribute('aria-describedby')!)).toHaveClass('field__helperText');
 fireEvent.change(email,{target:{value:'new@example.invalid'}});
 fireEvent.change(screen.getByLabelText('Display Name'),{target:{value:'Synthetic support'}});
 await userEvent.click(screen.getByRole('combobox',{name:'Assign to Group'}));
 await userEvent.click(await screen.findByRole('option',{name:'Synthetic group'}));
 // Ark Select returns focus to its trigger on the next animation frame.
 // Let the selection close before submitting the separate email form.
 await act(async()=>{await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));});
 expect(screen.getByRole('combobox',{name:'Assign to Group'})).toHaveAttribute('aria-expanded','false');
 expect(screen.getByRole('combobox',{name:'Assign to Group'})).toHaveTextContent('Synthetic group');
 const form=screen.getByRole('form',{name:'Add support email'});fireEvent.submit(form);fireEvent.submit(form);
 await waitFor(()=>expect(api.post).toHaveBeenCalledTimes(1));expect(email).toBeDisabled();expect(screen.getByRole('button',{name:'Cancel'})).toBeDisabled();
 await act(async()=>reject(new Error('private error')));
 const alert=await screen.findByRole('alert');await waitFor(()=>expect(alert).toHaveFocus());expect(alert).toHaveTextContent('check the channel list before retrying');expect(email).toHaveValue('new@example.invalid');
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
it('renders loaded email addresses with Park card and badge anatomy',async()=>{
 api.get.mockImplementation(async(path:string)=>path==='/settings'?{RESEND_API_KEY:'••••••••',RESEND_FROM_EMAIL:'support@example.invalid'}:[{id:'email-a',email_address:'team@example.invalid',name:'Team',group_id:'group-a',is_default:true}]);
 open();
 const address=await screen.findByText('team@example.invalid');
 expect(address.closest('[class*="card__root"]')).toBeInTheDocument();
 expect(screen.getByText('Default').closest('[class*="badge"]')).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Remove team@example.invalid'})).toBeInTheDocument();
});
it('keeps cached provider settings and unsaved edits available after a failed background refresh',async()=>{
 let settingsRequests=0;
 api.get.mockImplementation(async(path:string)=>{
  if(path!=='/settings')return[];
  settingsRequests++;
  if(settingsRequests===2)throw new Error('synthetic refresh failure');
  return{RESEND_API_KEY:'••••••••',RESEND_FROM_EMAIL:'support@example.invalid'};
 });
 api.put.mockResolvedValue({});
 open();
 const from=await screen.findByLabelText('Default From Email');
 await waitFor(()=>expect(from).toHaveValue('support@example.invalid'));
 fireEvent.change(from,{target:{value:'edited@example.invalid'}});
 await act(async()=>{await client.invalidateQueries({queryKey:['settings']});});
 const alert=await screen.findByRole('alert');
 expect(alert).toHaveTextContent('Configuration refresh failed');
 expect(alert.className).toContain('alert__root');
 expect(from).toHaveValue('edited@example.invalid');
 expect(from).toBeEnabled();
 expect(screen.getByRole('button',{name:'Save Configuration'})).toBeDisabled();
 fireEvent.submit(screen.getByRole('form',{name:'Outbound email configuration'}));
 expect(api.put).not.toHaveBeenCalled();
 expect(screen.queryByText('Configuration could not be loaded.')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Retry configuration'}));
 await waitFor(()=>expect(screen.queryByText('Configuration refresh failed')).not.toBeInTheDocument());
 expect(from).toHaveValue('edited@example.invalid');
 expect(screen.getByRole('button',{name:'Save Configuration'})).toBeEnabled();
 fireEvent.submit(screen.getByRole('form',{name:'Outbound email configuration'}));
 await waitFor(()=>expect(api.put).toHaveBeenCalledWith('/settings',{RESEND_FROM_EMAIL:'edited@example.invalid'}));
});
it('retains cached channels and their actions after a failed background refresh',async()=>{
 let channelRequests=0;
 api.get.mockImplementation(async(path:string)=>{
  if(path==='/settings')return{RESEND_API_KEY:'••••••••',RESEND_FROM_EMAIL:'support@example.invalid'};
  channelRequests++;
  if(channelRequests===2)throw new Error('synthetic refresh failure');
  return[{id:'email-a',email_address:'team@example.invalid',name:'Team',group_id:'group-a',is_default:true}];
 });
 open();
 await screen.findByText('team@example.invalid');
 await act(async()=>{await client.invalidateQueries({queryKey:['support_emails']});});
 const alert=await screen.findByRole('alert');
 expect(alert).toHaveTextContent('Channel refresh failed');
 expect(alert.className).toContain('alert__root');
 expect(screen.getByText('team@example.invalid')).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Remove team@example.invalid'})).toBeEnabled();
 expect(screen.queryByText('Email channels could not be loaded.')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Retry channels'}));
 await waitFor(()=>expect(screen.queryByText('Channel refresh failed')).not.toBeInTheDocument());
 expect(screen.getByText('team@example.invalid')).toBeInTheDocument();
});
it('keeps the initial email-channel failure in a retryable empty state',async()=>{
 api.get.mockImplementation(async(path:string)=>{
  if(path==='/settings')return{RESEND_API_KEY:'••••••••',RESEND_FROM_EMAIL:'support@example.invalid'};
  throw new Error('synthetic initial failure');
 });
 open();
 expect(await screen.findByRole('alert')).toHaveTextContent('Email channels could not be loaded.');
 expect(screen.getByRole('button',{name:'Retry channels'})).toBeEnabled();
 expect(screen.queryByText('Channel refresh failed')).not.toBeInTheDocument();
});
