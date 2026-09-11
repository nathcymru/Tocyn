import { TocynButton, TocynInput } from '@luminatick/ui/primitives';
import React, { useEffect, useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { useAuthStore } from '../store/authStore';
import { dashboardApi } from '../api/client';
import { AuthResponse } from '../types';
import { Shield, KeyRound, AlertTriangle } from 'lucide-react';

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
  const codeInput = React.useRef<HTMLInputElement>(null);
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
    codeInput.current?.focus();
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
    <div className="w-full">
      <div className="w-full">
        <div className="text-center mb-8">
          <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-indigo-100 mb-4">
            {isSetupMode ? (
              <KeyRound className="h-6 w-6 text-indigo-600" />
            ) : (
              <Shield className="h-6 w-6 text-indigo-600" />
            )}
          </div>
          <h1 className="text-2xl font-bold text-slate-900">
            {isSetupMode ? 'Set up Two-Factor Authentication' : 'Two-Factor Authentication'}
          </h1>
          <p id="mfa-instructions" className="text-slate-600 mt-2">
            {isSetupMode
              ? 'Your account requires an additional layer of security. Please scan the QR code with your authenticator app.'
              : 'Enter the 6-digit code from your authenticator app'}
          </p>
        </div>

        {error && (
          <div id="mfa-error" role="alert" aria-atomic="true" className="mb-6 p-4 bg-red-50 border-l-4 border-red-400 text-red-700 text-sm rounded-r-md flex items-start">
            <AlertTriangle className="h-5 w-5 mr-2 flex-shrink-0" />
            <p>{error}</p>
          </div>
        )}

        {isSetupMode && !setupData && error && (
          <TocynButton type="button" aria-disabled={loading}
            onClick={() => {
              if (loading) return;
              setLoading(true);
              retryingSetup.current = true;
              setupPromise.current = null;
              setSetupAttempt(previous => previous + 1);
            }} className="mb-4 rounded border border-slate-500 px-3 py-2 text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
            Retry authenticator setup
          </TocynButton>
        )}

        {isSetupMode && setupData && (
          <div className="mb-6 text-center">
            <div className="bg-white p-4 rounded-lg inline-block shadow-sm border border-gray-100 mb-4">
              <QRCodeSVG role="img" aria-label="Authenticator setup QR code; a text key follows" value={setupData.provisioning_uri} size={180} />
            </div>
            <p className="text-xs text-gray-700 max-w-[250px] mx-auto">
              If you can't scan the QR code, manually enter this secret key:<br/>
              <code className="bg-gray-100 px-2 py-1 rounded mt-2 inline-block font-mono text-sm break-all">
                {getSecretFromUri(setupData.provisioning_uri)}
              </code>
            </p>
          </div>
        )}

        <form aria-busy={loading} onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="mfa-code" className="block text-sm font-medium text-slate-700 mb-2 text-center">
              Authentication Code
            </label>
            <TocynInput
              id="mfa-code"
              ref={codeInput}
              readOnly={loading}
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              aria-describedby={error ? "mfa-instructions mfa-error" : "mfa-instructions"}
              type="text"
              required
              maxLength={6}
              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50 text-center text-3xl tracking-[0.5em] font-mono h-14"
              placeholder="000000"
              value={code}
              onChange={(e) => { if (!loading) setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); }}
              autoFocus
            />
          </div>
          <TocynButton
            type="submit"
            aria-disabled={loading || code.length !== 6 || (isSetupMode && !setupData)}
            className="inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:pointer-events-none disabled:opacity-50 bg-brand-500 text-white hover:bg-brand-600 w-full aria-disabled:bg-brand-700 aria-disabled:cursor-default h-11 text-base"
          >
            {loading ? 'Verifying...' : isSetupMode ? 'Verify & Enable' : 'Verify Code'}
          </TocynButton>
        </form>
        {!isSetupMode && <TocynButton type="button" disabled={loading} className="mt-4 min-h-11 w-full text-sm" onClick={() => { useAuthStore.getState().logout(); navigate('/login', { replace: true }); }}>Back to credentials</TocynButton>}
        <p role="status" aria-live="polite" className="mt-3 text-sm text-slate-700">{loading ? (isSetupMode && !setupData ? 'Preparing authenticator setup…' : 'Verifying code…') : setupStatus}</p>
      </div>
    </div>
  );
}
