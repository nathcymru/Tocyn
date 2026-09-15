import { useNavigate } from 'react-router-dom';
import { ParkButton, ParkCard, ParkPage } from '@luminatick/ui/park';
import { useAuthStore } from '../store/authStore';
import { OperatorCapacityPanel } from '../components/capacity/OperatorCapacityPanel';
import { OperatorPreferencesControl, OperatorThemeControl } from '../components/theme/OperatorThemeProvider';

export function AccountSettingsPage() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  return <div className={[ParkPage('account').root, ParkPage('account').content, 'tocyn-account-page'].join(' ')}>
    <header className={['tocyn-account-page-header', ParkPage('account').header].join(' ')}>
      <div>
        <p className="tocyn-page-eyebrow">Account</p>
        <h1>Account settings</h1>
        <p>Manage your operator identity, appearance, workspace preferences and current work.</p>
      </div>
      <ParkButton type="button" onClick={() => navigate('/profile/security')}>Security profile</ParkButton>
    </header>
    <ParkCard.Root variant="outline" className="tocyn-account-card" aria-labelledby="account-identity-title">
      <ParkCard.Header><ParkCard.Title id="account-identity-title">Your identity</ParkCard.Title></ParkCard.Header>
      <ParkCard.Body>
        <p className="tocyn-account-identity-name">{user?.full_name || 'Operator'}</p>
        <ParkCard.Description className="tocyn-account-identity-email">{user?.email || 'No email available'}</ParkCard.Description>
      </ParkCard.Body>
    </ParkCard.Root>
    <div className="tocyn-account-grid">
      <ParkCard.Root variant="outline" className="tocyn-account-card"><ParkCard.Body><OperatorThemeControl /></ParkCard.Body></ParkCard.Root>
      <ParkCard.Root variant="outline" className="tocyn-account-card"><ParkCard.Body><OperatorPreferencesControl /></ParkCard.Body></ParkCard.Root>
    </div>
    <ParkCard.Root variant="outline" className="tocyn-account-card" aria-labelledby="account-capacity-title">
      <ParkCard.Header><ParkCard.Title id="account-capacity-title">Current work</ParkCard.Title><ParkCard.Description>Set your availability and workload limits for assignments.</ParkCard.Description></ParkCard.Header>
      <ParkCard.Body>{user?.id && <OperatorCapacityPanel userId={user.id} />}<ParkButton type="button" disabled>Changes are saved automatically</ParkButton></ParkCard.Body>
    </ParkCard.Root>
  </div>;
}
