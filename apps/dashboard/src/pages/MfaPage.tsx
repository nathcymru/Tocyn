import { ParkButton, ParkPinInput, ParkPinInputSlot } from '@luminatick/ui/park';
import React, { useEffect, useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { useAuthStore } from '../store/authStore';
import { dashboardApi } from '../api/client';
import { AuthResponse } from '../types';
import { IconShieldHalved, IconKey, IconTriangleExclamation } from '@luminatick/ui/icons';

interface SetupResponse {
  provisioning_uri: string;
}

export function MfaPage() {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [setupAttempt, setSetupAttempt] = useState(0);
  const [setupStatus, setSetupStatus] = useState('');
  const setupPromise = React.useRef<Promise<SetupResponse> | null>(null);
  const retryingSetup = React.useRef(false);
  const codeInput = React.useRef<HTMLDivElement>(null);
  const [setupData, setSetupData] = useState<SetupResponse | null>(null);

  const navigate = useNavigate();
  const setAuth = useAuthStore((state) => state.setAuth);
  const user = useAuthStore((state) => state.user);

  useEffect(() => {
    if (!user || user.mfa_enabled) return;
    let active = true;
    setLoading(true);
    // Reuse the same initial request across effect cleanup/setup. An explicit
    // retry clears this promise only after a failed attempt has settled.
    setupPromise.current ??= dashboardApi.post<SetupResponse>('/auth/mfa/setup');
    setupPromise.current.then(data => {
      if (!active) return;
      setSetupData(data);
      setError('');
      setSetupStatus('Authenticator setup ready. Scan the QR code or enter the text key, then enter your authentication code.');
    }).catch((err: unknown) => {
      if (active) {
        setSetupStatus('');
        setError(err instanceof Error ? err.message : 'Failed to start MFA setup');
      }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user, setupAttempt]);

  useEffect(() => {
    if (!setupData || !retryingSetup.current) return;
    // Focus only after React has committed the retry-created input.
    codeInput.current?.querySelector<HTMLInputElement>('[data-scope="pin-input"][data-part="input"]')?.focus();
    retryingSetup.current = false;
  }, [setupData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || code.length !== 6 || (!user?.mfa_enabled && !setupData)) return;
    setError('');
    setSetupStatus('');
    setLoading(true);

    try {
      let data: AuthResponse;
      if (!user?.mfa_enabled) {
        // Confirm setup
        data = await dashboardApi.post<AuthResponse>('/auth/mfa/confirm', { code });
      } else {
        // Normal verify
        data = await dashboardApi.post<AuthResponse>('/auth/mfa/verify', { code });
      }

      setAuth(data.token, data.user);
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Invalid MFA code');
    } finally {
      setLoading(false);
    }
  };

  const getSecretFromUri = (uri: string) => {
    try {
      return new URL(uri).searchParams.get('secret') || '';
    } catch {
      return '';
    }
  };

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  const isSetupMode = !user.mfa_enabled;

  return (
    <div className="tocyn-auth-page">
      <div className="tocyn-auth-card">
        <div className="tocyn-auth-heading">
          <div className="tocyn-mfa-icon-wrap">
            {isSetupMode ? (
              <IconKey className="tocyn-mfa-icon" />
            ) : (
              <IconShieldHalved className="tocyn-mfa-icon" />
            )}
          </div>
          <h1 className="tocyn-mfa-title">
            {isSetupMode ? 'Set up Two-Factor Authentication' : 'Two-Factor Authentication'}
          </h1>
          <p id="mfa-instructions" className="tocyn-mfa-instructions">
            {isSetupMode
              ? 'Your account requires an additional layer of security. Please scan the QR code with your authenticator app.'
              : 'Enter the 6-digit code from your authenticator app'}
          </p>
        </div>

        {error && (
          <div id="mfa-error" role="alert" aria-atomic="true" className="tocyn-auth-alert tocyn-mfa-alert">
            <IconTriangleExclamation className="tocyn-mfa-alert-icon" />
            <p>{error}</p>
          </div>
        )}

        {isSetupMode && !setupData && error && (
          <ParkButton type="button" aria-disabled={loading}
            onClick={() => {
              if (loading) return;
              setLoading(true);
              retryingSetup.current = true;
              setupPromise.current = null;
              setSetupAttempt(previous => previous + 1);
            }} className="tocyn-mfa-retry">
            Retry authenticator setup
          </ParkButton>
        )}

        {isSetupMode && setupData && (
          <div className="tocyn-mfa-setup">
            <div className="tocyn-mfa-qr">
              <QRCodeSVG role="img" aria-label="Authenticator setup QR code; a text key follows" value={setupData.provisioning_uri} size={180} />
            </div>
            <p className="tocyn-mfa-secret-help">
              If you can't scan the QR code, manually enter this secret key:<br/>
              <code className="tocyn-mfa-secret">
                {getSecretFromUri(setupData.provisioning_uri)}
              </code>
            </p>
          </div>
        )}

        <form aria-busy={loading} onSubmit={handleSubmit} className="tocyn-auth-form">
          <div>
            <ParkPinInput
              id="mfa-code"
              ref={codeInput}
              defaultValue={Array.from({ length: 6 }, () => '')}
              onValueChange={(details) => { const value = details?.value ?? []; if (!loading) setCode(value.join('').replace(/\D/g, '').slice(0, 6)); }}
              disabled={loading}
              readOnly={loading}
              invalid={Boolean(error)}
              autoFocus
              aria-describedby={error ? "mfa-instructions mfa-error" : "mfa-instructions"}
              otp
              name="code"
              placeholder="0"
            >
              <span className="tocyn-visually-hidden">Authentication Code</span>
              {Array.from({ length: 6 }, (_, index) => <ParkPinInputSlot key={index} index={index}
                aria-label={index === 0 ? 'Authentication Code' : `Authentication Code digit ${index + 1}`}
                aria-describedby={error ? 'mfa-instructions mfa-error' : 'mfa-instructions'}
                readOnly={loading}
              />)}
            </ParkPinInput>
          </div>
          <ParkButton
            type="submit"
            aria-disabled={loading || code.length !== 6 || (isSetupMode && !setupData)}
            className="tocyn-auth-submit"
          >
            {loading ? 'Verifying...' : isSetupMode ? 'Verify & Enable' : 'Verify Code'}
          </ParkButton>
        </form>
        {!isSetupMode && <ParkButton type="button" disabled={loading} className="tocyn-auth-secondary" onClick={() => { useAuthStore.getState().logout(); navigate('/login', { replace: true }); }}>Back to credentials</ParkButton>}
        <p role="status" aria-live="polite" className="tocyn-auth-status">{loading ? (isSetupMode && !setupData ? 'Preparing authenticator setup…' : 'Verifying code…') : setupStatus}</p>
      </div>
    </div>
  );
}
