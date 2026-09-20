import { ParkAlert, ParkButton, ParkCard, ParkDialog, ParkPinInput, ParkPinInputSlot } from '@luminatick/ui/park';
import { Badge } from '@luminatick/ui/components';
import { css } from '@luminatick/ui/styled-system/css';
import React, { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { dashboardApi } from '../api/client';
import { useAuthStore } from '../store/authStore';
import {
  IconShieldHalved,
  IconShield,
  IconKey
} from '@luminatick/ui/icons';

interface SetupResponse {
  provisioning_uri: string;
}

const securityStyles = {
  page: css({ width: '100%', maxWidth: '48rem', marginInline: 'auto', padding: '2rem 1rem', display: 'grid', gap: '1.5rem', color: 'fg.default' }),
  title: css({ margin: '0', textStyle: '2xl', fontWeight: 'semibold', color: 'fg.default' }),
  description: css({ marginTop: '0.375rem', color: 'fg.muted' }),
  statusIcon: css({ width: '1.5rem', height: '1.5rem', flexShrink: '0' }),
  cardBody: css({ display: 'grid', gap: '1.25rem' }),
  stack: css({ display: 'grid', justifyItems: 'start', gap: '1rem' }),
  note: css({ margin: '0', color: 'fg.muted' }),
  setup: css({ display: 'grid', gap: '1.5rem', minWidth: '0' }),
  step: css({ display: 'grid', gap: '0.75rem', minWidth: '0' }),
  stepTitle: css({ margin: '0', fontSize: '1rem', fontWeight: '600' }),
  stepCopy: css({ margin: '0', color: 'fg.muted' }),
  qr: css({ justifySelf: 'start', maxWidth: '100%', padding: '0.75rem', borderWidth: '1px', borderStyle: 'solid', borderColor: 'border.default', borderRadius: 'l2', background: 'bg.subtle', '& svg': { maxWidth: '100%', height: 'auto' } }),
  secret: css({ display: 'inline-block', marginTop: '0.5rem', padding: '0.375rem 0.625rem', borderRadius: 'l1', background: 'bg.subtle', color: 'fg.default', fontFamily: 'tabular', fontFeatureSettings: '"tnum" 1, "cv01" 1', fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere', userSelect: 'all' }),
  verifyForm: css({ display: 'flex', flexWrap: 'wrap', alignItems: 'end', gap: '0.75rem' }),
  codeField: css({ display: 'grid', gap: '0.375rem', minWidth: '0', maxWidth: '100%', flex: '1 1 100%' }),
  codeCell: css({ fontFamily: 'tabular', fontFeatureSettings: '"tnum" 1, "cv01" 1', fontVariantNumeric: 'tabular-nums' }),
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
  const codeInput = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const disableButton = useRef<HTMLButtonElement>(null);
  const disableCancel = useRef<HTMLButtonElement>(null);
  const disableTitleId = React.useId();
  const disableDescriptionId = React.useId();
  const [disableOpen, setDisableOpen] = useState(false);
  useEffect(() => { setSetupData(null); setCode(''); setDisableOpen(false); }, [sessionGeneration]);
  useEffect(() => {
    if (sessionAnnouncement?.generation !== sessionGeneration) return;
    setSuccessMessage(sessionAnnouncement.message);
    clearSessionAnnouncement(sessionGeneration);
  }, [clearSessionAnnouncement, sessionAnnouncement, sessionGeneration]);
  useEffect(() => {
    if (setupData) codeInput.current?.querySelector<HTMLInputElement>('[data-scope="pin-input"][data-part="input"]')?.focus();
  }, [setupData]);
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
      <ParkDialog.Root open={disableOpen} onOpenChange={({ open }) => { if (!isLoading) setDisableOpen(open); }}
        initialFocusEl={() => disableCancel.current}
        finalFocusEl={() => user.mfa_enabled ? disableButton.current : heading.current}
        closeOnEscape={!isLoading} closeOnInteractOutside={false} lazyMount unmountOnExit>
        <ParkDialog.Backdrop />
        <ParkDialog.Positioner>
          <ParkDialog.Content aria-labelledby={disableTitleId} aria-describedby={disableDescriptionId}>
            <ParkDialog.Header>
              <ParkDialog.Title id={disableTitleId}>Disable two-factor authentication?</ParkDialog.Title>
            </ParkDialog.Header>
            <ParkDialog.Body>
              <ParkDialog.Description id={disableDescriptionId}>This will make your account less secure and sign you out. You will need to sign in again.</ParkDialog.Description>
              {error && <ParkAlert.Root role="alert" aria-atomic="true" status="error" variant="surface">
                <ParkAlert.Content><ParkAlert.Description>{error}</ParkAlert.Description></ParkAlert.Content>
              </ParkAlert.Root>}
            </ParkDialog.Body>
            <ParkDialog.Footer>
              <ParkButton ref={disableCancel} type="button" disabled={isLoading} onClick={() => setDisableOpen(false)}>Cancel</ParkButton>
              <ParkButton type="button" disabled={isLoading} onClick={() => { void disableMfa(); }}>Disable 2FA</ParkButton>
            </ParkDialog.Footer>
          </ParkDialog.Content>
        </ParkDialog.Positioner>
      </ParkDialog.Root>
      <div>
        <h1 ref={heading} tabIndex={-1} className={securityStyles.title}>Security Profile</h1>
        <p className={securityStyles.description}>
          Manage your account security and two-factor authentication settings.
        </p>
      </div>

      {successMessage && (
        <ParkAlert.Root role="status" status="success">
          <ParkAlert.Content><ParkAlert.Description>{successMessage}</ParkAlert.Description></ParkAlert.Content>
        </ParkAlert.Root>
      )}

      {error && !disableOpen && (
        <ParkAlert.Root role="alert" status="error">
          <ParkAlert.Content><ParkAlert.Description>{error}</ParkAlert.Description></ParkAlert.Content>
        </ParkAlert.Root>
      )}

      <ParkCard.Root variant="outline">
        <ParkCard.Header>
          <ParkCard.Title asChild><h2 className={css({ display: 'flex', alignItems: 'center', gap: '2' })}>
            <IconShieldHalved className={securityStyles.statusIcon} aria-hidden="true" />
            Two-Factor Authentication (2FA)
          </h2></ParkCard.Title>
          <ParkCard.Description>
            Add an additional layer of security to your account by requiring more than just a password to sign in.
          </ParkCard.Description>
        </ParkCard.Header>
        <ParkCard.Body className={securityStyles.cardBody}>
          <div>
            {user.mfa_enabled ? (
              <div className={securityStyles.stack}>
                <Badge colorPalette="green">
                  <IconShieldHalved className={securityStyles.statusIcon} aria-hidden="true" />
                  2FA is currently enabled
                </Badge>
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
                    variant="outline"
                    colorPalette="red"
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
                        <QRCodeSVG role="img" aria-label="Authenticator setup QR code; a text key follows" value={setupData.provisioning_uri} size={200} />
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
                          <ParkPinInput
                            id="code"
                            ref={codeInput}
                            count={6}
                            size="xs"
                            label="Authentication Code"
                            name="code"
                            otp
                            value={Array.from({ length: 6 }, (_, index) => code[index] ?? '')}
                            onValueChange={({ value }) => {
                              if (!isLoading) {
                                setCode(value.join('').replace(/\D/g, '').slice(0, 6));
                                setError(null);
                              }
                            }}
                            sanitizeValue={value => value.replace(/\D/g, '').slice(0, 6)}
                            disabled={isLoading}
                            readOnly={isLoading}
                            invalid={Boolean(error)}
                            placeholder="0"
                          >
                            {Array.from({ length: 6 }, (_, index) => (
                              <ParkPinInputSlot
                                key={index}
                                index={index}
                                aria-label={index === 0 ? 'Authentication Code' : `Authentication Code digit ${index + 1}`}
                                className={securityStyles.codeCell}
                              />
                            ))}
                          </ParkPinInput>
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
