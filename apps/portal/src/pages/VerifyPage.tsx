import { TocynButton, TocynInput } from '@luminatick/ui/primitives';
import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import type { User } from '../types';
import { portalApi } from '../api/client';
import { useAuthStore } from '../store/authStore';
import { Loader2, CheckCircle } from 'lucide-react';

export function VerifyPage({ challenge, onBack }: { challenge?: { email: string; challengeId?: string }; onBack?: () => void } = {}) {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { login } = useAuthStore();

  const [code, setCode] = useState('');
  const codeInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (challenge) codeInput.current?.focus(); }, [challenge]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tokenParam = searchParams.get('token');
  const initialEmail = challenge?.email ?? location.state?.email ?? '';

  const verification = useRef<{
    token: string;
    request: Promise<{ user: User; token: string }>;
  } | null>(null);

  useEffect(() => {
    if (!tokenParam) return;
    let active = true;
    // Reuse the request during StrictMode effect replay: tokens are single-use.
    if (verification.current?.token !== tokenParam) {
      verification.current = {
        token: tokenParam,
        request: portalApi.post<{ user: User; token: string }>('/auth/verify', { token: tokenParam }),
      };
    }
    verification.current.request
      .then(response => {
        if (!active) return;
        if (response.token) { try { localStorage.setItem('lumina_customer_token', response.token); } catch { /* HttpOnly cookie remains available. */ } }
        login(response.user);
        navigate('/tickets', { replace: true });
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : 'Invalid or expired login code.');
      });
    return () => { active = false; };
  }, [tokenParam, login, navigate]);

  const verifyToken = async (tokenToVerify: string) => {
    setLoading(true);
    setError(null);

    try {
      const response = await portalApi.post<{ user: User, token: string }>('/auth/verify', { token: tokenToVerify, challengeId: challenge?.challengeId ?? location.state?.challengeId });
      if (response.token) {
        try { localStorage.setItem('lumina_customer_token', response.token); } catch { /* HttpOnly cookie remains available. */ }
      }
      login(response.user);
      navigate('/tickets', { replace: true });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid or expired login code.');
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || code.length !== 6) return;
    verifyToken(code);
  };

  // If we're verifying a magic link from URL, show a loading state
  if (tokenParam && !error) {
    return (
      <div className="w-full">
        <div role="status" aria-live="polite" className="sm:mx-auto sm:w-full sm:max-w-md text-center">
          <Loader2 className="mx-auto w-12 h-12 text-brand-600 animate-spin mb-4" />
          <h2 className="text-2xl font-extrabold text-gray-900">Verifying your login...</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
          Enter Verification Code
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          {initialEmail ? (
            <>We sent a 6-digit code to <strong>{initialEmail}</strong></>
          ) : (
            'Enter the 6-digit code sent to your email'
          )}
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="py-8">
          {error && (
            <div id="portal-verify-error" role="alert" aria-atomic="true" className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm p-3 rounded-md">
              {error}
            </div>
          )}

          <form aria-busy={loading} className="space-y-6" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="code" className="block text-sm font-medium text-gray-700">
                Authentication Code
              </label>
              <div className="mt-1">
                <TocynInput
                  id="code"
                  ref={codeInput}
                  name="code"
                  inputMode="numeric"
                  aria-describedby={error ? "portal-verify-error" : undefined}
                  type="text"
                  required
                  value={code}
                  onChange={(e) => { if (!loading) setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); }}
                  className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-brand-500 focus:border-brand-500 text-center text-2xl tracking-widest uppercase font-mono"
                  placeholder="123456"
                  maxLength={6}
                  disabled={loading}
                  autoComplete="one-time-code"
                />
              </div>
            </div>

            <div>
              <TocynButton
                type="submit"
                aria-disabled={loading || code.length !== 6}
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-500 aria-disabled:bg-brand-700 aria-disabled:cursor-default items-center gap-2"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle className="w-5 h-5" />}
                {loading ? 'Verifying...' : 'Verify Code'}
              </TocynButton>
            </div>
          </form>
          <p role="status" aria-live="polite" className="mt-3 text-sm text-gray-700">{loading ? 'Verifying code…' : ''}</p>

          <div className="mt-6 text-center">
            <TocynButton
              onClick={() => { if (!loading) { if (onBack) onBack(); else navigate('/login'); } }}
              disabled={loading}
              className="text-sm text-brand-600 hover:text-brand-500 font-medium"
            >
              Request a new code
            </TocynButton>
          </div>
        </div>
      </div>
    </div>
  );
}
