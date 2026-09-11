import { TocynButton, TocynInput } from '@luminatick/ui/primitives';
import { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { VerifyPage } from './VerifyPage';
import { portalApi } from '../api/client';
import { Mail, Loader2, ArrowRight } from 'lucide-react';
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
        navigate('/login', { replace: true, state: { authStep: 'verify', challenge: next } });
      }
    } catch (err: unknown) {
      const error = err as Error;
      setError(error.message || 'Failed to request login link');
    } finally {
      setLoading(false);
    }
  };

  if (challenge) return <VerifyPage challenge={challenge} onBack={() => { setChallenge(null); setSuccess(false); setTurnstileToken(null); navigate('/login', { replace: true, state: null }); }} />;

  if (success && type === 'magic_link') {
    return (
      <div className="w-full">
        <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
          <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
            <Mail className="w-8 h-8 text-green-600" />
          </div>
          <h2 ref={successHeading} tabIndex={-1} className="text-3xl font-extrabold text-gray-900">Check your email</h2>
          <p className="mt-4 text-gray-600">
            We sent a magic link to <strong>{email}</strong>.<br/>
            Click the link in the email to log in.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
          Sign in to Support
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          Enter your email to receive a secure login link or code.
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="py-8">
          {error && (
            <div id="portal-login-error" role="alert" aria-atomic="true" className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm p-3 rounded-md">
              {error}
            </div>
          )}
          {success && type === 'otp' && (
            <div role="status" className="mb-4 bg-green-50 border border-green-200 text-green-800 text-sm p-3 rounded-md">
              OTP sent! Redirecting to verification...
            </div>
          )}

          <form aria-busy={loading} className="space-y-6" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                Email address
              </label>
              <div className="mt-1">
                <TocynInput
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  aria-describedby={error ? "portal-login-error" : undefined}
                  required
                  value={email}
                  onChange={(e) => { if (!loading && !success) setEmail(e.target.value); }}
                  className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-brand-500 focus:border-brand-500 sm:text-sm"
                  placeholder="you@example.com"
                  readOnly={loading || success}
                />
              </div>
            </div>

            <fieldset>
              <legend className="block text-sm font-medium text-gray-700 mb-2">Login method</legend>
              <div className="grid grid-cols-2 gap-4">
                <TocynButton
                  type="button"
                  onClick={() => { if (!loading && !success) setType('magic_link'); }}
                  aria-pressed={type === 'magic_link'}
                  className={`px-4 py-2 text-sm font-medium rounded-md border aria-disabled:cursor-default focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${
                    type === 'magic_link'
                      ? 'border-brand-500 bg-brand-50 text-brand-700'
                      : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                  aria-disabled={loading || success}
                >
                  Magic Link
                </TocynButton>
                <TocynButton
                  type="button"
                  onClick={() => { if (!loading && !success) setType('otp'); }}
                  aria-pressed={type === 'otp'}
                  className={`px-4 py-2 text-sm font-medium rounded-md border aria-disabled:cursor-default focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${
                    type === 'otp'
                      ? 'border-brand-500 bg-brand-50 text-brand-700'
                      : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                  aria-disabled={loading || success}
                >
                  Code (OTP)
                </TocynButton>
              </div>
            </fieldset>

            {siteKey && (
              <div className="flex justify-center">
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
              <TocynButton
                type="submit"
                aria-disabled={loading || success || !email || (!!siteKey && !turnstileToken)}
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-500 aria-disabled:bg-brand-700 aria-disabled:cursor-default items-center gap-2"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ArrowRight className="w-5 h-5" />}
                {loading ? 'Sending...' : `Send ${type === 'magic_link' ? 'Magic Link' : 'Code'}`}
              </TocynButton>
            </div>
          </form>
          <p role="status" aria-live="polite" className="mt-3 text-sm text-gray-700">{loading ? 'Sending login instructions…' : ''}</p>
        </div>
      </div>
    </div>
  );
}
