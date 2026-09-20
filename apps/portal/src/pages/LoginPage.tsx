import { p } from '../portalStyles';
import { ParkButton, ParkInput } from '@luminatick/ui/park';
import { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { VerifyPage } from './VerifyPage';
import { portalApi } from '../api/client';
import {
  IconEnvelope,
  IconSpinner,
  IconArrowRight
} from '@luminatick/ui/icons';
import { Turnstile } from '@marsidev/react-turnstile';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [type, setType] = useState<'magic_link' | 'otp'>('magic_link');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const [challenge, setChallenge] = useState<{ email: string; challengeId?: string } | null>(() => location.state?.authStep === 'verify' ? location.state.challenge : null);
  const successHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (success && type === 'magic_link') successHeading.current?.focus();
  }, [success, type]);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const config = await portalApi.get<{TURNSTILE_SITE_KEY?: string}>('/config');
        if (config.TURNSTILE_SITE_KEY) {
          setSiteKey(config.TURNSTILE_SITE_KEY);
        }
      } catch (err) {
        console.error('Failed to fetch config:', err);
      }
    };
    fetchConfig();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || loading || success || (siteKey && !turnstileToken)) return;

    setLoading(true);
    setError(null);

    try {
      const result = await portalApi.post<{ challengeId?: string }>('/auth/request', {
        email,
        type,
        turnstileToken,
        baseUrl: window.location.origin
      });
      setSuccess(true);

      if (type === 'otp') {
        const next = { email, challengeId: result.challengeId };
        setChallenge(next);
        navigate('/login' + location.search, { replace: true, state: { authStep: 'verify', challenge: next } });
      }
    } catch (err: unknown) {
      const error = err as Error;
      setError(error.message || 'Failed to request login link');
    } finally {
      setLoading(false);
    }
  };

  if (challenge) return <VerifyPage challenge={challenge} onBack={() => { setChallenge(null); setSuccess(false); setTurnstileToken(null); navigate('/login' + location.search, { replace: true, state: null }); }} />;

  if (success && type === 'magic_link') {
    return (
      <div className={p.authShell}>
        <div className={[p.authHeading, p.authSuccess].join(' ')}>
          <div className={p.authSuccessIcon}>
            <IconEnvelope className={p.authSuccessMark} />
          </div>
          <h2 ref={successHeading} tabIndex={-1} className={p.authSuccessTitle}>Check your email</h2>
          <p className={p.authSuccessCopy}>
            We sent a magic link to <strong>{email}</strong>.<br/>
            Click the link in the email to log in.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={p.authShell}>
      <div className={[p.authHeading, p.authLoginHeading].join(' ')}>
        <h2>
          Sign in to Support
        </h2>
        <p>
          Enter your email to receive a secure login link or code.
        </p>
      </div>

      <div className={p.authCard}>
        <div className={p.authCardBody}>
          {error && (
            <div id="portal-login-error" role="alert" aria-atomic="true" className={p.authError}>
              {error}
            </div>
          )}
          {success && type === 'otp' && (
            <div role="status" className={p.authNotice}>
              OTP sent! Redirecting to verification...
            </div>
          )}

          <form aria-busy={loading} className={p.authForm} onSubmit={handleSubmit}>
            <div className={p.authField}>
              <label htmlFor="email" className={p.authLabel}>
                Email address
              </label>
              <div className={p.authInput}>
                <ParkInput
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  aria-describedby={error ? "portal-login-error" : undefined}
                  required
                  value={email}
                  onChange={(e) => { if (!loading && !success) setEmail(e.target.value); }}
                  className={p.formControl}
                  placeholder="you@example.com"
                  readOnly={loading || success}
                />
              </div>
            </div>

            <fieldset>
              <legend className={p.authLegend}>Login method</legend>
              <div className={p.authMethods}>
                <ParkButton
                  type="button"
                  onClick={() => { if (!loading && !success) setType('magic_link'); }}
                  aria-pressed={type === 'magic_link'}
                  className={[p.authMethod, type === 'magic_link' ? p.authMethodActive : p.authMethodInactive].join(' ')}
                  aria-disabled={loading || success}
                >
                  Magic Link
                </ParkButton>
                <ParkButton
                  type="button"
                  onClick={() => { if (!loading && !success) setType('otp'); }}
                  aria-pressed={type === 'otp'}
                  className={[p.authMethod, type === 'otp' ? p.authMethodActive : p.authMethodInactive].join(' ')}
                  aria-disabled={loading || success}
                >
                  Code (OTP)
                </ParkButton>
              </div>
            </fieldset>

            {siteKey && (
              <div className={p.authTurnstile}>
                <Turnstile
                  siteKey={siteKey}
                  onSuccess={(token) => setTurnstileToken(token)}
                  onExpire={() => setTurnstileToken(null)}
                  onError={() => setTurnstileToken(null)}
                  options={{
                    theme: 'auto',
                  }}
                />
              </div>
            )}

            <div>
              <ParkButton
                type="submit"
                aria-disabled={loading || success || !email || (!!siteKey && !turnstileToken)}
                variant="solid" className={p.authSubmit}
              >
                {loading ? <IconSpinner className={p.authSpinner} /> : <IconArrowRight className={p.authIcon} />}
                {loading ? 'Sending...' : `Send ${type === 'magic_link' ? 'Magic Link' : 'Code'}`}
              </ParkButton>
            </div>
          </form>
          <p role="status" aria-live="polite" className={p.authStatus}>{loading ? 'Sending login instructions…' : ''}</p>
        </div>
      </div>
    </div>
  );
}
