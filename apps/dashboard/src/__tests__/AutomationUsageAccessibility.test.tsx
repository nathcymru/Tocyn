import userEvent from '@testing-library/user-event';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { UsagePage } from '../pages/UsagePage';
import { ApiError } from '../api/client';
import { AutomationPage } from '../pages/AutomationPage';
const api=vi.hoisted(()=>({get:vi.fn(),post:vi.fn(),put:vi.fn(),patch:vi.fn(),delete:vi.fn()}));
vi.mock('../api/client',()=>({dashboardApi:api,ApiError:class ApiError extends Error {status:number;constructor(message:string,status:number){super(message);this.status=status;}}}));
afterEach(()=>{cleanup();vi.resetAllMocks();});
it('associates automation labels, exposes status state, and swaps conditional action controls',async()=>{
 api.get.mockResolvedValue([]);render(<AutomationPage/>);fireEvent.click(await screen.findByRole('button',{name:'Create Rule'}));
 expect(screen.getByRole('button',{name:'Close automation editor'})).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Add Condition'}));
 expect(screen.getByRole('combobox',{name:'Condition 1 field'})).toBeInTheDocument();
 expect(screen.getByRole('combobox',{name:'Condition 1 operator'})).toBeInTheDocument();
 expect(screen.getByRole('textbox',{name:'Condition 1 value'})).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Remove condition 1'}));
 expect(screen.queryByRole('textbox',{name:'Condition 1 value'})).not.toBeInTheDocument();
 expect(screen.getByRole('textbox',{name:'Rule Name'})).toBeInTheDocument();expect(screen.getByRole('combobox',{name:'Trigger Event'})).toBeInTheDocument();
 const action=screen.getByRole('combobox',{name:'Action Type'});expect(action).toBeInTheDocument();
 const status=screen.getByRole('button',{name:'Rule status'});expect(status).toHaveAttribute('aria-pressed','true');fireEvent.click(status);expect(status).toHaveAttribute('aria-pressed','false');
 expect(screen.getByRole('textbox',{name:'Webhook URL'})).toBeInTheDocument();expect(screen.getByRole('combobox',{name:'HTTP Method'})).toBeInTheDocument();
 await userEvent.click(action);await userEvent.click(await screen.findByRole('option',{name:/Retention/i}));await waitFor(()=>expect(screen.getByRole('spinbutton',{name:'Retention Period (Days)'})).toBeInTheDocument());expect(screen.queryByRole('textbox',{name:'Webhook URL'})).not.toBeInTheDocument();
});

it('shows a retryable Park empty state after an initial automation load failure',async()=>{
 api.get.mockRejectedValueOnce(new Error('Synthetic rules outage')).mockResolvedValueOnce([{id:'rule-a',name:'Synthetic rule',event_type:'ticket.created',action_type:'webhook',conditions:'malformed legacy conditions',action_config:'{}',is_active:true}]);
 render(<AutomationPage/>);
 expect(screen.getByRole('status',{name:'Loading automations'})).toHaveAttribute('aria-busy','true');
 expect(await screen.findByRole('alert')).toHaveTextContent('Automation rules could not be loaded');
 fireEvent.click(screen.getByRole('button',{name:'Retry automations'}));
 const name=await screen.findByText('Synthetic rule');
 expect(name.closest('[class*="card__root"]')).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Edit Synthetic rule'})).toBeInTheDocument();
});

it('retains last-loaded automation rules with a Park retry alert after refresh fails', async () => {
 const cached = {id:'rule-a',name:'Cached rule',event_type:'ticket.created',action_type:'webhook',conditions:'[]',action_config:'{}',is_active:true};
 const current = {...cached,name:'Current rule'};
 api.get.mockResolvedValueOnce([cached]).mockRejectedValueOnce(new Error('Synthetic refresh outage')).mockResolvedValueOnce([current]);
 render(<AutomationPage/>);
 expect(await screen.findByText('Cached rule')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Refresh automations'}));
 expect(screen.getByText('Cached rule')).toBeInTheDocument();
 const alert = await screen.findByRole('alert');
 expect(alert).toHaveTextContent('Automation rules could not be refreshed');
 expect(alert).toHaveTextContent('last loaded version');
 fireEvent.click(screen.getByRole('button',{name:'Retry automations refresh'}));
 await waitFor(()=>expect(screen.getByText('Current rule')).toBeInTheDocument());
 expect(screen.queryByText('Automation rules could not be refreshed')).not.toBeInTheDocument();
 expect(api.get).toHaveBeenCalledTimes(3);
});

it('names usage credential inputs when the local API reports missing configuration', async () => {
 api.get.mockRejectedValue(new ApiError('Synthetic credentials required',400));
 render(<UsagePage/>);
 const title = await screen.findByRole('heading',{name:'Cloudflare Credentials Required'});
 expect(title).toHaveClass('card__title');
 expect(title.closest('.card__root')).toBeInTheDocument();
 expect(screen.getByRole('note')).toHaveClass('alert__root');
 expect(await screen.findByRole('textbox',{name:'Cloudflare Account ID'})).toBeInTheDocument();
 expect(screen.getByLabelText('Cloudflare API Token')).toHaveAttribute('type','password');
 expect(api.post).not.toHaveBeenCalled();
});

it('keeps credential save and usage reload behavior inside the Park card', async () => {
 api.get.mockRejectedValueOnce(new ApiError('Synthetic credentials required',400)).mockResolvedValueOnce({});
 api.put.mockResolvedValue({});
 render(<UsagePage/>);
 await userEvent.type(await screen.findByRole('textbox',{name:'Cloudflare Account ID'}),'synthetic-account');
 await userEvent.type(screen.getByLabelText('Cloudflare API Token'),'synthetic-token');
 await userEvent.click(screen.getByRole('button',{name:'Save & View Usage'}));
 await waitFor(()=>expect(api.put).toHaveBeenCalledWith('/settings',{
   CLOUDFLARE_ACCOUNT_ID:'synthetic-account',CLOUDFLARE_API_TOKEN:'synthetic-token',
 }));
 await waitFor(()=>expect(api.get).toHaveBeenCalledTimes(2));
 expect(await screen.findByRole('heading',{name:'Usage & Costs'})).toBeInTheDocument();
});

it('shows Park skeletons during restore and a retryable empty state after a failed load', async () => {
 api.get.mockRejectedValueOnce(new Error('Synthetic usage outage')).mockResolvedValueOnce({});
 render(<UsagePage/>);
 expect(screen.getByLabelText('Loading usage data')).toHaveAttribute('aria-busy', 'true');
 expect(document.querySelector('.skeleton')).toBeInTheDocument();
 expect(await screen.findByText('Error loading usage data')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
 await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
});
