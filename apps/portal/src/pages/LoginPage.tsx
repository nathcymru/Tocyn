import { p } from '../portalStyles';
import { css } from '@luminatick/ui/styled-system/css';
import { ParkAlert, ParkButton, ParkCard, ParkField, ParkInput } from '@luminatick/ui/park';
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
  const [logoutWarning] = useState<string | null>(() => {
    const state = location.state as { logoutWarning?: unknown } | null;
    return typeof state?.logoutWarning === 'string' ? state.logoutWarning : null;
  });
  const [challenge, setChallenge] = useState<{ email: string; challengeId?: string } | null>(() => location.state?.authStep === 'verify' ? location.state.challenge : null);
  const successHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (logoutWarning) navigate(location.pathname + location.search, { replace: true, state: null });
  }, [location.pathname, location.search, logoutWarning, navigate]);

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
        <ParkAlert.Root role="status" aria-live="polite" aria-atomic="true" status="info" variant="surface">
          <ParkAlert.Indicator aria-hidden="true">
            <IconEnvelope aria-hidden="true" />
          </ParkAlert.Indicator>
          <ParkAlert.Content>
            <ParkAlert.Title asChild><h2 ref={successHeading} tabIndex={-1}>Check your email</h2></ParkAlert.Title>
            <ParkAlert.Description>
              We sent a magic link to <strong className={css({ overflowWrap: 'anywhere' })}>{email}</strong>.<br/>
              Click the link in the email to log in.
            </ParkAlert.Description>
          </ParkAlert.Content>
        </ParkAlert.Root>
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

      <ParkCard.Root>
        <ParkCard.Body className={p.authForm}>
          {logoutWarning && (
            <ParkAlert.Root role="alert" aria-atomic="true" status="warning" variant="surface">
              <ParkAlert.Content><ParkAlert.Description>{logoutWarning}</ParkAlert.Description></ParkAlert.Content>
            </ParkAlert.Root>
          )}
          {error && (
            <ParkAlert.Root id="portal-login-error" role="alert" aria-atomic="true" status="error" variant="surface">
              <ParkAlert.Content><ParkAlert.Description>{error}</ParkAlert.Description></ParkAlert.Content>
            </ParkAlert.Root>
          )}
          {success && type === 'otp' && (
            <ParkAlert.Root role="status" status="info" variant="surface">
              <ParkAlert.Content><ParkAlert.Description>OTP sent! Redirecting to verification...</ParkAlert.Description></ParkAlert.Content>
            </ParkAlert.Root>
          )}

          <form aria-busy={loading} className={p.authForm} onSubmit={handleSubmit}>
            <ParkField label="Email address">
              <ParkInput
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
            </ParkField>

            <fieldset>
              <legend className={p.authLegend}>Login method</legend>
              <div className={p.authMethods}>
                <ParkButton
                  type="button"
                  onClick={() => { if (!loading && !success) setType('magic_link'); }}
                  aria-pressed={type === 'magic_link'}
                  variant={type === 'magic_link' ? 'surface' : 'outline'}
                  className={p.authMethod}
                  aria-disabled={loading || success}
                >
                  Magic Link
                </ParkButton>
                <ParkButton
                  type="button"
                  onClick={() => { if (!loading && !success) setType('otp'); }}
                  aria-pressed={type === 'otp'}
                  variant={type === 'otp' ? 'surface' : 'outline'}
                  className={p.authMethod}
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
                {loading ? <IconSpinner className={p.authSpinner} aria-hidden="true" /> : <IconArrowRight className={p.authIcon} aria-hidden="true" />}
                {loading ? 'Sending...' : `Send ${type === 'magic_link' ? 'Magic Link' : 'Code'}`}
              </ParkButton>
            </div>
          </form>
          <p role="status" aria-live="polite" className={p.authStatus}>{loading ? 'Sending login instructions…' : ''}</p>
        </ParkCard.Body>
      </ParkCard.Root>
    </div>
  );
}
