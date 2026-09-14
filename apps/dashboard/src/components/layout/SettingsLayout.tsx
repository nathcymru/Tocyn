import React, { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { FaGear, FaUsers, FaShieldHalved, FaBolt, FaKey, FaTableColumns, FaWpforms, FaEnvelope, FaCreditCard, FaDiagramProject, FaClock } from '@luminatick/ui/icons';
import { clsx } from 'clsx';
import { useAuthStore } from '../../store/authStore';
import { dashboardApi } from '../../api/client';

function cn(...inputs: any[]) {
  return clsx(inputs);
}

const settingsNavigation = [
  { name: 'General', href: '/settings/general', icon: FaGear, permissionKey: 'general' },
  { name: 'Support States', href: '/settings/support-states', icon: FaDiagramProject, permissionKey: 'support_states' },
  { name: 'Service Levels', href: '/settings/sla', icon: FaClock, permissionKey: 'general' },
  { name: 'Users', href: '/settings/users', icon: FaUsers, permissionKey: 'users' },
  { name: 'Groups', href: '/settings/groups', icon: FaShieldHalved, permissionKey: 'groups' },
  { name: 'Ticket Fields', href: '/settings/ticket-fields', icon: FaWpforms, permissionKey: 'ticket_fields' },
  { name: 'Filters', href: '/settings/filters', icon: FaTableColumns, permissionKey: 'filters' },
  { name: 'Automations', href: '/settings/automations', icon: FaBolt, permissionKey: 'automations' },
  { name: 'API Keys', href: '/settings/api-keys', icon: FaKey, permissionKey: 'api_keys' },
  { name: 'Usage & Costs', href: '/settings/usage', icon: FaCreditCard, permissionKey: 'usage' },
];

const channelsNavigation = [
  { name: 'Email', href: '/settings/channels/email', icon: FaEnvelope, permissionKey: 'channels_email' },
  { name: 'Widget', href: '/settings/channels/widget', icon: FaTableColumns, permissionKey: 'channels_widget' },
];

export function SettingsLayout() {
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
    <div className="tocyn-settings-layout">
      {/* Sub-sidebar */}
      <div className="tocyn-settings-sidebar">
        <div className="tocyn-settings-sidebar-inner">
          <h2 className="tocyn-settings-sidebar-title">Settings</h2>
          <nav className="tocyn-settings-nav-list">
            {filteredSettingsNav.map((item) => (
              <NavLink
                key={item.name}
                to={item.href}
                className={({ isActive }) =>
                  cn(
                    "tocyn-settings-nav-link",
                    isActive
                      ? "tocyn-settings-nav-link--active"
                      : "tocyn-settings-nav-link--inactive"
                  )
                }
              >
                <item.icon className="tocyn-settings-nav-icon" />
                {item.name}
              </NavLink>
            ))}
            
            {user?.role === 'admin' && (
              <NavLink
                to="/settings/agent-permissions"
                className={({ isActive }) =>
                  cn(
                    "tocyn-settings-nav-link tocyn-settings-nav-link--permissions",
                    isActive
                      ? "tocyn-settings-nav-link--permissions-active"
                      : "tocyn-settings-nav-link--permissions-inactive"
                  )
                }
              >
                <FaShieldHalved className="tocyn-settings-nav-icon" />
                Agent Permissions
              </NavLink>
            )}
          </nav>

          {filteredChannelsNav.length > 0 && (
            <>
              <h3 className="tocyn-settings-nav-section-title">
                Channels
              </h3>
              <nav className="tocyn-settings-nav-list">
                {filteredChannelsNav.map((item) => (
                  <NavLink
                    key={item.name}
                    to={item.href}
                    className={({ isActive }) =>
                      cn(
                        "tocyn-settings-nav-link",
                        isActive
                          ? "tocyn-settings-nav-link--active"
                          : "tocyn-settings-nav-link--inactive"
                      )
                    }
                  >
                    <item.icon className="tocyn-settings-nav-icon" />
                    {item.name}
                  </NavLink>
                ))}
              </nav>
            </>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="tocyn-settings-main">
        <div className="tocyn-settings-content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
