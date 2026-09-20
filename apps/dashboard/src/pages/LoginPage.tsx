import { MfaPage } from './MfaPage';
import { PRODUCT_BRAND } from '@luminatick/shared/product-brand';
import { AuthLogo } from '@luminatick/ui/auth-layout';
import { ParkAlert, ParkButton, ParkField, ParkInput } from '@luminatick/ui/park';
import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { dashboardApi } from '../api/client';
import { AuthResponse } from '../types';
import { authStyles } from './auth-styles';

export function LoginPage() {
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  const navigate = useNavigate();
  const location = useLocation();
  const logoutWarning = typeof location.state?.logoutWarning === 'string' ? location.state.logoutWarning : '';
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
    <div className={authStyles.page}>
      <div className={authStyles.card} data-auth-login-card>
        <AuthLogo className={authStyles.cardLogo} />
        <div className={authStyles.heading}>

          <h1>Welcome Back</h1>
          <p>Sign in to your {PRODUCT_BRAND.name} account</p>
        </div>

        {(error || logoutWarning) && (
          <div id="staff-login-error" role="alert" aria-atomic="true" className={authStyles.alert}>
            {error || logoutWarning}
          </div>
        )}

        <form aria-busy={loading} onSubmit={handleSubmit} className={authStyles.form}>
          <ParkField label="Email Address" required>
            <ParkInput
              id="staff-login-email"
              aria-label="Email Address"
              name="email"
              autoComplete="username"
              aria-describedby={error ? "staff-login-error" : undefined}
              type="email"
              required
              placeholder="agent@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </ParkField>
          <ParkField label="Password" required>
            <ParkInput
              id="staff-login-password"
              aria-label="Password"
              name="password"
              autoComplete="current-password"
              aria-describedby={error ? "staff-login-error" : undefined}
              type="password"
              required
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </ParkField>
          <ParkButton
            type="submit"
            variant="solid"
            aria-disabled={loading}
            className={authStyles.submit}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </ParkButton>
          <ParkAlert.Root status="info" variant="surface" role="note" aria-label="Authorised users notice">
            <ParkAlert.Content>
              <ParkAlert.Description>Authorised Users Only. Unauthorised access is strictly prohibited and subject to legal action under applicable local and international cybercrime laws. All system activity is monitored and logged.</ParkAlert.Description>
            </ParkAlert.Content>
          </ParkAlert.Root>
        </form>
        <p role="status" aria-live="polite" className={authStyles.status}>{loading ? 'Signing in…' : ''}</p>
      </div>
    </div>
  );
}
