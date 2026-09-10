import React, { useEffect, useState, useRef } from 'react';
import { AlertCircle, Loader2, Save, Shield } from 'lucide-react';
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
    <div className="max-w-4xl mx-auto">
      <div className="mb-8 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><Shield className="w-6 h-6 text-brand-600" /> Agent permissions</h1>
          <p className="text-slate-500 mt-1">Choose the delegated capabilities available to agents in this tenant. Deployment-owner and role limits cannot be changed here.</p>
        </div>
        <button type="button" onClick={handleSave} aria-disabled={saving || loading || revision === null} className="min-h-11 flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors aria-disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save changes
        </button>
      </div>

      <p role="status" aria-live="polite" className="mb-4 text-sm text-slate-700">{loading ? 'Loading permissions…' : status}</p>
      {error && <div role="alert" className="mb-6 p-4 bg-red-50 text-red-700 rounded-lg flex items-center gap-3"><AlertCircle className="w-5 h-5 shrink-0" /><p className="text-sm font-medium">{error}</p><button type="button" disabled={loading || saving} onClick={() => void loadPermissions()} className="min-h-11 rounded px-3 underline focus-visible:outline focus-visible:outline-2">Reload permissions</button></div>}

      <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-200">
        {capabilities.map(capability => {
          const tenantManaged = capability.key !== capability.capability;
          const available = capability.ownerAllowed && capability.roleAllowed && tenantManaged;
          const checked = policies[capability.key] ?? false;
          const descriptionId = `capability-${capability.capability}-description`;
          return (
            <div key={capability.capability} className="p-6 flex items-center justify-between gap-6">
              <div>
                <h2 className="text-sm font-medium text-slate-900">{capability.label}</h2>
                <p id={descriptionId} className="text-sm text-slate-500 mt-1">{capability.resource} · {capability.action} · {capability.risk.replaceAll('_', ' ').toLowerCase()}</p>
                {!available && <p className="text-sm text-slate-600 mt-1">Managed by the deployment owner; this tenant cannot enable it.</p>}
              </div>
              <label className={`relative inline-flex min-h-11 min-w-11 items-center ${available ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
                <span className="sr-only">Allow agents to use {capability.label}</span>
                <input type="checkbox" className="sr-only peer" checked={checked} disabled={!available} aria-disabled={!available || saving || loading || revision === null} aria-describedby={descriptionId} onChange={() => handleToggle(capability)} />
                <span aria-hidden="true" className="relative block w-11 h-6 bg-slate-500 peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-blue-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-600" />
              </label>
            </div>
          );
        })}
      </div>
    </div>
  );
}
