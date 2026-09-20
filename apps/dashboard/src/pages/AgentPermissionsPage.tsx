import { css } from '@luminatick/ui/styled-system/css';
import { ParkAlert, ParkButton, ParkCard, ParkEmptyState, ParkSkeleton, ParkSwitch } from '@luminatick/ui/park';
import React, { useEffect, useState, useRef } from 'react';
import {
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
    <div className={css({ display: 'grid', gap: '5', maxW: '6xl', mx: 'auto', px: { base: '4', md: '6' }, py: '6' })}>
      <div className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap","mb":"6"})}>
        <div>
          <h1 className={css({ m: '0', display: 'flex', alignItems: 'center', gap: '2', textStyle: '2xl', fontWeight: 'semibold', color: 'fg.default' })}><IconShieldHalved aria-hidden="true" className={css({ w: '5', h: '5', flexShrink: 0 })} /> Agent permissions</h1>
          <p className={css({ color: 'fg.muted', textStyle: 'sm', lineHeight: 'relaxed' })}>Choose the delegated capabilities available to agents in this tenant. Deployment-owner and role limits cannot be changed here.</p>
        </div>
        <ParkButton type="button" onClick={handleSave} aria-disabled={saving || loading || revision === null} loading={saving} loadingText="Saving permissions…">
          <IconFloppyDisk aria-hidden="true" className={css({ w: '4', h: '4', flexShrink: 0 })} /> Save changes
        </ParkButton>
      </div>

      {loading ? <section role="status" aria-label="Loading permissions" aria-busy="true" className={css({ display: 'grid', gap: '3' })}>
        <span className={css({ srOnly: true })}>Loading permissions…</span>
        <ParkSkeleton aria-hidden="true" className={css({ h: '20', w: 'full' })} />
        <ParkSkeleton aria-hidden="true" className={css({ h: '20', w: 'full' })} />
      </section> : <p role="status" aria-live="polite" className={css({ color: 'fg.muted', textStyle: 'sm' })}>{status}</p>}
      {error && capabilities.length === 0 ? <ParkEmptyState role="alert" title="Permissions could not be loaded" description={error} action={<ParkButton type="button" disabled={loading || saving} onClick={() => void loadPermissions()}>Reload permissions</ParkButton>} /> : error && <ParkAlert.Root role="alert" status="error"><ParkAlert.Content><ParkAlert.Description>{error}</ParkAlert.Description>
        <ParkButton type="button" disabled={loading || saving} onClick={() => void loadPermissions()}>Reload permissions</ParkButton>
      </ParkAlert.Content></ParkAlert.Root>}

      <div className={css({"display":"grid","gap":"3"})}>
        {capabilities.length === 0 && !loading && !error ? <ParkEmptyState title="No permission capabilities found." description="Permission capabilities are unavailable for this tenant." headingLevel={false} className={css({"py":"6"})} action={<ParkButton type="button" onClick={() => void loadPermissions()}>Reload permissions</ParkButton>} /> : capabilities.map(capability => {
          const tenantManaged = capability.key !== capability.capability;
          const available = capability.ownerAllowed && capability.roleAllowed && tenantManaged;
          const checked = policies[capability.key] ?? false;
          const descriptionId = `capability-${capability.capability}-description`;
          return (
            <ParkCard.Root key={capability.capability} variant="outline"><ParkCard.Body className={css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4', flexWrap: 'wrap' })}>
              <div className={css({ minW: '0', flex: '1' })}>
                <h2 className={css({ m: '0', fontWeight: 'medium', color: 'fg.default', textStyle: 'sm' })}>{capability.label}</h2>
                <p id={descriptionId} className={css({ color: 'fg.muted', textStyle: 'sm', lineHeight: 'relaxed' })}>{capability.resource} · {capability.action} · {capability.risk.replaceAll('_', ' ').toLowerCase()}</p>
                {!available && <p className={css({ color: 'fg.muted', textStyle: 'sm' })}>Managed by the deployment owner; this tenant cannot enable it.</p>}
              </div>
              <ParkSwitch.Root checked={checked} disabled={!available || saving || loading || revision === null}
                onCheckedChange={() => handleToggle(capability)} className={css({ display: 'inline-flex', alignItems: 'center', gap: '2' })}>
                <ParkSwitch.Control />
                <ParkSwitch.HiddenInput aria-describedby={descriptionId} />
                <ParkSwitch.Label>Allow agents to use {capability.label}</ParkSwitch.Label>
              </ParkSwitch.Root>
            </ParkCard.Body></ParkCard.Root>
          );
        })}
      </div>
    </div>
  );
}
