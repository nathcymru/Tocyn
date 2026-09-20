import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach,afterEach,it,expect,vi } from 'vitest';
import { ApiError,dashboardApi } from '../api/client';
import { useAuthStore } from '../store/authStore';
import { OperatorCapacityPanel } from '../components/capacity/OperatorCapacityPanel';
vi.mock('../api/client',async()=>({...await vi.importActual<typeof import('../api/client')>('../api/client'),dashboardApi:{get:vi.fn(),put:vi.fn()}}));
const row=(revision=1)=>({userId:'operator',revision,availability:'available',assignmentCeiling:3,currentWork:2,status:'available',definitionVersion:'2026-09-11.3',asOf:'2026-09-13T13:00:00Z'});
beforeEach(()=>{vi.resetAllMocks();useAuthStore.getState().setAuth('synthetic',{id:'admin',tenant_id:'a',email:'admin@example.test',role:'admin',full_name:'Synthetic Admin',mfa_enabled:true});});
afterEach(()=>{cleanup();useAuthStore.getState().logout();});
it('shows a retryable Park empty state when the first current-work load fails',async()=>{
 vi.mocked(dashboardApi.get).mockRejectedValueOnce(new Error('Synthetic unavailable')).mockResolvedValueOnce(row());
 render(<OperatorCapacityPanel userId="operator"/>);
 expect(await screen.findByRole('region',{name:'Current work unavailable'})).toBeVisible();
 expect(screen.queryByText('Loading current work…')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Retry'}));
 await screen.findByText('Current work');
 expect(screen.queryByRole('region',{name:'Current work unavailable'})).not.toBeInTheDocument();
});
it('retains entered values through a conflict and failed reload, then explicitly resubmits the fresh revision',async()=>{
 vi.mocked(dashboardApi.get).mockResolvedValueOnce(row()).mockRejectedValueOnce(new Error('Synthetic failed reload')).mockResolvedValueOnce({...row(4),assignmentCeiling:8});
 vi.mocked(dashboardApi.put).mockRejectedValueOnce(new ApiError('Conflict',409)).mockResolvedValueOnce({...row(5),availability:'unavailable',assignmentCeiling:5});
 render(<OperatorCapacityPanel userId="operator" editable/>);
 const limit=await screen.findByRole('spinbutton',{name:'Assignment limit (0–1000)'});
 expect(limit.closest('[data-scope="field"][data-part="root"]')).toHaveClass('field__root');
 expect(limit.closest('[data-scope="field"][data-part="root"]')?.querySelector('[data-part="label"]')).toHaveClass('field__label');
 await waitFor(()=>expect(limit).toHaveValue(3));
 fireEvent.change(limit,{target:{value:'5'}});
 await userEvent.click(screen.getByRole('combobox',{name:'Availability for assignments'}));
 await userEvent.click(screen.getByRole('option',{name:'Unavailable'}));
 fireEvent.click(screen.getByRole('button',{name:'Save capacity'}));
 await screen.findByText(/Capacity changed elsewhere/);expect(screen.getByRole('alert')).toHaveClass('alert__root');expect(limit).toHaveValue(5);
 expect(screen.getByRole('button',{name:'Save capacity'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Reload current policy'}));
 await screen.findByText(/Current work could not be loaded/);expect(limit).toHaveValue(5);
 fireEvent.click(screen.getByRole('button',{name:'Retry'}));await screen.findByText(/Current policy reloaded/);
 expect(limit).toHaveValue(5);expect(screen.getByRole('combobox',{name:'Availability for assignments'})).toHaveTextContent('Unavailable');
 expect(dashboardApi.put).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByRole('button',{name:'Save capacity'}));await screen.findByText('Capacity saved.');
 expect(dashboardApi.put).toHaveBeenLastCalledWith('/operators/operator/capacity',{expectedRevision:4,availability:'unavailable',assignmentCeiling:5});
});
it('shows overbound counts honestly while allowing administrators to edit the policy',async()=>{
 vi.mocked(dashboardApi.get).mockResolvedValue({...row(),currentWork:null,status:'unavailable'});
 render(<OperatorCapacityPanel userId="operator" editable/>);
 await screen.findByText('Unavailable — above the count limit');
 expect(screen.getByRole('spinbutton')).toBeEnabled();expect(screen.getByRole('button',{name:'Save capacity'})).toBeEnabled();
});

it('renders an unconfigured policy independently of an overbound current-work count',async()=>{
 vi.mocked(dashboardApi.get).mockResolvedValue({...row(0),availability:null,assignmentCeiling:null,currentWork:null,status:'unavailable'});
 render(<OperatorCapacityPanel userId="operator" editable/>);
 await screen.findByText('Unavailable — above the count limit');
 expect(screen.getByText(/No capacity policy is configured/)).toBeVisible();
 expect(screen.getByRole('spinbutton')).toHaveValue(null);
 expect(screen.getByRole('button',{name:'Save capacity'})).toBeDisabled();
 fireEvent.change(screen.getByRole('spinbutton'),{target:{value:'0'}});
 expect(screen.getByRole('button',{name:'Save capacity'})).toBeEnabled();
});
