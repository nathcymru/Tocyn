import { ParkButton, ParkEmptyState, ParkInput, ParkTextarea, ParkSelect } from '@luminatick/ui/park';
import React, { useState, useEffect } from 'react';
import { useSettings, useUpdateSettings } from '../hooks/useSettings';
import {
  FaBuilding,
  FaGear,
  FaEnvelope,
  FaFloppyDisk,
  FaSpinner,
  FaCloud,
  FaCircleExclamation,
  FaShieldHalved,
  FaChartLine
} from 'react-icons/fa6';
import { ApiError } from '../api/client';

export const SettingsPage: React.FC = () => {
  const { data: settings, isLoading, error: fetchError } = useSettings();
  const updateSettings = useUpdateSettings();

  const [formData, setFormData] = useState<Record<string, string>>({
    COMPANY_NAME: '',
    PORTAL_URL: '',
    SYSTEM_TIMEZONE: 'UTC',
    TICKET_PREFIX: 'TKT',
    DEFAULT_EMAIL_SIGNATURE: '',
    CLOUDFLARE_ACCOUNT_ID: '',
    CLOUDFLARE_API_TOKEN: '',
    TURNSTILE_SITE_KEY: '',
    TURNSTILE_SECRET_KEY: '',
  });

  const [masterKeyError, setMasterKeyError] = useState<string | null>(null);

  useEffect(() => {
    if (fetchError && fetchError instanceof ApiError) {
      if (fetchError.message.includes('APP_MASTER_KEY')) {
        setMasterKeyError(fetchError.message);
      }
    }
  }, [fetchError]);

  useEffect(() => {
    if (settings) {
      setFormData((prev) => ({
        ...prev,
        COMPANY_NAME: settings.COMPANY_NAME || '',
        PORTAL_URL: settings.PORTAL_URL || '',
        SYSTEM_TIMEZONE: settings.SYSTEM_TIMEZONE || 'UTC',
        TICKET_PREFIX: settings.TICKET_PREFIX || 'TKT',
        DEFAULT_EMAIL_SIGNATURE: settings.DEFAULT_EMAIL_SIGNATURE || '',
        CLOUDFLARE_ACCOUNT_ID: settings.CLOUDFLARE_ACCOUNT_ID || '',
        CLOUDFLARE_API_TOKEN: settings.CLOUDFLARE_API_TOKEN || '',
        TURNSTILE_SITE_KEY: settings.TURNSTILE_SITE_KEY || '',
        TURNSTILE_SECRET_KEY: settings.TURNSTILE_SECRET_KEY || '',
      }));
    }
  }, [settings]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMasterKeyError(null);
    try {
      // Clean and validate data before sending
      const payload: Record<string, string> = {};

      for (const [key, rawValue] of Object.entries(formData)) {
        // Enforce key format (uppercase alphanumeric and underscores, 1-100 chars)
        if (!/^[A-Z0-9_]+$/.test(key)) continue;
        if (key.length === 0 || key.length > 100) continue;

        // Ensure graceful handling of null/undefined and enforce string type
        let value = rawValue;
        if (value === null || value === undefined) {
          value = '';
        } else if (typeof value !== 'string') {
          value = String(value);
        }

        // Omit empty sensitive credentials if they were not modified
        if (value === '••••••••') continue;

        // Enforce max length of 5000 characters for values
        if (value.length > 5000) {
          value = value.slice(0, 5000);
        }

        payload[key] = value;
      }

      // Enforce max 50 keys
      const finalPayload = Object.fromEntries(
        Object.entries(payload).slice(0, 50)
      );

      await updateSettings.mutateAsync(finalPayload);
    } catch (error: any) {
      console.error('Failed to update settings:', error);
      if (error?.message?.includes('APP_MASTER_KEY')) {
        setMasterKeyError(error.message);
      }
    }
  };

  if (isLoading) {
    return <ParkEmptyState title="Loading settings…" headingLevel={false} aria-busy="true" className="tocyn-settings-loading" />;
  }

  return (
    <div className="tocyn-settings-page">
      <div className="tocyn-settings-header">
        <div>
          <h1 className="tocyn-settings-title">General Settings</h1>
          <p className="tocyn-settings-description">Manage your organization and system defaults.</p>
        </div>
        <ParkButton
          onClick={handleSubmit}
          disabled={updateSettings.isPending || !!masterKeyError}
          className="tocyn-settings-save"
        >
          {updateSettings.isPending ? (
            <FaSpinner className="tocyn-settings-save-icon tocyn-settings-save-icon--busy" />
          ) : (
            <FaFloppyDisk className="tocyn-settings-save-icon" />
          )}
          Save Changes
        </ParkButton>
      </div>

      {masterKeyError && (
        <div className="tocyn-settings-master-key-error">
          <FaCircleExclamation className="tocyn-settings-master-key-icon" />
          <div>
            <h3 className="tocyn-settings-master-key-title">Critical: Missing Encryption Key</h3>
            <p className="tocyn-settings-master-key-copy">
              Your server is missing the <code className="tocyn-settings-master-key-code">APP_MASTER_KEY</code> environment variable.
              This 32-character key is required to securely encrypt and decrypt API tokens and other sensitive settings.
            </p>
            <p className="tocyn-settings-master-key-copy tocyn-settings-master-key-copy--secondary">
              Please ask your system administrator to add it to your server's environment configuration, then restart the application.
            </p>
            <p className="tocyn-settings-master-key-details">
              Details: {masterKeyError}
            </p>
          </div>
        </div>
      )}

      <div className="tocyn-settings-sections">
        {/* Organization Profile */}
        <section className="tocyn-settings-card">
          <div className="tocyn-settings-card-header">
            <FaBuilding className="tocyn-settings-card-icon" />
            <h2>Organization Profile</h2>
          </div>
          <div className="tocyn-settings-card-body">
            <div className="tocyn-settings-field">
              <label htmlFor="COMPANY_NAME" className="tocyn-settings-label">
                Company Name
              </label>
              <ParkInput
                type="text"
                id="COMPANY_NAME"
                name="COMPANY_NAME"
                value={formData.COMPANY_NAME}
                onChange={handleChange}
                maxLength={100}
                className="tocyn-settings-control"
                placeholder="e.g. Acme Corp"
              />
            </div>
            <div className="tocyn-settings-field">
              <label htmlFor="PORTAL_URL" className="tocyn-settings-label">
                Portal URL
              </label>
              <ParkInput
                type="url"
                id="PORTAL_URL"
                name="PORTAL_URL"
                value={formData.PORTAL_URL}
                onChange={handleChange}
                maxLength={200}
                className="tocyn-settings-control"
                placeholder="e.g. https://support.acme.com"
              />
            </div>
          </div>
        </section>

        {/* System Defaults */}
        <section className="tocyn-settings-card">
          <div className="tocyn-settings-card-header">
            <FaGear className="tocyn-settings-card-icon" />
            <h2>System Defaults</h2>
          </div>
          <div className="tocyn-settings-card-body">
            <div className="tocyn-settings-field">
              <label htmlFor="SYSTEM_TIMEZONE" className="tocyn-settings-label">
                System Timezone
              </label>
              <ParkSelect
                id="SYSTEM_TIMEZONE"
                name="SYSTEM_TIMEZONE"
                value={formData.SYSTEM_TIMEZONE}
                onChange={handleChange}
                className="tocyn-settings-control"
              >
                <option value="UTC">UTC</option>
                <option value="America/New_York">Eastern Time (ET)</option>
                <option value="America/Chicago">Central Time (CT)</option>
                <option value="America/Denver">Mountain Time (MT)</option>
                <option value="America/Los_Angeles">Pacific Time (PT)</option>
                <option value="Europe/London">London (GMT)</option>
                <option value="Europe/Paris">Central Europe (CET)</option>
                <option value="Asia/Tokyo">Tokyo (JST)</option>
                <option value="Australia/Sydney">Sydney (AEST)</option>
              </ParkSelect>
            </div>

            <div className="tocyn-settings-field">
              <label htmlFor="TICKET_PREFIX" className="tocyn-settings-label">
                Ticket Prefix
              </label>
              <ParkInput
                type="text"
                id="TICKET_PREFIX"
                name="TICKET_PREFIX"
                value={formData.TICKET_PREFIX}
                onChange={handleChange}
                className="tocyn-settings-control tocyn-settings-control-uppercase"
                placeholder="e.g. TKT"
                maxLength={10}
              />
              <p className="tocyn-settings-help">
                Tickets will be numbered as {formData.TICKET_PREFIX || 'TKT'}-1001.
              </p>
            </div>
          </div>
        </section>

        {/* Agent Communication */}
        <section className="tocyn-settings-card">
          <div className="tocyn-settings-card-header">
            <FaEnvelope className="tocyn-settings-card-icon" />
            <h2>Agent Communication</h2>
          </div>
          <div className="tocyn-settings-card-body">
            <div>
              <label htmlFor="DEFAULT_EMAIL_SIGNATURE" className="tocyn-settings-label">
                Default Email Signature
              </label>
              <ParkTextarea
                id="DEFAULT_EMAIL_SIGNATURE"
                name="DEFAULT_EMAIL_SIGNATURE"
                value={formData.DEFAULT_EMAIL_SIGNATURE}
                onChange={handleChange}
                rows={4}
                maxLength={5000}
                className="tocyn-settings-control tocyn-settings-control-resize"
                placeholder="e.g. --&#10;Thank you,&#10;The Support Team"
              />
              <p className="tocyn-settings-help tocyn-settings-help--signature">
                This signature will be appended to agent replies if they haven't set a personal one.
              </p>
            </div>
          </div>
        </section>

        {/* Cloudflare Integration */}
        <section className="tocyn-settings-card">
          <div className="tocyn-settings-card-header">
            <FaCloud className="tocyn-settings-card-icon" />
            <h2>Cloudflare API Credentials</h2>
          </div>
          <div className="tocyn-settings-card-body">
            <p className="tocyn-settings-intro">
              Configure your Cloudflare credentials to monitor usage and costs directly from the dashboard.
            </p>
            <div>
              <label htmlFor="CLOUDFLARE_ACCOUNT_ID" className="tocyn-settings-label">
                Cloudflare Account ID
              </label>
              <ParkInput
                type="text"
                id="CLOUDFLARE_ACCOUNT_ID"
                name="CLOUDFLARE_ACCOUNT_ID"
                value={formData.CLOUDFLARE_ACCOUNT_ID}
                onChange={handleChange}
                className="tocyn-settings-control tocyn-settings-control-mono"
                placeholder="e.g. 1234567890abcdef1234567890abcdef"
              />
            </div>
            <div>
              <label htmlFor="CLOUDFLARE_API_TOKEN" className="tocyn-settings-label">
                Cloudflare API Token
              </label>
              <ParkInput
                type="password"
                id="CLOUDFLARE_API_TOKEN"
                name="CLOUDFLARE_API_TOKEN"
                value={formData.CLOUDFLARE_API_TOKEN}
                onChange={handleChange}
                className="tocyn-settings-control tocyn-settings-control-mono"
                placeholder="Enter your API token"
              />
              <p className="tocyn-settings-help tocyn-settings-help--compact">
                Requires <strong>Account Analytics: Read</strong> permissions. For security, this value is masked. Provide a new token only if you wish to overwrite the existing one.
              </p>
            </div>
          </div>
        </section>

        {/* Security & Authentication */}
        <section className="tocyn-settings-card">
          <div className="tocyn-settings-card-header">
            <FaShieldHalved className="tocyn-settings-card-icon" />
            <h2>Security & Authentication</h2>
          </div>
          <div className="tocyn-settings-card-body">
            <p className="tocyn-settings-intro">
              Configure Cloudflare Turnstile to protect your Customer Portal from spam and bots.
            </p>
            <div>
              <label htmlFor="TURNSTILE_SITE_KEY" className="tocyn-settings-label">
                Turnstile Site Key
              </label>
              <ParkInput
                type="text"
                id="TURNSTILE_SITE_KEY"
                name="TURNSTILE_SITE_KEY"
                value={formData.TURNSTILE_SITE_KEY}
                onChange={handleChange}
                className="tocyn-settings-control tocyn-settings-control-mono"
                placeholder="e.g. 1x00000000000000000000AA"
              />
            </div>
            <div>
              <label htmlFor="TURNSTILE_SECRET_KEY" className="tocyn-settings-label">
                Turnstile Secret Key
              </label>
              <ParkInput
                type="password"
                id="TURNSTILE_SECRET_KEY"
                name="TURNSTILE_SECRET_KEY"
                value={formData.TURNSTILE_SECRET_KEY}
                onChange={handleChange}
                className="tocyn-settings-control tocyn-settings-control-mono"
                placeholder="Enter your Turnstile secret key"
              />
              <p className="tocyn-settings-help tocyn-settings-help--compact">
                For security, this value is masked. Provide a new key only if you wish to overwrite the existing one.
              </p>
            </div>
          </div>
        </section>

      </div>
    </div>
  );
};
