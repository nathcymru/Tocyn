import { DashboardSelect } from '../components/DashboardSelect';
import { ParkButton, ParkCard, ParkEmptyState, ParkInput, ParkPage, ParkTextarea } from '@luminatick/ui/park';
import React, { useState, useEffect } from 'react';
import { useSettings, useUpdateSettings } from '../hooks/useSettings';
import {
  IconBuilding,
  IconGear,
  IconEnvelope,
  IconFloppyDisk,
  IconSpinner,
  IconCloud,
  IconCircleExclamation,
  IconShieldHalved,
  IconChartLine
} from '@luminatick/ui/icons';
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
    return <ParkEmptyState title="Loading settings…" headingLevel={false} aria-busy="true" />;
  }

  const page = ParkPage('settings');

  return (
    <div className={[page.root, page.content].join(' ')}>
      <header className={page.header}>
        <div>
          <h1>General Settings</h1>
          <p>Manage your organization and system defaults.</p>
        </div>
        <ParkButton
          onClick={handleSubmit}
          disabled={updateSettings.isPending || !!masterKeyError}
         
        >
          {updateSettings.isPending ? (
            <IconSpinner />
          ) : (
            <IconFloppyDisk />
          )}
          Save Changes
        </ParkButton>
      </header>

      {masterKeyError && (
        <div className={page.settingsError}>
          <IconCircleExclamation />
          <div>
            <h3>Critical: Missing Encryption Key</h3>
            <p>
              Your server is missing the <code>APP_MASTER_KEY</code> environment variable.
              This 32-character key is required to securely encrypt and decrypt API tokens and other sensitive settings.
            </p>
            <p>
              Please ask your system administrator to add it to your server's environment configuration, then restart the application.
            </p>
            <p>
              Details: {masterKeyError}
            </p>
          </div>
        </div>
      )}

      <div className={page.settingsSections}>
        {/* Organization Profile */}
        <ParkCard.Root variant="outline">
          <ParkCard.Header>
            <IconBuilding />
            <h2>Organization Profile</h2>
          </ParkCard.Header>
          <ParkCard.Body>
            <div className={page.settingsField}>
              <label htmlFor="COMPANY_NAME">
                Company Name
              </label>
              <ParkInput
                type="text"
                id="COMPANY_NAME"
                name="COMPANY_NAME"
                value={formData.COMPANY_NAME}
                onChange={handleChange}
                maxLength={100}
               
                placeholder="e.g. Acme Corp"
              />
            </div>
            <div className={page.settingsField}>
              <label htmlFor="PORTAL_URL">
                Portal URL
              </label>
              <ParkInput
                type="url"
                id="PORTAL_URL"
                name="PORTAL_URL"
                value={formData.PORTAL_URL}
                onChange={handleChange}
                maxLength={200}
               
                placeholder="e.g. https://support.acme.com"
              />
            </div>
          </ParkCard.Body>
        </ParkCard.Root>

        {/* System Defaults */}
        <ParkCard.Root variant="outline">
          <ParkCard.Header>
            <IconGear />
            <h2>System Defaults</h2>
          </ParkCard.Header>
          <ParkCard.Body>
            <div className={page.settingsField}>
              <label htmlFor="SYSTEM_TIMEZONE">
                System Timezone
              </label>
              <DashboardSelect id="SYSTEM_TIMEZONE" aria-label="System Timezone" name="SYSTEM_TIMEZONE" value={formData.SYSTEM_TIMEZONE}
                onValueChange={value => setFormData(prev => ({ ...prev, SYSTEM_TIMEZONE: value }))}
                options={[{ value: 'UTC', label: 'UTC' }, { value: 'America/New_York', label: 'Eastern Time (ET)' },
                  { value: 'America/Chicago', label: 'Central Time (CT)' }, { value: 'America/Denver', label: 'Mountain Time (MT)' },
                  { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' }, { value: 'Europe/London', label: 'London (GMT)' },
                  { value: 'Europe/Paris', label: 'Central Europe (CET)' }, { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
                  { value: 'Australia/Sydney', label: 'Sydney (AEST)' }]} />
            </div>

            <div className={page.settingsField}>
              <label htmlFor="TICKET_PREFIX">
                Ticket Prefix
              </label>
              <ParkInput
                type="text"
                id="TICKET_PREFIX"
                name="TICKET_PREFIX"
                value={formData.TICKET_PREFIX}
                onChange={handleChange}
               
                placeholder="e.g. TKT"
                maxLength={10}
              />
              <p className={page.settingsHelp}>
                Tickets will be numbered as {formData.TICKET_PREFIX || 'TKT'}-1001.
              </p>
            </div>
          </ParkCard.Body>
        </ParkCard.Root>

        {/* Agent Communication */}
        <ParkCard.Root variant="outline">
          <ParkCard.Header>
            <IconEnvelope />
            <h2>Agent Communication</h2>
          </ParkCard.Header>
          <ParkCard.Body>
            <div>
              <label htmlFor="DEFAULT_EMAIL_SIGNATURE">
                Default Email Signature
              </label>
              <ParkTextarea
                id="DEFAULT_EMAIL_SIGNATURE"
                name="DEFAULT_EMAIL_SIGNATURE"
                value={formData.DEFAULT_EMAIL_SIGNATURE}
                onChange={handleChange}
                rows={4}
                maxLength={5000}
               
                placeholder="e.g. --&#10;Thank you,&#10;The Support Team"
              />
              <p className={page.settingsHelp}>
                This signature will be appended to agent replies if they haven't set a personal one.
              </p>
            </div>
          </ParkCard.Body>
        </ParkCard.Root>

        {/* Cloudflare Integration */}
        <ParkCard.Root variant="outline">
          <ParkCard.Header>
            <IconCloud />
            <h2>Cloudflare API Credentials</h2>
          </ParkCard.Header>
          <ParkCard.Body>
            <p>
              Configure your Cloudflare credentials to monitor usage and costs directly from the dashboard.
            </p>
            <div>
              <label htmlFor="CLOUDFLARE_ACCOUNT_ID">
                Cloudflare Account ID
              </label>
              <ParkInput
                type="text"
                id="CLOUDFLARE_ACCOUNT_ID"
                name="CLOUDFLARE_ACCOUNT_ID"
                value={formData.CLOUDFLARE_ACCOUNT_ID}
                onChange={handleChange}
               
                placeholder="e.g. 1234567890abcdef1234567890abcdef"
              />
            </div>
            <div>
              <label htmlFor="CLOUDFLARE_API_TOKEN">
                Cloudflare API Token
              </label>
              <ParkInput
                type="password"
                id="CLOUDFLARE_API_TOKEN"
                name="CLOUDFLARE_API_TOKEN"
                value={formData.CLOUDFLARE_API_TOKEN}
                onChange={handleChange}
               
                placeholder="Enter your API token"
              />
              <p className={page.settingsHelp}>
                Requires <strong>Account Analytics: Read</strong> permissions. For security, this value is masked. Provide a new token only if you wish to overwrite the existing one.
              </p>
            </div>
          </ParkCard.Body>
        </ParkCard.Root>

        {/* Security & Authentication */}
        <ParkCard.Root variant="outline">
          <ParkCard.Header>
            <IconShieldHalved />
            <h2>Security & Authentication</h2>
          </ParkCard.Header>
          <ParkCard.Body>
            <p>
              Configure Cloudflare Turnstile to protect your Customer Portal from spam and bots.
            </p>
            <div>
              <label htmlFor="TURNSTILE_SITE_KEY">
                Turnstile Site Key
              </label>
              <ParkInput
                type="text"
                id="TURNSTILE_SITE_KEY"
                name="TURNSTILE_SITE_KEY"
                value={formData.TURNSTILE_SITE_KEY}
                onChange={handleChange}
               
                placeholder="e.g. 1x00000000000000000000AA"
              />
            </div>
            <div>
              <label htmlFor="TURNSTILE_SECRET_KEY">
                Turnstile Secret Key
              </label>
              <ParkInput
                type="password"
                id="TURNSTILE_SECRET_KEY"
                name="TURNSTILE_SECRET_KEY"
                value={formData.TURNSTILE_SECRET_KEY}
                onChange={handleChange}
               
                placeholder="Enter your Turnstile secret key"
              />
              <p className={page.settingsHelp}>
                For security, this value is masked. Provide a new key only if you wish to overwrite the existing one.
              </p>
            </div>
          </ParkCard.Body>
        </ParkCard.Root>

      </div>
    </div>
  );
};
