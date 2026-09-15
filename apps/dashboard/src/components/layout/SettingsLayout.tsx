import React, { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { IconGear, IconUsers, IconShieldHalved, IconBolt, IconKey, IconTableColumns, IconWpforms, IconEnvelope, IconCreditCard, IconDiagramProject, IconClock } from '@luminatick/ui/icons';
import { useAuthStore } from '../../store/authStore';
import { dashboardApi } from '../../api/client';
import { ParkSettingsLayout } from '@luminatick/ui/park';

const settingsNavigation = [
  { name: 'General', href: '/settings/general', icon: IconGear, permissionKey: 'general' },
  { name: 'Support States', href: '/settings/support-states', icon: IconDiagramProject, permissionKey: 'support_states' },
  { name: 'Service Levels', href: '/settings/sla', icon: IconClock, permissionKey: 'general' },
  { name: 'Users', href: '/settings/users', icon: IconUsers, permissionKey: 'users' },
  { name: 'Groups', href: '/settings/groups', icon: IconShieldHalved, permissionKey: 'groups' },
  { name: 'Ticket Fields', href: '/settings/ticket-fields', icon: IconWpforms, permissionKey: 'ticket_fields' },
  { name: 'Filters', href: '/settings/filters', icon: IconTableColumns, permissionKey: 'filters' },
  { name: 'Automations', href: '/settings/automations', icon: IconBolt, permissionKey: 'automations' },
  { name: 'API Keys', href: '/settings/api-keys', icon: IconKey, permissionKey: 'api_keys' },
  { name: 'Usage & Costs', href: '/settings/usage', icon: IconCreditCard, permissionKey: 'usage' },
];

const channelsNavigation = [
  { name: 'Email', href: '/settings/channels/email', icon: IconEnvelope, permissionKey: 'channels_email' },
  { name: 'Widget', href: '/settings/channels/widget', icon: IconTableColumns, permissionKey: 'channels_widget' },
];

export function SettingsLayout() {
  const styles = ParkSettingsLayout();
  const { user } = useAuthStore();
  const [permissions, setPermissions] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (user?.role === 'agent') {
      dashboardApi.get('/permissions').then(data => setPermissions((data || {}) as Record<string, boolean>)).catch(console.error);
    }
  }, [user]);

  const hasPermission = (key: string) => {
    if (user?.role === 'admin') return true;
    return permissions[key] === true;
  };

  const filteredSettingsNav = settingsNavigation.filter(item => item.permissionKey === 'support_states' ? user?.role === 'admin' : hasPermission(item.permissionKey));
  const filteredChannelsNav = channelsNavigation.filter(item => hasPermission(item.permissionKey));

  return (
    <div className={styles.root}>
      {/* Sub-sidebar */}
      <aside className={styles.sidebar}>
        <div className={styles.sidebarInner}>
          <h2 className={styles.title}>Settings</h2>
          <nav className={styles.nav}>
            {filteredSettingsNav.map((item) => (
              <NavLink
                key={item.name}
                to={item.href}
                className={styles.navLink}
              >
                <item.icon aria-hidden="true" className={styles.navIcon} />
                {item.name}
              </NavLink>
            ))}
            
            {user?.role === 'admin' && (
              <NavLink
                to="/settings/agent-permissions"
                className={styles.navLink}
              >
                <IconShieldHalved aria-hidden="true" className={styles.navIcon} />
                Agent Permissions
              </NavLink>
            )}
          </nav>

          {filteredChannelsNav.length > 0 && (
            <>
              <h3 className={styles.sectionTitle}>
                Channels
              </h3>
              <nav className={styles.nav}>
                {filteredChannelsNav.map((item) => (
                  <NavLink
                    key={item.name}
                    to={item.href}
                    className={styles.navLink}
                  >
                    <item.icon aria-hidden="true" className={styles.navIcon} />
                    {item.name}
                  </NavLink>
                ))}
              </nav>
            </>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className={styles.main}>
        <div className={styles.content}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
