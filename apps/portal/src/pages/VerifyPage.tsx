import { ParkButton, ParkInput } from '@luminatick/ui/park';
import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import type { User } from '../types';
import { portalApi, getWidgetKey } from '../api/client';
import { useAuthStore } from '../store/authStore';
import {
  FaSpinner,
  FaCircleCheck
} from '@luminatick/ui/icons';

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
      <div className="tocyn-portal-auth-shell">
        <div role="status" aria-live="polite" className="tocyn-portal-auth-heading tocyn-portal-verify-loading">
          <FaSpinner className="tocyn-portal-verify-spinner" />
          <h2 className="tocyn-portal-verify-loading-title">Verifying your login...</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="tocyn-portal-auth-shell">
      <div className="tocyn-portal-auth-heading tocyn-portal-verify-heading">
        <h2 className="tocyn-portal-verify-title">
          Enter Verification Code
        </h2>
        <p className="tocyn-portal-verify-copy">
          {initialEmail ? (
            <>We sent a 6-digit code to <strong>{initialEmail}</strong></>
          ) : (
            'Enter the 6-digit code sent to your email'
          )}
        </p>
      </div>

      <div className="tocyn-portal-auth-card">
        <div className="tocyn-portal-auth-card-body">
          {error && (
            <div id="portal-verify-error" role="alert" aria-atomic="true" className="tocyn-portal-auth-error">
              {error}
            </div>
          )}

          <form aria-busy={loading} className="tocyn-portal-auth-form" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="code" className="tocyn-portal-auth-label">
                Authentication Code
              </label>
              <div className="tocyn-portal-verify-input">
                <ParkInput
                  id="code"
                  ref={codeInput}
                  name="code"
                  inputMode="numeric"
                  aria-describedby={error ? "portal-verify-error" : undefined}
                  type="text"
                  required
                  value={code}
                  onChange={(e) => { if (!loading) setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); }}
                  className="tocyn-form-control tocyn-form-control--code"
                  placeholder="123456"
                  maxLength={6}
                  disabled={loading}
                  autoComplete="one-time-code"
                />
              </div>
            </div>

            <div>
              <ParkButton
                type="submit"
                aria-disabled={loading || code.length !== 6}
                className="tocyn-portal-auth-submit"
              >
                {loading ? <FaSpinner className="tocyn-portal-auth-spinner" /> : <FaCircleCheck className="tocyn-portal-auth-icon" />}
                {loading ? 'Verifying...' : 'Verify Code'}
              </ParkButton>
            </div>
          </form>
          <p role="status" aria-live="polite" className="tocyn-portal-auth-status">{loading ? 'Verifying code…' : ''}</p>

          <div className="tocyn-portal-verify-back">
            <ParkButton
              onClick={() => { if (!loading) { if (onBack) onBack(); else { const key = getWidgetKey(); navigate('/login' + (key ? '?key=' + encodeURIComponent(key) : '')); } } }}
              disabled={loading}
              className="tocyn-portal-verify-request"
            >
              Request a new code
            </ParkButton>
          </div>
        </div>
      </div>
    </div>
  );
}
