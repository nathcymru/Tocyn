import { useNavigate } from 'react-router-dom';
import { ParkButton, ParkCard, ParkPage } from '@luminatick/ui/park';
import { css } from '@luminatick/ui/styled-system/css';
import { useAuthStore } from '../store/authStore';
import { OperatorCapacityPanel } from '../components/capacity/OperatorCapacityPanel';
import { OperatorPreferencesControl, OperatorThemeControl } from '../components/theme/OperatorThemeProvider';

export function AccountSettingsPage() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const page = ParkPage('account');
  return <div className={[page.root, page.content].join(' ')}>
    <header className={page.header}>
      <div>
        <p className={css({ color: 'text.muted', fontSize: 'sm', fontWeight: 'medium', textTransform: 'uppercase', letterSpacing: 'wide' })}>Account</p>
        <h1 className={css({ m: '0', color: 'fg.default', textStyle: '2xl', fontWeight: 'semibold' })}>Account settings</h1>
        <p>Manage your operator identity, appearance, workspace preferences and current work.</p>
      </div>
      <ParkButton type="button" onClick={() => navigate('/profile/security')}>Security profile</ParkButton>
    </header>
    <ParkCard.Root variant="outline" aria-labelledby="account-identity-title">
      <ParkCard.Header><ParkCard.Title id="account-identity-title">Your identity</ParkCard.Title></ParkCard.Header>
      <ParkCard.Body>
        <p className={page.accountIdentityName}>{user?.full_name || 'Operator'}</p>
        <ParkCard.Description className={page.accountIdentityEmail}>{user?.email || 'No email available'}</ParkCard.Description>
      </ParkCard.Body>
    </ParkCard.Root>
    <div className={page.accountGrid}>
      <ParkCard.Root variant="outline"><ParkCard.Body><OperatorThemeControl /></ParkCard.Body></ParkCard.Root>
      <ParkCard.Root variant="outline"><ParkCard.Body className={css({
        '& [data-tocyn-preferences] fieldset > label:not([data-scope="checkbox"])': { display: 'grid', gap: '1', minW: '0' },
        '& [data-tocyn-preferences] fieldset > label > [data-scope="select"]': { minW: '0', w: 'full' },
      })}><OperatorPreferencesControl /></ParkCard.Body></ParkCard.Root>
    </div>
    <ParkCard.Root variant="outline" aria-labelledby="account-capacity-title">
      <ParkCard.Header><ParkCard.Title id="account-capacity-title">Current work</ParkCard.Title><ParkCard.Description>Set your availability and workload limits for assignments.</ParkCard.Description></ParkCard.Header>
      <ParkCard.Body>{user?.id && <OperatorCapacityPanel userId={user.id} />}</ParkCard.Body>
    </ParkCard.Root>
  </div>;
}
