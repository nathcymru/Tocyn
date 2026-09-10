import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { UsagePage } from '../pages/UsagePage';
import { ApiError } from '../api/client';
import { AutomationPage } from '../pages/AutomationPage';
const api=vi.hoisted(()=>({get:vi.fn(),post:vi.fn(),patch:vi.fn(),delete:vi.fn()}));
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
 fireEvent.change(action,{target:{value:'retention'}});await waitFor(()=>expect(screen.getByRole('spinbutton',{name:'Retention Period (Days)'})).toBeInTheDocument());expect(screen.queryByRole('textbox',{name:'Webhook URL'})).not.toBeInTheDocument();
});

it('names usage credential inputs when the local API reports missing configuration', async () => {
 api.get.mockRejectedValue(new ApiError('Synthetic credentials required',400));
 render(<UsagePage/>);
 expect(await screen.findByRole('textbox',{name:'Cloudflare Account ID'})).toBeInTheDocument();
 expect(screen.getByLabelText('Cloudflare API Token')).toHaveAttribute('type','password');
 expect(api.post).not.toHaveBeenCalled();
});
