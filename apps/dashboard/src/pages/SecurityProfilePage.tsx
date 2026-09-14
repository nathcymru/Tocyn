import { TocynConfirmDialog } from '@luminatick/ui/dialog';
import { ParkButton, ParkInput } from '@luminatick/ui/park';
import React, { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { dashboardApi } from '../api/client';
import { useAuthStore } from '../store/authStore';
import {
  FaShieldHalved,
  FaShield,
  FaKey,
  FaTriangleExclamation
} from '@luminatick/ui/icons';

interface SetupResponse {
  provisioning_uri: string;
}

export function SecurityProfilePage() {
  const { user, logout, setAuth, sessionGeneration, sessionAnnouncement, clearSessionAnnouncement } = useAuthStore();
  const [setupData, setSetupData] = useState<SetupResponse | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(() => sessionAnnouncement?.generation === sessionGeneration ? sessionAnnouncement.message : null);

  const pending = useRef(false);
  const setupButton = useRef<HTMLButtonElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const disableButton = useRef<HTMLButtonElement>(null);
  const [disableOpen, setDisableOpen] = useState(false);
  useEffect(() => { setSetupData(null); setCode(''); setDisableOpen(false); }, [sessionGeneration]);
  useEffect(() => {
    if (sessionAnnouncement?.generation !== sessionGeneration) return;
    setSuccessMessage(sessionAnnouncement.message);
    clearSessionAnnouncement(sessionGeneration);
  }, [clearSessionAnnouncement, sessionAnnouncement, sessionGeneration]);
  useEffect(() => { if (setupData) codeInput.current?.focus(); }, [setupData]);
  useEffect(() => {
    if (!successMessage) return;
    // AuthQueryBoundary remounts the workspace after a replacement session; run after its
    // layout-level focus restoration so the confirmation announcement owns focus.
    const frame = requestAnimationFrame(() => heading.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [successMessage]);

  const startSetup = async () => {
    if (pending.current) return;
    pending.current = true; setIsLoading(true); setError(null); setSuccessMessage(null);
    const generation = useAuthStore.getState().sessionGeneration;
    try {
      const data = await dashboardApi.post<SetupResponse>('/auth/mfa/setup');
      if (useAuthStore.getState().sessionGeneration !== generation) return;
      setSetupData(data);
    } catch {
      if (useAuthStore.getState().sessionGeneration === generation) setError('Setup could not be started. Please try again.');
    } finally { pending.current = false; setIsLoading(false); }
  };

  const confirmSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pending.current || !user) return;
    if (!/^\d{6}$/.test(code)) { setError('Please enter a valid 6-digit code'); return; }
    pending.current = true; setIsLoading(true); setError(null); setSuccessMessage(null);
    const generation = useAuthStore.getState().sessionGeneration;
    try {
      const data = await dashboardApi.post<{token:string;user:typeof user}>('/auth/mfa/confirm', { code });
      if (useAuthStore.getState().sessionGeneration !== generation) return;
      if (typeof data.token !== 'string' || !data.token || data.user?.id !== user.id || !data.user.mfa_enabled) throw new Error('Invalid confirmation');
      const announcement = 'Two-Factor Authentication has been successfully enabled.';
      // Attach the non-persisted announcement to the replacement session atomically.
      // The outgoing auth scope therefore cannot consume it before the new scope mounts.
      setAuth(data.token, {...user,...data.user}, announcement);
      setSetupData(null); setCode('');
      setSuccessMessage(announcement);
    } catch {
      if (useAuthStore.getState().sessionGeneration === generation) setError('Verification could not be confirmed. Check your code and try again.');
    } finally { pending.current = false; setIsLoading(false); }
  };

  const disableMfa = async () => {
    if (pending.current || !user || user.role === 'admin' || user.role === 'agent') return;
    pending.current = true; setIsLoading(true); setError(null); setSuccessMessage(null);
    const generation = useAuthStore.getState().sessionGeneration;
    try {
      await dashboardApi.post('/auth/mfa/disable');
      if (useAuthStore.getState().sessionGeneration !== generation) return;
      // The authority-change trigger revokes this token; no replacement is returned.
      setSetupData(null); setCode(''); setDisableOpen(false); logout();
    } catch {
      if (useAuthStore.getState().sessionGeneration === generation) setError('Disabling two-factor authentication could not be confirmed. It remains shown as enabled.');
    } finally { pending.current = false; setIsLoading(false); }
  };

  const getSecretFromUri = (uri: string) => {
    try {
      return new URL(uri).searchParams.get('secret') || '';
    } catch {
      return '';
    }
  };

  if (!user) return null;

  return (
    <div className="tocyn-security-page">
      <TocynConfirmDialog open={disableOpen} onOpenChange={setDisableOpen} busy={isLoading}
        title="Disable two-factor authentication?" description="This will make your account less secure and sign you out. You will need to sign in again."
        confirmLabel="Disable 2FA" error={error ?? undefined} onConfirm={() => { void disableMfa(); }}
        finalFocusEl={() => user.mfa_enabled ? disableButton.current : heading.current} />
      <div>
        <h1 ref={heading} tabIndex={-1} className="tocyn-security-page-title">Security Profile</h1>
        <p className="tocyn-security-page-description">
          Manage your account security and two-factor authentication settings.
        </p>
      </div>

      {successMessage && (
        <div role="status" className="tocyn-security-status tocyn-security-status--success">
          <div className="tocyn-security-status-inner">
            <div className="tocyn-security-status-icon-wrap">
              <FaShieldHalved className="tocyn-security-status-icon" />
            </div>
            <div className="tocyn-security-status-copy">
              <p>{successMessage}</p>
            </div>
          </div>
        </div>
      )}

      {error && !disableOpen && (
        <div role="alert" className="tocyn-security-status tocyn-security-status--error">
          <div className="tocyn-security-status-inner">
            <div className="tocyn-security-status-icon-wrap">
              <FaTriangleExclamation className="tocyn-security-status-icon" />
            </div>
            <div className="tocyn-security-status-copy">
              <p>{error}</p>
            </div>
          </div>
        </div>
      )}

      <div className="tocyn-security-card">
        <div className="tocyn-security-card-body">
          <h3 className="tocyn-security-card-title">
            <FaShieldHalved className="tocyn-security-heading-icon" />
            Two-Factor Authentication (2FA)
          </h3>
          <div className="tocyn-security-card-description">
            <p>
              Add an additional layer of security to your account by requiring more than just a password to sign in.
            </p>
          </div>

          <div className="tocyn-security-card-content">
            {user.mfa_enabled ? (
              <div className="tocyn-security-status-stack">
                <div className="tocyn-security-status-enabled">
                  <FaShieldHalved className="tocyn-security-status-icon" />
                  2FA is currently enabled
                </div>
                {(user.role === 'admin' || user.role === 'agent') ? (
                  <p className="tocyn-security-role-note">
                    Two-Factor Authentication is mandatory for your role and cannot be disabled.
                  </p>
                ) : (
                  <ParkButton
                    type="button"
                    ref={disableButton}
                    onClick={() => { setError(null); setDisableOpen(true); }}
                    disabled={isLoading}
                    className="tocyn-security-action tocyn-security-action-danger"
                  >
                    <FaShield className="tocyn-security-action-icon" />
                    Disable 2FA
                  </ParkButton>
                )}
              </div>
            ) : (
              <div>
                {!setupData ? (
                  <ParkButton
                    type="button"
                    ref={setupButton}
                    onClick={startSetup}
                    disabled={isLoading}
                    className="tocyn-security-action tocyn-security-action-primary"
                  >
                    <FaKey className="tocyn-security-action-icon" />
                    Set up 2FA
                  </ParkButton>
                ) : (
                  <div className="tocyn-security-setup">
                    <div className="tocyn-security-setup-step">
                      <h4 className="tocyn-security-setup-title">Step 1: Scan QR Code</h4>
                      <p className="tocyn-security-setup-copy">
                        Scan the QR code below with your authenticator app (like Google Authenticator, Authy, or Microsoft Authenticator).
                      </p>
                      <div className="tocyn-security-qr">
                        <QRCodeSVG value={setupData.provisioning_uri} size={200} />
                      </div>
                      <p className="tocyn-security-setup-note">
                        If you can't scan the QR code, you can manually enter this secret key:<br/>
                        <code className="tocyn-security-secret">{getSecretFromUri(setupData.provisioning_uri)}</code>
                      </p>
                    </div>

                    <div className="tocyn-security-verify-section">
                      <h4 className="tocyn-security-verify-title">Step 2: Verify Code</h4>
                      <form onSubmit={confirmSetup} aria-label="Verify two-factor setup" aria-busy={isLoading} className="tocyn-security-verify-form">
                        <div className="tocyn-security-code-field">
                          <label htmlFor="code" className="tocyn-security-code-label">
                            Authentication Code
                          </label>
                          <ParkInput
                            type="text"
                            id="code" ref={codeInput} inputMode="numeric" autoComplete="one-time-code" disabled={isLoading}
                            value={code}
                            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                            className="tocyn-form-control tocyn-form-control--code tocyn-security-code-input"
                            placeholder="000000"
                            maxLength={6}
                            required
                          />
                        </div>
                        <ParkButton
                          type="submit"
                          disabled={isLoading || code.length !== 6}
                          className="tocyn-security-verify-submit"
                        >
                          Verify & Enable
                        </ParkButton>
                        <ParkButton
                          type="button"
                          onClick={() => { setSetupData(null); setCode(''); setError(null); requestAnimationFrame(() => setupButton.current?.focus()); }}
                          disabled={isLoading}
                          className="tocyn-security-verify-cancel"
                        >
                          Cancel
                        </ParkButton>
                      </form>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
