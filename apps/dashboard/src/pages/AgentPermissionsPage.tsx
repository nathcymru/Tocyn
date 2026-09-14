import { ParkButton, ParkEmptyState, ParkInput } from '@luminatick/ui/park';
import React, { useEffect, useState, useRef } from 'react';
import {
  FaCircleExclamation,
  FaSpinner,
  FaFloppyDisk,
  FaShieldHalved
} from 'react-icons/fa6';
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
    <div className="tocyn-permissions-page">
      <div className="tocyn-permissions-header">
        <div>
          <h1 className="tocyn-permissions-title"><FaShieldHalved className="tocyn-permissions-title-icon" /> Agent permissions</h1>
          <p className="tocyn-permissions-description">Choose the delegated capabilities available to agents in this tenant. Deployment-owner and role limits cannot be changed here.</p>
        </div>
        <ParkButton type="button" onClick={handleSave} aria-disabled={saving || loading || revision === null} className="tocyn-permissions-save">
          {saving ? <FaSpinner className="tocyn-permissions-save-icon" /> : <FaFloppyDisk className="tocyn-permissions-save-icon" />} Save changes
        </ParkButton>
      </div>

      {loading ? <ParkEmptyState title="Loading permissions…" headingLevel={false} aria-busy="true" className="tocyn-permissions-loading" /> : <p role="status" aria-live="polite" className="tocyn-permissions-status">{status}</p>}
      {error && <div role="alert" className="tocyn-permissions-error"><FaCircleExclamation className="tocyn-permissions-error-icon" /><p className="tocyn-permissions-error-message">{error}</p><ParkButton type="button" disabled={loading || saving} onClick={() => void loadPermissions()} className="tocyn-permissions-retry">Reload permissions</ParkButton></div>}

      <div className="tocyn-permissions-list">
        {capabilities.length === 0 && !loading ? <ParkEmptyState title="No permission capabilities found." description="Permission capabilities are unavailable for this tenant." headingLevel={false} className="tocyn-permissions-empty" /> : capabilities.map(capability => {
          const tenantManaged = capability.key !== capability.capability;
          const available = capability.ownerAllowed && capability.roleAllowed && tenantManaged;
          const checked = policies[capability.key] ?? false;
          const descriptionId = `capability-${capability.capability}-description`;
          return (
            <div key={capability.capability} className="tocyn-permission-row">
              <div className="tocyn-permission-content">
                <h2 className="tocyn-permission-label">{capability.label}</h2>
                <p id={descriptionId} className="tocyn-permission-description">{capability.resource} · {capability.action} · {capability.risk.replaceAll('_', ' ').toLowerCase()}</p>
                {!available && <p className="tocyn-permission-unavailable">Managed by the deployment owner; this tenant cannot enable it.</p>}
              </div>
              <label className={`tocyn-permission-toggle ${available ? 'tocyn-permission-toggle--available' : 'tocyn-permission-toggle--disabled'}`}>
                <span className="sr-only">Allow agents to use {capability.label}</span>
                <ParkInput type="checkbox" className="sr-only peer" checked={checked} disabled={!available} aria-disabled={!available || saving || loading || revision === null} aria-describedby={descriptionId} onChange={() => handleToggle(capability)} />
                <span aria-hidden="true" className="tocyn-permission-switch" />
              </label>
            </div>
          );
        })}
      </div>
    </div>
  );
}
