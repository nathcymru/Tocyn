import { Link } from 'react-router-dom';
import { ParkButton, ParkCard, ParkEmptyState, ParkPage } from '@luminatick/ui/park';
import { Link as ParkLink } from '@luminatick/ui/components';
import { css } from '@luminatick/ui/styled-system/css';
import { useAuthStore } from '../store/authStore';
import { OperatorCapacityPanel } from '../components/capacity/OperatorCapacityPanel';
import { OperatorPreferencesControl, OperatorThemeControl } from '../components/theme/OperatorThemeProvider';

export function AccountSettingsPage() {
  const { user } = useAuthStore();
  const page = ParkPage('account');
  const identityAvailable = Boolean(user?.id && user.email);
  return <div className={[page.root, page.content].join(' ')}>
    <header className={page.header}>
      <div>
        <p className={css({ color: 'fg.muted', fontSize: 'sm', fontWeight: 'medium', textTransform: 'uppercase', letterSpacing: 'wide' })}>Account</p>
        <h1 className={css({ m: '0', color: 'fg.default', textStyle: '2xl', fontWeight: 'semibold' })}>Account settings</h1>
        <p className={css({ color: 'fg.muted' })}>Manage your operator identity, appearance, workspace preferences and current work.</p>
      </div>
      {identityAvailable && <ParkLink asChild><Link to="/profile/security">Security profile</Link></ParkLink>}
    </header>
    {!identityAvailable ? <ParkEmptyState
      role="status"
      aria-live="polite"
      title="Account details unavailable"
      description="Your operator identity could not be confirmed. Reload the page before changing account settings."
      action={<ParkButton type="button" onClick={() => window.location.reload()}>Reload account</ParkButton>}
    /> : <>
    <ParkCard.Root variant="outline" aria-labelledby="account-identity-title">
      <ParkCard.Header><ParkCard.Title asChild><h2 id="account-identity-title">Your identity</h2></ParkCard.Title></ParkCard.Header>
      <ParkCard.Body>
        <p className={page.accountIdentityName}>{user?.full_name || user?.email}</p>
        <p className={css({ mt: '1', mb: '0', color: 'fg.muted', overflowWrap: 'anywhere' })}>{user?.email}</p>
      </ParkCard.Body>
    </ParkCard.Root>
    <div className={page.accountGrid}>
      <ParkCard.Root variant="outline"><ParkCard.Body><OperatorThemeControl /></ParkCard.Body></ParkCard.Root>
      <ParkCard.Root variant="outline"><ParkCard.Body><OperatorPreferencesControl /></ParkCard.Body></ParkCard.Root>
    </div>
    <ParkCard.Root variant="outline" aria-labelledby="account-capacity-title">
      <ParkCard.Header><ParkCard.Title asChild><h2 id="account-capacity-title">Current work</h2></ParkCard.Title><ParkCard.Description>Set your availability and workload limits for assignments.</ParkCard.Description></ParkCard.Header>
      <ParkCard.Body><OperatorCapacityPanel userId={user!.id} /></ParkCard.Body>
    </ParkCard.Root>
    </>}
  </div>;
}
