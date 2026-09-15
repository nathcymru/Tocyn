import { Link } from 'react-router-dom';
import { ParkButton } from '@luminatick/ui/park';
import { useAuthStore } from '../store/authStore';
import { OperatorCapacityPanel } from '../components/capacity/OperatorCapacityPanel';
import { OperatorPreferencesControl, OperatorThemeControl } from '../components/theme/OperatorThemeProvider';

export function AccountSettingsPage() {
  const { user } = useAuthStore();
  return <div className="tocyn-account-page">
    <header className="tocyn-account-page-header">
      <div>
        <p className="tocyn-page-eyebrow">Account</p>
        <h1>Account settings</h1>
        <p>Manage your operator identity, appearance, workspace preferences and current work.</p>
      </div>
      <Link to="/profile/security" className="tocyn-button">Security profile</Link>
    </header>
    <section className="tocyn-account-card" aria-labelledby="account-identity-title">
      <h2 id="account-identity-title">Your identity</h2>
      <p className="tocyn-account-identity-name">{user?.full_name || 'Operator'}</p>
      <p className="tocyn-account-identity-email">{user?.email || 'No email available'}</p>
    </section>
    <div className="tocyn-account-grid">
      <section className="tocyn-account-card"><OperatorThemeControl /></section>
      <section className="tocyn-account-card"><OperatorPreferencesControl /></section>
    </div>
    <section className="tocyn-account-card" aria-labelledby="account-capacity-title">
      <h2 id="account-capacity-title">Current work</h2>
      <p>Set your availability and workload limits for assignments.</p>
      {user?.id && <OperatorCapacityPanel userId={user.id} />}
      <ParkButton type="button" disabled>Changes are saved automatically</ParkButton>
    </section>
  </div>;
}
