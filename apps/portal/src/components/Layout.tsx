import { p } from '../portalStyles';
import { ProductLogo } from '@luminatick/ui/brand';
import { ParkButton } from '@luminatick/ui/park';
import { Outlet, Link, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { portalApi } from '../api/client';
import {
  IconArrowRightFromBracket
} from '@luminatick/ui/icons';

export function Layout() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const [logoMode, setLogoMode] = useState<'light' | 'dark'>(() => document.documentElement.classList.contains('dark') ? 'dark' : 'light');

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setLogoMode(root.classList.contains('dark') ? 'dark' : 'light');
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    sync();
    return () => observer.disconnect();
  }, []);

  const handleLogout = async () => {
    let warning: string | undefined;
    try {
      await portalApi.post('/auth/logout');
    } catch {
      warning = "Server sign-out could not be confirmed. Local sign-in data was cleared. On a shared device, clear this site's browser data.";
    }
    finally {
      logout();
      navigate('/login', { state: warning ? { logoutWarning: warning } : null });
    }
  };

  return (
    <div className={p.layout}>
      <header className={p.header}>
        <div className={p.navInner}>
          <div className={p.navRow}>
            <Link to="/tickets" className={p.brand} aria-label="Tocyn Portal">
              <ProductLogo mode={logoMode} className={p.brandLogo} />
              <span className={p.brandName}>Portal</span>
            </Link>

            <div className={p.user}>
              <span className={p.userLabel}>
                {user?.name} ({user?.email})
              </span>
              <ParkButton
                onClick={handleLogout}
                className={p.logout}
                title="Sign out of all sessions"
                aria-label="Sign out of all sessions"
              >
                <IconArrowRightFromBracket className={p.logoutIcon} />
              </ParkButton>
            </div>
          </div>
        </div>
      </header>

      <main className={p.main}>
        <Outlet />
      </main>
    </div>
  );
}
