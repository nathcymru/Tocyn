import userEvent from '@testing-library/user-event';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentPermissionsPage } from '../pages/AgentPermissionsPage';
import { dashboardApi } from '../api/client';
vi.mock('../api/client', () => ({ dashboardApi: { get: vi.fn(), put: vi.fn() } }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const policy = {revision: 4, capabilities: [
  {key:'general', capability:'settings.general.manage', resource:'settings', action:'manage', risk:'PRIVILEGED_WRITE', label:'General settings', ownerAllowed:true, roleAllowed:true, tenantAllowed:false},
  {key:'tools.reference.read', capability:'tools.reference.read', resource:'reference', action:'read', risk:'READ_ONLY', label:'Reference tool reads', ownerAllowed:true, roleAllowed:false, tenantAllowed:false},
]};
describe('permission administration recovery', () => {
  it('uses a retryable empty state when the initial policy load fails', async () => {
    vi.mocked(dashboardApi.get).mockRejectedValueOnce(new Error('Synthetic policy failure')).mockResolvedValueOnce(policy);
    render(<AgentPermissionsPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Permissions could not be loaded');
    expect(screen.getByRole('button', { name: 'Save changes' })).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Reload permissions' }));
    expect(await screen.findByRole('checkbox', { name: 'Allow agents to use General settings' })).toBeInTheDocument();
  });
  it('retains focus, bounds saves and preserves denied controls during refresh', async () => {
    let finish!: () => void;
    vi.mocked(dashboardApi.get).mockResolvedValue(policy);
    vi.mocked(dashboardApi.put).mockImplementation(() => new Promise(resolve => { finish=()=>resolve({}); }));
    render(<AgentPermissionsPage />);
    const toggle=await screen.findByRole('checkbox', {name:'Allow agents to use General settings'});
    expect(screen.getByRole('checkbox', {name:'Allow agents to use Reference tool reads'})).toBeDisabled();
    await userEvent.click(screen.getByText('Allow agents to use General settings'));
    const save=screen.getByRole('button', {name:'Save changes'});save.focus();fireEvent.click(save);fireEvent.click(save);
    expect(dashboardApi.put).toHaveBeenCalledTimes(1);
    expect(dashboardApi.put).toHaveBeenCalledWith('/permissions',{revision:4,policies:{general:true}});
    expect(save).toHaveFocus();expect(save).toHaveAttribute('aria-disabled','true');
    await userEvent.click(screen.getByText('Allow agents to use General settings'));expect(toggle).toBeChecked();
    await act(async()=>finish());
    await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('Permissions saved'));
    expect(screen.getByRole('status')).toHaveClass('alert__root', 'alert__root--status_success');
  });
  it('shows only a skeleton while refreshing a previously loaded policy', async () => {
    let releaseRead!: (value: typeof policy) => void;
    vi.mocked(dashboardApi.get).mockResolvedValueOnce(policy)
      .mockImplementationOnce(() => new Promise(resolve => { releaseRead = resolve; }));
    vi.mocked(dashboardApi.put).mockResolvedValue({});
    render(<AgentPermissionsPage />);
    await screen.findByRole('checkbox', { name: 'Allow agents to use General settings' });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('status', { name: 'Loading permissions' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Allow agents to use General settings' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Saving permissions…' })).toBeDisabled();

    await act(async () => releaseRead({ ...policy, revision: 5 }));
    expect(await screen.findByRole('checkbox', { name: 'Allow agents to use General settings' })).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading permissions' })).not.toBeInTheDocument();
  });
  it('offers an explicit reload after a policy conflict while preserving the draft', async () => {
    vi.mocked(dashboardApi.get).mockResolvedValue(policy);
    vi.mocked(dashboardApi.put).mockRejectedValue(new Error('Policy changed; reload'));
    render(<AgentPermissionsPage />);
    const toggle=await screen.findByRole('checkbox', {name:'Allow agents to use General settings'});await userEvent.click(screen.getByText('Allow agents to use General settings'));
    fireEvent.click(screen.getByRole('button',{name:'Save changes'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Policy changed');expect(toggle).toBeChecked();
    fireEvent.click(screen.getByRole('button',{name:'Reload permissions'}));
    await waitFor(()=>expect(screen.getByRole('checkbox', { name: 'Allow agents to use General settings' })).not.toBeChecked());
    expect(dashboardApi.put).toHaveBeenCalledTimes(1);
  });
  it('blocks stale saves when the write succeeds but refreshing fails, then recovers on explicit reload', async () => {
    vi.mocked(dashboardApi.get).mockResolvedValueOnce(policy)
      .mockRejectedValueOnce(new Error('Policy temporarily unavailable'))
      .mockResolvedValueOnce({...policy, revision: 5});
    vi.mocked(dashboardApi.put).mockResolvedValue({});
    render(<AgentPermissionsPage />);
    const toggle = await screen.findByRole('checkbox', {name:'Allow agents to use General settings'});
    await userEvent.click(screen.getByText('Allow agents to use General settings'));
    const save = screen.getByRole('button', {name:'Save changes'});
    save.focus(); fireEvent.click(save);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Permissions saved, but the current policy could not be loaded'));
    expect(screen.getByRole('status')).toHaveClass('alert__root', 'alert__root--status_warning');
    expect(save).toHaveFocus();
    expect(save).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Last confirmed permissions are shown below');
    expect(screen.getByRole('checkbox', { name: 'Allow agents to use General settings' })).toBeDisabled();
    fireEvent.click(save); await userEvent.click(screen.getByText('Allow agents to use General settings'));
    expect(dashboardApi.put).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('checkbox', { name: 'Allow agents to use General settings' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', {name:'Reload permissions'}));
    await waitFor(() => expect(save).toHaveAttribute('aria-disabled', 'false'));
    expect(screen.getByRole('checkbox', { name: 'Allow agents to use General settings' })).not.toBeChecked();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    fireEvent.click(save);
    expect(dashboardApi.put).toHaveBeenLastCalledWith('/permissions', {revision:5, policies:{general:false}});
  });

});
