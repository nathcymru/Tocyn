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
  it('retains focus, bounds saves and preserves denied controls during refresh', async () => {
    let finish!: () => void;
    vi.mocked(dashboardApi.get).mockResolvedValue(policy);
    vi.mocked(dashboardApi.put).mockImplementation(() => new Promise(resolve => { finish=()=>resolve({}); }));
    render(<AgentPermissionsPage />);
    const toggle=await screen.findByRole('checkbox', {name:'Allow agents to use General settings'});
    expect(screen.getByRole('checkbox', {name:'Allow agents to use Reference tool reads'})).toBeDisabled();
    fireEvent.click(toggle);
    const save=screen.getByRole('button', {name:'Save changes'});save.focus();fireEvent.click(save);fireEvent.click(save);
    expect(dashboardApi.put).toHaveBeenCalledTimes(1);
    expect(dashboardApi.put).toHaveBeenCalledWith('/permissions',{revision:4,policies:{general:true}});
    expect(save).toHaveFocus();expect(save).toHaveAttribute('aria-disabled','true');
    fireEvent.click(toggle);expect(toggle).toBeChecked();
    await act(async()=>finish());
    await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('Permissions saved'));
    expect(save).toHaveFocus();
  });
  it('offers an explicit reload after a policy conflict while preserving the draft', async () => {
    vi.mocked(dashboardApi.get).mockResolvedValue(policy);
    vi.mocked(dashboardApi.put).mockRejectedValue(new Error('Policy changed; reload'));
    render(<AgentPermissionsPage />);
    const toggle=await screen.findByRole('checkbox', {name:'Allow agents to use General settings'});fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button',{name:'Save changes'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Policy changed');expect(toggle).toBeChecked();
    fireEvent.click(screen.getByRole('button',{name:'Reload permissions'}));
    await waitFor(()=>expect(toggle).not.toBeChecked());
    expect(dashboardApi.put).toHaveBeenCalledTimes(1);
  });
  it('blocks stale saves when the write succeeds but refreshing fails, then recovers on explicit reload', async () => {
    vi.mocked(dashboardApi.get).mockResolvedValueOnce(policy)
      .mockRejectedValueOnce(new Error('Policy temporarily unavailable'))
      .mockResolvedValueOnce({...policy, revision: 5});
    vi.mocked(dashboardApi.put).mockResolvedValue({});
    render(<AgentPermissionsPage />);
    const toggle = await screen.findByRole('checkbox', {name:'Allow agents to use General settings'});
    fireEvent.click(toggle);
    const save = screen.getByRole('button', {name:'Save changes'});
    save.focus(); fireEvent.click(save);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Permissions saved, but the current policy could not be loaded'));
    expect(save).toHaveFocus();
    expect(save).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(save); fireEvent.click(toggle);
    expect(dashboardApi.put).toHaveBeenCalledTimes(1);
    expect(toggle).toBeChecked();
    fireEvent.click(screen.getByRole('button', {name:'Reload permissions'}));
    await waitFor(() => expect(save).toHaveAttribute('aria-disabled', 'false'));
    expect(toggle).not.toBeChecked();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    fireEvent.click(save);
    expect(dashboardApi.put).toHaveBeenLastCalledWith('/permissions', {revision:5, policies:{general:false}});
  });

});
