import { TocynConfirmDialog } from '@luminatick/ui/dialog';
import { ParkButton, ParkCard, ParkInput } from '@luminatick/ui/park';
import { css } from '@luminatick/ui/styled-system/css';
import React, { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { dashboardApi } from '../api/client';
import { useAuthStore } from '../store/authStore';
import {
  IconShieldHalved,
  IconShield,
  IconKey,
  IconTriangleExclamation
} from '@luminatick/ui/icons';

interface SetupResponse {
  provisioning_uri: string;
}

const securityStyles = {
  page: css({ width: '100%', maxWidth: '48rem', marginInline: 'auto', padding: '2rem 1rem', display: 'grid', gap: '1.5rem', color: 'text.primary' }),
  title: css({ margin: '0', fontSize: '1.75rem', lineHeight: '1.2' }),
  description: css({ marginTop: '0.375rem', color: 'text.muted' }),
  success: css({ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '1rem', borderWidth: '1px', borderStyle: 'solid', borderColor: 'border.default', borderRadius: 'l2', background: 'bg.input', color: 'text.primary' }),
  error: css({ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '1rem', borderWidth: '1px', borderStyle: 'solid', borderColor: 'critical.border', borderRadius: 'l2', background: 'critical.surface', color: 'critical' }),
  statusInner: css({ display: 'flex', alignItems: 'center', gap: '0.75rem' }),
  statusIcon: css({ width: '1.5rem', height: '1.5rem', flexShrink: '0' }),
  card: css({ width: '100%' }),
  cardBody: css({ display: 'grid', gap: '1.25rem', padding: 'clamp(1.25rem, 4vw, 2rem)' }),
  cardTitle: css({ display: 'flex', alignItems: 'center', gap: '0.625rem', margin: '0', fontSize: '1.25rem' }),
  cardDescription: css({ color: 'text.muted', '& p': { margin: '0' } }),
  stack: css({ display: 'grid', justifyItems: 'start', gap: '1rem' }),
  enabled: css({ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'text.primary', fontWeight: '600' }),
  note: css({ margin: '0', color: 'text.muted' }),
  setup: css({ display: 'grid', gap: '1.5rem', minWidth: '0' }),
  step: css({ display: 'grid', gap: '0.75rem', minWidth: '0' }),
  stepTitle: css({ margin: '0', fontSize: '1rem', fontWeight: '600' }),
  stepCopy: css({ margin: '0', color: 'text.muted' }),
  qr: css({ justifySelf: 'start', maxWidth: '100%', padding: '0.75rem', borderWidth: '1px', borderStyle: 'solid', borderColor: 'border.input', borderRadius: 'l2', background: 'bg.input', '& svg': { maxWidth: '100%', height: 'auto' } }),
  secret: css({ display: 'inline-block', marginTop: '0.5rem', padding: '0.375rem 0.625rem', borderRadius: 'l1', background: 'bg.input', color: 'text.primary', fontFamily: 'tabular', fontFeatureSettings: '"tnum" 1, "cv01" 1', fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere', userSelect: 'all' }),
  verifyForm: css({ display: 'flex', flexWrap: 'wrap', alignItems: 'end', gap: '0.75rem' }),
  codeField: css({ display: 'grid', gap: '0.375rem', minWidth: '12rem', flex: '1' }),
  codeLabel: css({ fontWeight: '600' }),
  codeInput: css({ maxWidth: '14rem', fontFamily: 'tabular', fontFeatureSettings: '"tnum" 1, "cv01" 1', fontVariantNumeric: 'tabular-nums' }),
};

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
    <div className={securityStyles.page}>
      <TocynConfirmDialog open={disableOpen} onOpenChange={setDisableOpen} busy={isLoading}
        title="Disable two-factor authentication?" description="This will make your account less secure and sign you out. You will need to sign in again."
        confirmLabel="Disable 2FA" error={error ?? undefined} onConfirm={() => { void disableMfa(); }}
        finalFocusEl={() => user.mfa_enabled ? disableButton.current : heading.current} />
      <div>
        <h1 ref={heading} tabIndex={-1} className={securityStyles.title}>Security Profile</h1>
        <p className={securityStyles.description}>
          Manage your account security and two-factor authentication settings.
        </p>
      </div>

      {successMessage && (
        <div role="status" className={securityStyles.success}>
          <div className={securityStyles.statusInner}>
            <div className={securityStyles.statusInner}>
              <IconShieldHalved className={securityStyles.statusIcon} aria-hidden="true" />
            </div>
            <div >
              <p>{successMessage}</p>
            </div>
          </div>
        </div>
      )}

      {error && !disableOpen && (
        <div role="alert" className={securityStyles.error}>
          <div className={securityStyles.statusInner}>
            <div className={securityStyles.statusInner}>
              <IconTriangleExclamation className={securityStyles.statusIcon} aria-hidden="true" />
            </div>
            <div >
              <p>{error}</p>
            </div>
          </div>
        </div>
      )}

      <ParkCard.Root className={securityStyles.card}>
        <ParkCard.Body className={securityStyles.cardBody}>
          <ParkCard.Title className={securityStyles.cardTitle}>
            <IconShieldHalved className={securityStyles.statusIcon} aria-hidden="true" />
            Two-Factor Authentication (2FA)
          </ParkCard.Title>
          <div className={securityStyles.cardDescription}>
            <p>
              Add an additional layer of security to your account by requiring more than just a password to sign in.
            </p>
          </div>

          <div >
            {user.mfa_enabled ? (
              <div className={securityStyles.stack}>
                <div className={securityStyles.enabled}>
                  <IconShieldHalved className={securityStyles.statusIcon} aria-hidden="true" />
                  2FA is currently enabled
                </div>
                {(user.role === 'admin' || user.role === 'agent') ? (
                  <p className={securityStyles.note}>
                    Two-Factor Authentication is mandatory for your role and cannot be disabled.
                  </p>
                ) : (
                  <ParkButton
                    type="button"
                    ref={disableButton}
                    onClick={() => { setError(null); setDisableOpen(true); }}
                    disabled={isLoading}
                    variant="destructive"
                  >
                    <IconShield className={securityStyles.statusIcon} aria-hidden="true" />
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
                    variant="solid"
                  >
                    <IconKey className={securityStyles.statusIcon} aria-hidden="true" />
                    Set up 2FA
                  </ParkButton>
                ) : (
                  <div className={securityStyles.setup}>
                    <div className={securityStyles.step}>
                      <h4 className={securityStyles.stepTitle}>Step 1: Scan QR Code</h4>
                      <p className={securityStyles.stepCopy}>
                        Scan the QR code below with your authenticator app (like Google Authenticator, Authy, or Microsoft Authenticator).
                      </p>
                      <div className={securityStyles.qr}>
                        <QRCodeSVG value={setupData.provisioning_uri} size={200} />
                      </div>
                      <p className={securityStyles.stepCopy}>
                        If you can't scan the QR code, you can manually enter this secret key:<br/>
                        <code className={securityStyles.secret}>{getSecretFromUri(setupData.provisioning_uri)}</code>
                      </p>
                    </div>

                    <div className={securityStyles.step}>
                      <h4 className={securityStyles.stepTitle}>Step 2: Verify Code</h4>
                      <form onSubmit={confirmSetup} aria-label="Verify two-factor setup" aria-busy={isLoading} className={securityStyles.verifyForm}>
                        <div className={securityStyles.codeField}>
                          <label htmlFor="code" className={securityStyles.codeLabel}>
                            Authentication Code
                          </label>
                          <ParkInput
                            type="text"
                            id="code" ref={codeInput} inputMode="numeric" autoComplete="one-time-code" disabled={isLoading}
                            value={code}
                            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                            className={securityStyles.codeInput}
                            placeholder="000000"
                            maxLength={6}
                            required
                          />
                        </div>
                        <ParkButton
                          type="submit"
                          disabled={isLoading || code.length !== 6}
                          variant="solid"
                        >
                          Verify & Enable
                        </ParkButton>
                        <ParkButton
                          type="button"
                          onClick={() => { setSetupData(null); setCode(''); setError(null); requestAnimationFrame(() => setupButton.current?.focus()); }}
                          disabled={isLoading}
                          variant="outline"
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
        </ParkCard.Body>
      </ParkCard.Root>
    </div>
  );
}
