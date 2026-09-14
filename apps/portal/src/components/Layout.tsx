import { ProductLogo } from '@luminatick/ui/brand';
import { ParkButton } from '@luminatick/ui/park';
import { Outlet, Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { portalApi } from '../api/client';
import {
  IconArrowRightFromBracket
} from '@luminatick/ui/icons';

export function Layout() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = async () => {
    let confirmed = false;
    try {
      await portalApi.post('/auth/logout');
      confirmed = true;
    } catch { /* Local sign-out must still complete. */ }
    finally {
      logout();
      navigate('/login');
    }
    if (!confirmed) window.alert("Server sign-out could not be confirmed. Local sign-in data was cleared. On a shared device, clear this site's browser data.");
  };

  return (
    <div className="tocyn-portal-layout">
      <header className="tocyn-portal-header">
        <div className="tocyn-portal-nav-inner">
          <div className="tocyn-portal-nav-row">
            <Link to="/tickets" className="tocyn-portal-brand">
              <ProductLogo className="tocyn-portal-brand-logo" />
              <span className="tocyn-portal-brand-name">Portal</span>
            </Link>

            <div className="tocyn-portal-user">
              <span className="tocyn-portal-user-label">
                {user?.name} ({user?.email})
              </span>
              <ParkButton
                onClick={handleLogout}
                className="tocyn-portal-logout"
                title="Sign out of all sessions"
                aria-label="Sign out of all sessions"
              >
                <IconArrowRightFromBracket className="tocyn-portal-logout-icon" />
              </ParkButton>
            </div>
          </div>
        </div>
      </header>

      <main className="tocyn-portal-main">
        <Outlet />
      </main>
    </div>
  );
}
