import { MfaPage } from './MfaPage';
import { PRODUCT_BRAND } from '@luminatick/shared/product-brand';
import { TocynButton, TocynInput } from '@luminatick/ui/primitives';
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { dashboardApi } from '../api/client';
import { AuthResponse } from '../types';

export function LoginPage() {
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  const navigate = useNavigate();
  const mfaRequired = useAuthStore(state => state.mfaRequired);
  const enrolled = useAuthStore(state => state.user?.mfa_enabled);
  const setAuth = useAuthStore((state) => state.setAuth);
  const setMfaRequired = useAuthStore((state) => state.setMfaRequired);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError('');
    setLoading(true);

    try {
      const data = await dashboardApi.post<AuthResponse>('/auth/login', { email, password });

      if (data.mfa_required) {
        // We still need the token (pre-mfa) to call the MFA verify endpoint
        setAuth(data.token, data.user);
        setMfaRequired(true);
        setPassword('');
        if (!data.user.mfa_enabled) navigate('/mfa', { state: { tocynAuthVisual: window.history.state?.tocynAuthVisual } });
      } else {
        setAuth(data.token, data.user);
        navigate('/');
      }
    } catch (err: any) {
      setError(err.message || 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  if (mfaRequired && enrolled) return <MfaPage />;

  return (
    <div className="w-full">
      <div className="w-full">
        <div className="text-center mb-8">

          <h1 className="text-2xl font-bold text-slate-900">Welcome Back</h1>
          <p className="text-slate-500 mt-1">Sign in to your {PRODUCT_BRAND.name} account</p>
        </div>

        {error && (
          <div id="staff-login-error" role="alert" aria-atomic="true" className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-md">
            {error}
          </div>
        )}

        <form aria-busy={loading} onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="staff-login-email" className="block text-sm font-medium text-slate-700 mb-1">Email Address</label>
            <TocynInput
              id="staff-login-email"
              name="email"
              autoComplete="username"
              aria-describedby={error ? "staff-login-error" : undefined}
              type="email"
              required
              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="agent@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="staff-login-password" className="block text-sm font-medium text-slate-700 mb-1">Password</label>
            <TocynInput
              id="staff-login-password"
              name="password"
              autoComplete="current-password"
              aria-describedby={error ? "staff-login-error" : undefined}
              type="password"
              required
              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <TocynButton
            type="submit"
            aria-disabled={loading}
            className="inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:pointer-events-none disabled:opacity-50 bg-brand-500 text-white hover:bg-brand-600 w-full aria-disabled:bg-brand-700 aria-disabled:cursor-default h-11"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </TocynButton>
        </form>
        <p role="status" aria-live="polite" className="mt-3 text-sm text-slate-700">{loading ? 'Signing in…' : ''}</p>
      </div>
    </div>
  );
}
