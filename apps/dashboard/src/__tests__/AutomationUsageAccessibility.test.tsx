import userEvent from '@testing-library/user-event';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { UsagePage } from '../pages/UsagePage';
import { ApiError } from '../api/client';
import { AutomationPage } from '../pages/AutomationPage';
const api=vi.hoisted(()=>({get:vi.fn(),post:vi.fn(),put:vi.fn(),patch:vi.fn(),delete:vi.fn()}));
const usageStats = {
 d1: { readQueries: 0, writeQueries: 0, rowsRead: 0, rowsWritten: 0 },
 r2: { classAOperations: 0, classBOperations: 0 },
 workersAi: { neurons: 0 },
 workers: { requests: 0, cpuTime: 0 },
};
vi.mock('../api/client',()=>({dashboardApi:api,ApiError:class ApiError extends Error {status:number;constructor(message:string,status:number){super(message);this.status=status;}}}));
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();vi.resetAllMocks();});
it('associates automation labels, exposes status state, and swaps conditional action controls',async()=>{
 api.get.mockResolvedValue([]);render(<AutomationPage/>);fireEvent.click(await screen.findByRole('button',{name:'Create Rule'}));
 expect(screen.getByRole('button',{name:'Close automation editor'})).toBeInTheDocument();
 const empty=screen.getByRole('region',{name:'No conditions added'});
 expect(empty).toHaveClass('emptyState__root');
 expect(empty).toHaveTextContent('This rule will always run for the selected event.');
 fireEvent.click(screen.getByRole('button',{name:'Add Condition'}));
 expect(screen.queryByRole('region',{name:'No conditions added'})).not.toBeInTheDocument();
 expect(screen.getByRole('combobox',{name:'Condition 1 field'})).toBeInTheDocument();
 expect(screen.getByRole('combobox',{name:'Condition 1 operator'})).toBeInTheDocument();
 expect(screen.getByRole('textbox',{name:'Condition 1 value'})).toBeInTheDocument();
 expect(screen.getByRole('combobox',{name:'Condition 1 field'}).closest('[data-scope="select"][data-part="root"]')).toHaveTextContent('Condition 1 field');
 expect(screen.getByRole('combobox',{name:'Condition 1 operator'}).closest('[data-scope="select"][data-part="root"]')).toHaveTextContent('Condition 1 operator');
 expect(screen.getByRole('textbox',{name:'Condition 1 value'}).closest('[data-scope="field"][data-part="root"]')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Remove condition 1'}));
 expect(screen.queryByRole('textbox',{name:'Condition 1 value'})).not.toBeInTheDocument();
 expect(screen.getByRole('region',{name:'No conditions added'})).toBeInTheDocument();
 expect(screen.getByRole('textbox',{name:'Rule Name'}).closest('[data-scope="field"][data-part="root"]')).toBeInTheDocument();
 expect(screen.getByRole('combobox',{name:'Trigger Event'}).closest('[data-scope="select"][data-part="root"]')).toHaveTextContent('Trigger Event');
 const action=screen.getByRole('combobox',{name:'Action Type'});expect(action).toBeInTheDocument();
 expect(action.closest('[data-scope="select"][data-part="root"]')).toHaveTextContent('Action Type');
 const status=screen.getByRole('button',{name:'Rule status'});expect(status).toHaveAttribute('aria-pressed','true');fireEvent.click(status);expect(status).toHaveAttribute('aria-pressed','false');
 expect(screen.getByRole('textbox',{name:'Webhook URL'}).closest('[data-scope="field"][data-part="root"]')).toBeInTheDocument();
 expect(screen.getByRole('combobox',{name:'HTTP Method'}).closest('[data-scope="select"][data-part="root"]')).toHaveTextContent('HTTP Method');
 await userEvent.click(action);await userEvent.click(await screen.findByRole('option',{name:/Retention/i}));
 await waitFor(()=>expect(screen.getByRole('spinbutton',{name:'Retention Period (Days)'}).closest('[data-scope="field"][data-part="root"]')).toBeInTheDocument());
 expect(screen.queryByRole('textbox',{name:'Webhook URL'})).not.toBeInTheDocument();
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

it('uses Park dialog anatomy and fences automation deletion through focus, Escape and busy retry', async () => {
 const rule = {id:'rule-a',name:'Synthetic rule',event_type:'ticket.created',action_type:'webhook',conditions:'[]',action_config:'{}',is_active:true};
 api.get.mockResolvedValue([rule]);
 let rejectDelete!: (error: Error) => void;
 api.delete.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectDelete = reject; })).mockResolvedValueOnce({});
 vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function(this: HTMLElement) {
   return (this.isConnected && !this.closest('[hidden]') ? [new DOMRect(0, 0, 100, 44)] : []) as unknown as DOMRectList;
 });
 vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
 render(<AutomationPage/>);
 const opener = await screen.findByRole('button', { name: 'Delete Synthetic rule' });
 await userEvent.click(opener);
 let dialog = await screen.findByRole('dialog', { name: 'Delete rule: Synthetic rule' });
 expect(dialog).toHaveClass('dialog__content');
 expect(dialog).toHaveAccessibleDescription('Delete this automation rule? This action cannot be undone.');
 expect(document.querySelector('.dialog__backdrop')).toBeInTheDocument();
 expect(dialog.querySelector('.dialog__header .dialog__title')).toHaveTextContent('Delete rule: Synthetic rule');
 expect(dialog.querySelector('.dialog__body .dialog__description')).toHaveTextContent('This action cannot be undone.');
 expect(dialog.querySelector('.dialog__footer')).toContainElement(screen.getByRole('button', { name: 'Cancel' }));
 await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus());
 fireEvent.pointerDown(document.body); fireEvent.click(document.body);
 expect(dialog).toBeInTheDocument();
 await userEvent.keyboard('{Escape}');
 await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
 await waitFor(() => expect(opener).toHaveFocus());

 await userEvent.click(opener);
 dialog = await screen.findByRole('dialog', { name: 'Delete rule: Synthetic rule' });
 await userEvent.click(screen.getByRole('button', { name: 'Delete rule' }));
 expect(screen.getByRole('button', { name: 'Deleting...' })).toBeDisabled();
 expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
 await userEvent.keyboard('{Escape}');
 expect(dialog).toBeInTheDocument();
 await act(async () => rejectDelete(new Error('Synthetic delete failure')));
 const alert = await screen.findByRole('alert');
 expect(alert).toHaveClass('alert__root');
 expect(alert).toHaveTextContent('Rule could not be deleted. Try again.');
 expect(screen.getByRole('button', { name: 'Delete rule' })).toBeEnabled();
 await userEvent.click(screen.getByRole('button', { name: 'Delete rule' }));
 await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
 await waitFor(() => expect(screen.getByRole('heading', { name: 'Automation Rules' })).toHaveFocus());
 expect(api.delete).toHaveBeenCalledTimes(2);
 expect(api.delete).toHaveBeenLastCalledWith('/automations/rule-a');
});

it('names usage credential inputs when the local API reports missing configuration', async () => {
 api.get.mockRejectedValue(new ApiError('Synthetic credentials required',400));
 render(<UsagePage/>);
 const title = await screen.findByRole('heading',{name:'Cloudflare Credentials Required'});
 expect(title).toHaveClass('card__title');
 expect(title.closest('.card__root')).toBeInTheDocument();
 expect(screen.getByRole('note')).toHaveClass('alert__root');
 const helpLink = screen.getByRole('link', { name: 'Cloudflare API Tokens' });
 expect(helpLink).toHaveClass('link', 'link--variant_underline');
 expect(helpLink).toHaveAttribute('href', 'https://dash.cloudflare.com/profile/api-tokens');
 expect(helpLink).toHaveAttribute('target', '_blank');
 expect(helpLink).toHaveAttribute('rel', 'noopener noreferrer');
 expect(helpLink.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
 expect(await screen.findByRole('textbox',{name:'Cloudflare Account ID'})).toBeInTheDocument();
 expect(screen.getByLabelText('Cloudflare API Token')).toHaveAttribute('type','password');
 expect(api.post).not.toHaveBeenCalled();
});

it('keeps credential save and usage reload behavior inside the Park card', async () => {
 api.get.mockRejectedValueOnce(new ApiError('Synthetic credentials required',400)).mockResolvedValueOnce(usageStats);
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
 api.get.mockRejectedValueOnce(new Error('Synthetic usage outage')).mockResolvedValueOnce(usageStats);
 render(<UsagePage/>);
 expect(screen.getByRole('status',{name:'Loading usage data'})).toHaveAttribute('aria-busy', 'true');
 expect(screen.getByRole('status',{name:'Loading usage data'})).toHaveTextContent('Loading usage data…');
 expect(document.querySelector('.skeleton')).toBeInTheDocument();
 expect(await screen.findByText('Error loading usage data')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
 await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
});

it('rejects incomplete usage responses and never presents missing readings as zero', async () => {
 api.get.mockResolvedValueOnce({}).mockResolvedValueOnce(usageStats);
 render(<UsagePage/>);
 expect(await screen.findByText('Error loading usage data')).toBeInTheDocument();
 expect(screen.getByText('Usage readings are incomplete. Retry or check provider analytics.')).toBeInTheDocument();
 expect(screen.queryByText('D1 Reads and Writes')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
 expect(await screen.findByText('D1 Reads and Writes')).toBeInTheDocument();
 expect(screen.getAllByText('Unavailable')).toHaveLength(3);
 expect(screen.getByText('D1 Reads and Writes').closest('.card__root')).toHaveTextContent('0');
});
