import { p } from '../portalStyles';
import { ParkAlert, ParkButton, ParkCard, ParkPinInput, ParkPinInputSlot, ParkProgress } from '@luminatick/ui/park';
import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import type { User } from '../types';
import { portalApi, getWidgetKey } from '../api/client';
import { useAuthStore } from '../store/authStore';
import {
  IconSpinner,
  IconCircleCheck
} from '@luminatick/ui/icons';

export function VerifyPage({ challenge, onBack }: { challenge?: { email: string; challengeId?: string }; onBack?: () => void } = {}) {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { login } = useAuthStore();

  const [code, setCode] = useState('');
  const codeInput = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (challenge) codeInput.current?.querySelector<HTMLInputElement>('[data-scope="pin-input"][data-part="input"]')?.focus();
  }, [challenge]);
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
      <div className={p.authShell}>
        <div role="status" aria-live="polite" className={[p.authHeading, p.verifyLoading].join(' ')}>
          <h2 className={p.verifyLoadingTitle}>Verifying your login...</h2>
          <ParkProgress value={null} label="Verification in progress" />
        </div>
      </div>
    );
  }

  return (
    <div className={p.authShell}>
      <div className={[p.authHeading, p.verifyHeading].join(' ')}>
        <h2 className={p.verifyTitle}>
          Enter Verification Code
        </h2>
        <p className={p.verifyCopy}>
          {initialEmail ? (
            <>We sent a 6-digit code to <strong>{initialEmail}</strong></>
          ) : (
            'Enter the 6-digit code sent to your email'
          )}
        </p>
      </div>

      <ParkCard.Root>
        <ParkCard.Body className={p.authForm}>
          {error && (
            <ParkAlert.Root id="portal-verify-error" role="alert" aria-atomic="true" status="error" variant="surface">
              <ParkAlert.Content><ParkAlert.Description>{error}</ParkAlert.Description></ParkAlert.Content>
            </ParkAlert.Root>
          )}

          <form aria-busy={loading} className={p.authForm} onSubmit={handleSubmit}>
            <div className={p.verifyPinWrap}>
              <ParkPinInput
                ref={codeInput}
                name="code"
                aria-describedby={error ? "portal-verify-error" : undefined}
                required
                count={6}
                value={code.split('')}
                onValueChange={(details) => { if (!loading) setCode(details.value.join('').replace(/\D/g, '').slice(0, 6)); }}
                invalid={Boolean(error)}
                disabled={loading}
                readOnly={loading}
                otp
                placeholder="0"
              >
                <span className={p.visuallyHidden}>Authentication Code</span>
                {Array.from({ length: 6 }, (_, index) => <ParkPinInputSlot
                  key={index}
                  index={index}
                  aria-label={index === 0 ? 'Authentication Code' : `Authentication Code digit ${index + 1}`}
                  aria-describedby={error ? 'portal-verify-error' : undefined}
                  readOnly={loading}
                  onInput={(event) => {
                    // Password managers may fill the entire OTP into one visible cell.
                    const entered = event.currentTarget.value;
                    if (!loading && entered.length > 1) setCode(entered.replace(/\D/g, '').slice(0, 6));
                  }}
                  onPaste={(event) => {
                    if (loading) return;
                    event.preventDefault();
                    setCode(event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6));
                  }}
                />)}
              </ParkPinInput>
            </div>

            <div>
              <ParkButton
                type="submit"
                aria-disabled={loading || code.length !== 6}
                variant="solid" className={p.authSubmit}
              >
                {loading ? <IconSpinner className={p.authSpinner} aria-hidden="true" /> : <IconCircleCheck className={p.authIcon} aria-hidden="true" />}
                {loading ? 'Verifying...' : 'Verify Code'}
              </ParkButton>
            </div>
          </form>
          <p role="status" aria-live="polite" className={p.authStatus}>{loading ? 'Verifying code…' : ''}</p>

          <div className={p.verifyBack}>
            <ParkButton
              onClick={() => { if (!loading) { if (onBack) onBack(); else { const key = getWidgetKey(); navigate('/login' + (key ? '?key=' + encodeURIComponent(key) : '')); } } }}
              disabled={loading}
              variant="plain"
            >
              Request a new code
            </ParkButton>
          </div>
        </ParkCard.Body>
      </ParkCard.Root>
    </div>
  );
}
