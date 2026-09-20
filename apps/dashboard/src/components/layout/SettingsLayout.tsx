import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  IconBolt, IconChevronDown, IconClock, IconCreditCard, IconDiagramProject,
  IconEnvelope, IconGear, IconKey, IconShieldHalved, IconTableColumns,
  IconUser, IconUsers, IconWpforms,
} from '@luminatick/ui/icons';
import { ParkButton, ParkEmptyState, ParkMenu } from '@luminatick/ui/park';
import { css } from '@luminatick/ui/styled-system/css';
import { dashboardApi } from '../../api/client';
import { useAuthStore } from '../../store/authStore';

const settingsNavigation = [
  { name: 'Account', href: '/settings/account', icon: IconUser, permissionKey: null },
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
] as const;

const channelsNavigation = [
  { name: 'Email', href: '/settings/channels/email', icon: IconEnvelope, permissionKey: 'channels_email' },
  { name: 'Widget', href: '/settings/channels/widget', icon: IconTableColumns, permissionKey: 'channels_widget' },
] as const;

const styles = {
  root: css({ minW: '0', minH: '0', w: 'full', bg: 'bg.canvas' }),
  inner: css({ w: 'full', minW: '0', maxW: '72rem', mx: 'auto', px: { base: '4', md: '6' }, py: { base: '4', md: '6' } }),
  header: css({ display: 'flex', minW: '0', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '3', mb: '6' }),
  title: css({ m: '0', color: 'fg.default', fontSize: 'xl', fontWeight: 'semibold' }),
  trigger: css({ display: 'inline-flex', minW: '11rem', justifyContent: 'space-between', alignItems: 'center', gap: '3' }),
  triggerIcon: css({ w: '4', h: '4', flexShrink: '0' }),
  menu: css({ zIndex: '50', minW: '15rem', maxH: 'min(28rem, 70vh)', overflowY: 'auto' }),
  item: css({ display: 'flex', minW: '0', alignItems: 'center', gap: '3', textDecoration: 'none', '&[aria-current="page"]': { fontWeight: 'semibold' } }),
  itemIcon: css({ w: '4', h: '4', flexShrink: '0' }),
  content: css({ minW: '0' }),
};

export function SettingsLayout() {
  const { user } = useAuthStore();
  const { pathname } = useLocation();
  const [permissions, setPermissions] = useState<Record<string, boolean>>({});
  const [permissionsError, setPermissionsError] = useState(false);
  const [permissionRetry, setPermissionRetry] = useState(0);

  useEffect(() => {
    if (user?.role !== 'agent') {
      setPermissions({});
      setPermissionsError(false);
      return;
    }
    let current = true;
    setPermissions({});
    setPermissionsError(false);
    dashboardApi.get('/permissions').then(data => {
      if (current) setPermissions((data || {}) as Record<string, boolean>);
    }).catch(() => {
      if (current) setPermissionsError(true);
    });
    return () => { current = false; };
  }, [user?.id, user?.role, permissionRetry]);

  const hasPermission = (key: string | null) => key === null || user?.role === 'admin' || permissions[key] === true;
  const sections = settingsNavigation.filter(item => item.permissionKey === 'support_states'
    ? user?.role === 'admin'
    : hasPermission(item.permissionKey));
  const channels = channelsNavigation.filter(item => hasPermission(item.permissionKey));
  const current = [...settingsNavigation, ...channelsNavigation, { name: 'Agent Permissions', href: '/settings/agent-permissions' }]
    .find(item => item.href === pathname)?.name || 'Choose section';

  return <div className={styles.root}>
    <div className={styles.inner}>
      <header className={styles.header}>
        <p className={styles.title}>Settings</p>
        <ParkMenu.Root positioning={{ placement: 'bottom-end' }}>
          <ParkMenu.Trigger asChild>
            <ParkButton type="button" variant="outline" className={styles.trigger} aria-label={`Settings sections, current: ${current}`}>
              <span>{current}</span><IconChevronDown aria-hidden="true" className={styles.triggerIcon} />
            </ParkButton>
          </ParkMenu.Trigger>
          <ParkMenu.Positioner>
            <ParkMenu.Content aria-label="Settings sections" className={styles.menu}>
              <ParkMenu.ItemGroup>
                <ParkMenu.ItemGroupLabel>Settings</ParkMenu.ItemGroupLabel>
                {sections.map(item => <ParkMenu.Item key={item.href} value={item.href} asChild>
                  <NavLink to={item.href} className={styles.item}>
                    <item.icon aria-hidden="true" className={styles.itemIcon} />{item.name}
                  </NavLink>
                </ParkMenu.Item>)}
                {user?.role === 'admin' && <ParkMenu.Item value="/settings/agent-permissions" asChild>
                  <NavLink to="/settings/agent-permissions" className={styles.item}>
                    <IconShieldHalved aria-hidden="true" className={styles.itemIcon} />Agent Permissions
                  </NavLink>
                </ParkMenu.Item>}
              </ParkMenu.ItemGroup>
              {channels.length > 0 && <>
                <ParkMenu.Separator />
                <ParkMenu.ItemGroup>
                  <ParkMenu.ItemGroupLabel>Channels</ParkMenu.ItemGroupLabel>
                  {channels.map(item => <ParkMenu.Item key={item.href} value={item.href} asChild>
                    <NavLink to={item.href} className={styles.item}>
                      <item.icon aria-hidden="true" className={styles.itemIcon} />{item.name}
                    </NavLink>
                  </ParkMenu.Item>)}
                </ParkMenu.ItemGroup>
              </>}
            </ParkMenu.Content>
          </ParkMenu.Positioner>
        </ParkMenu.Root>
      </header>
      {permissionsError && <ParkEmptyState
        role="status"
        aria-live="polite"
        headingLevel={false}
        title="Settings sections are unavailable"
        description="Some sections could not be loaded. Your account section is still available."
        action={<ParkButton type="button" variant="outline" onClick={() => setPermissionRetry(value => value + 1)}>Retry settings access</ParkButton>}
      />}
      <div className={styles.content}><Outlet /></div>
    </div>
  </div>;
}
