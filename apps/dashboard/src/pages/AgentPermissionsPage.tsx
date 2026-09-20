import { css } from '@luminatick/ui/styled-system/css';
import { ParkButton, ParkEmptyState, ParkSwitch } from '@luminatick/ui/park';
import React, { useEffect, useState, useRef } from 'react';
import {
  IconCircleExclamation,
  IconSpinner,
  IconFloppyDisk,
  IconShieldHalved
} from '@luminatick/ui/icons';
import { dashboardApi } from '../api/client';

type Capability = {
  key: string;
  capability: string;
  resource: string;
  action: string;
  risk: string;
  label: string;
  ownerAllowed: boolean;
  roleAllowed: boolean;
  tenantAllowed: boolean;
};

type PermissionResponse = { revision: number; capabilities: Capability[] };

export function AgentPermissionsPage() {
  const [revision, setRevision] = useState<number | null>(null);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [policies, setPolicies] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const savingGuard = useRef(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);

  const loadPermissions = async () => {
    try {
      setLoading(true);
      setError(null);
      setStatus('');
      const data = await dashboardApi.get('/permissions') as PermissionResponse;
      setRevision(data.revision);
      setCapabilities(data.capabilities);
      setPolicies(Object.fromEntries(data.capabilities
        .filter(capability => capability.key !== capability.capability)
        .map(capability => [capability.key, capability.tenantAllowed])));
      return true;
    } catch (err: any) {
      setRevision(null);
      setError(err.message || 'Failed to load permissions');
      return false;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadPermissions(); }, []);

  const handleToggle = (capability: Capability) => {
    if (savingGuard.current || loading || revision === null || !capability.ownerAllowed || !capability.roleAllowed || capability.key === capability.capability) return;
    setPolicies(current => ({ ...current, [capability.key]: !current[capability.key] }));
  };

  const handleSave = async () => {
    if (revision === null || savingGuard.current || loading) return;
    savingGuard.current = true;
    try {
      setSaving(true);
      setStatus("Saving permissions…");
      setError(null);
      await dashboardApi.put('/permissions', { revision, policies });
      const refreshed = await loadPermissions();
      setStatus(refreshed
        ? "Permissions saved. Agent sessions have been revoked."
        : "Permissions saved, but the current policy could not be loaded. Reload permissions before making further changes.");
    } catch (err: any) {
      setError(err.message || 'Failed to save permissions');
      setStatus('Permissions were not saved. Reload the current policy before retrying a conflict.');
    } finally {
      savingGuard.current = false;
      setSaving(false);
    }
  };



  return (
    <div className={css({"maxW":"6xl","mx":"auto","px":{"base":"4","md":"6"},"py":"6"})}>
      <div className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap","mb":"6"})}>
        <div>
          <h1 className={css({"fontSize":"xl","fontWeight":"semibold","lineHeight":"tight","color":"text.default"})}><IconShieldHalved className={css({"w":"4","h":"4","flexShrink":0})} /> Agent permissions</h1>
          <p className={css({"color":"text.muted","fontSize":"sm","lineHeight":"relaxed"})}>Choose the delegated capabilities available to agents in this tenant. Deployment-owner and role limits cannot be changed here.</p>
        </div>
        <ParkButton type="button" onClick={handleSave} aria-disabled={saving || loading || revision === null} className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}>
          {saving ? <IconSpinner className={css({"w":"4","h":"4","flexShrink":0})} /> : <IconFloppyDisk className={css({"w":"4","h":"4","flexShrink":0})} />} Save changes
        </ParkButton>
      </div>

      {loading ? <ParkEmptyState title="Loading permissions…" headingLevel={false} aria-busy="true" className={css({"py":"6"})} /> : <p role="status" aria-live="polite" className={css({"color":"text.muted","fontSize":"sm","lineHeight":"relaxed"})}>{status}</p>}
      {error && <div role="alert" className={css({"p":"3","rounded":"md","bg":"bg.subtle","color":"text.default"})}><IconCircleExclamation className={css({"w":"4","h":"4","flexShrink":0})} /><p className={css({"minW":0})}>{error}</p><ParkButton type="button" disabled={loading || saving} onClick={() => void loadPermissions()} className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}>Reload permissions</ParkButton></div>}

      <div className={css({"display":"grid","gap":"3"})}>
        {capabilities.length === 0 && !loading ? <ParkEmptyState title="No permission capabilities found." description="Permission capabilities are unavailable for this tenant." headingLevel={false} className={css({"py":"6"})} /> : capabilities.map(capability => {
          const tenantManaged = capability.key !== capability.capability;
          const available = capability.ownerAllowed && capability.roleAllowed && tenantManaged;
          const checked = policies[capability.key] ?? false;
          const descriptionId = `capability-${capability.capability}-description`;
          return (
            <div key={capability.capability} className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap","p":"4","bg":"bg.surface","borderWidth":"1px","borderColor":"border.default","rounded":"md"})}>
              <div className={css({"minW":0})}>
                <h2 className={css({"fontWeight":"medium","color":"text.default","display":"grid","gap":"1","fontSize":"sm"})}>{capability.label}</h2>
                <p id={descriptionId} className={css({"color":"text.muted","fontSize":"sm","lineHeight":"relaxed"})}>{capability.resource} · {capability.action} · {capability.risk.replaceAll('_', ' ').toLowerCase()}</p>
                {!available && <p className={css({"minW":0})}>Managed by the deployment owner; this tenant cannot enable it.</p>}
              </div>
              <ParkSwitch.Root checked={checked} disabled={!available || saving || loading || revision === null}
                onCheckedChange={() => handleToggle(capability)} className={css({ display: 'inline-flex', alignItems: 'center', gap: '2' })}>
                <ParkSwitch.Control />
                <ParkSwitch.HiddenInput aria-describedby={descriptionId} />
                <ParkSwitch.Label>Allow agents to use {capability.label}</ParkSwitch.Label>
              </ParkSwitch.Root>
            </div>
          );
        })}
      </div>
    </div>
  );
}
