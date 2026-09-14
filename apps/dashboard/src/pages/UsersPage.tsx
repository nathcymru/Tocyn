import { OperatorCapacityPanel } from '../components/capacity/OperatorCapacityPanel';
import { useAuthStore } from '../store/authStore';
import { TocynDialog } from '@luminatick/ui/dialog';
import { ParkButton as TocynButton, ParkEmptyState } from '@luminatick/ui/park';
import React, { useState } from 'react';
import { useUsers } from '../hooks/useUsers';
import { User } from '../types';
import { User as UserIcon, Shield, Mail, Calendar, ShieldCheck, X, Settings } from 'lucide-react';

export const UsersPage: React.FC = () => {
  const { data: users = [], isLoading, error, refetch, isFetching } = useUsers();
  const [storedSelectedUser, setSelectedUser] = useState<User | null>(null);
  const [storedModalType, setModalType] = useState<'edit' | 'activity' | 'capacity' | null>(null);
  const administrator=useAuthStore(state=>state.user?.role==='admin');
  const sessionGeneration=useAuthStore(state=>state.sessionGeneration);
  const actor=useAuthStore(state=>state.user);
  const selectionIdentity=JSON.stringify([sessionGeneration,actor?.tenant_id,actor?.id]);
  const [capturedIdentity,setCapturedIdentity]=useState<string|null>(null);
  const selectedUser=capturedIdentity===selectionIdentity?storedSelectedUser:null;
  const modalType=capturedIdentity===selectionIdentity?storedModalType:null;
  React.useEffect(()=>{setSelectedUser(null);setModalType(null);},[selectionIdentity]);
  const dialogTitleId = React.useId();
  const closeControl = React.useRef<HTMLButtonElement>(null);
  const opener = React.useRef<HTMLButtonElement | null>(null);
  const closeDialog = () => { setSelectedUser(null); setModalType(null); };

  if (isLoading) return <ParkEmptyState role="status" className="tocyn-users-loading" title="Loading team members…" headingLevel={false} />;

  return (
    <div className="tocyn-users-page">
      <div className="tocyn-user-page-header">
        <div>
          <h1 className="tocyn-user-page-title">Team Management</h1>
          <p className="tocyn-user-page-description">Manage agents, admins, and their access levels.</p>
        </div>
        <TocynButton className="tocyn-user-page-create">
          Invite New User
        </TocynButton>
      </div>

      {error && (
        <div role="alert" className="tocyn-user-page-alert">
          {error.message}
          <TocynButton type="button" disabled={isFetching} onClick={() => void refetch()} className="tocyn-user-page-alert-action">Retry team members</TocynButton>
        </div>
      )}

      <div className="tocyn-users-grid">
        {users.map((user) => (
          <div key={user.id} className="tocyn-user-card">
            <div className="tocyn-user-card-header">
              <div className="tocyn-user-card-avatar">
                <UserIcon className="tocyn-user-card-avatar-icon" />
              </div>
              <span className={`tocyn-user-card-role ${
                user.role === 'admin' ? 'tocyn-user-card-role-admin' :
                user.role === 'agent' ? 'tocyn-user-card-role-agent' : 'tocyn-user-card-role-default'
              }`}>
                {user.role}
              </span>
            </div>

            <h3 className="tocyn-user-card-name">{user.full_name || 'Unnamed User'}</h3>
            <div className="tocyn-user-card-details">
              <div className="tocyn-user-card-detail">
                <Mail className="tocyn-user-card-detail-icon" />
                {user.email}
              </div>
              <div className="tocyn-user-card-detail">
                <Calendar className="tocyn-user-card-detail-icon" />
                Joined {new Date(user.created_at).toLocaleDateString()}
              </div>
              <div className="tocyn-user-card-mfa-row">
                {user.mfa_enabled ? (
                  <span className="tocyn-user-card-mfa tocyn-user-card-mfa-enabled">
                    <ShieldCheck className="tocyn-user-card-mfa-icon" />
                    MFA Enabled
                  </span>
                ) : (
                  <span className="tocyn-user-card-mfa tocyn-user-card-mfa-disabled">
                    <Shield className="tocyn-user-card-mfa-icon" />
                    MFA Disabled
                  </span>
                )}
              </div>
            </div>

            <div className="tocyn-user-card-actions">
              {administrator&&['admin','agent'].includes(user.role)&&<TocynButton type="button" aria-haspopup="dialog"
                onClick={event=>{opener.current=event.currentTarget;setCapturedIdentity(selectionIdentity);setSelectedUser(user);setModalType('capacity');}}
                className="tocyn-user-card-action">Capacity</TocynButton>}
              <TocynButton
                aria-haspopup="dialog" onClick={event => { opener.current=event.currentTarget; setCapturedIdentity(selectionIdentity);setSelectedUser(user); setModalType('edit'); }}
                className="tocyn-user-card-action"
              >
                Edit Profile
              </TocynButton>
              <TocynButton
                aria-haspopup="dialog" onClick={event => { opener.current=event.currentTarget; setCapturedIdentity(selectionIdentity);setSelectedUser(user); setModalType('activity'); }}
                className="tocyn-user-card-action"
              >
                View Activity
              </TocynButton>
            </div>
          </div>
        ))}
        {!error && users.length === 0 && (
          <ParkEmptyState className="tocyn-users-empty" title="No team members found" description="Start by inviting your first agent or admin." />
        )}
      </div>

      <TocynDialog open={Boolean(selectedUser && modalType)} onOpenChange={open => { if (!open) closeDialog(); }}
        labelledBy={dialogTitleId} initialFocusEl={() => closeControl.current} finalFocusEl={() => opener.current}>
        {selectedUser && (
          <div className="tocyn-users-dialog">
            <div className="tocyn-users-dialog-header">
              <h2 id={dialogTitleId} className="tocyn-users-dialog-title">
                {modalType === 'capacity' ? 'Operator capacity' : modalType === 'edit' ? 'Edit User Profile' : 'User Activity Log'}
              </h2>
              <TocynButton type="button" ref={closeControl} aria-label="Close user details" onClick={closeDialog} className="tocyn-users-dialog-close">
                <X className="tocyn-users-dialog-close-icon" />
              </TocynButton>
            </div>
            <div className="tocyn-users-dialog-body">
              <div className="tocyn-users-dialog-identity">
                <div className="tocyn-users-dialog-avatar">
                  {(selectedUser.full_name || selectedUser.email).charAt(0).toUpperCase()}
                </div>
                <div>
                  <h3 className="tocyn-users-dialog-name">{selectedUser.full_name || 'Unnamed User'}</h3>
                  <p className="tocyn-users-dialog-email">{selectedUser.email}</p>
                </div>
              </div>

              {modalType === 'capacity' ? (
                <OperatorCapacityPanel userId={selectedUser.id} editable={administrator}/>
              ) : modalType === 'edit' ? (
                <div className="tocyn-users-dialog-unavailable">
                  <Settings className="tocyn-users-dialog-unavailable-icon" />
                  <p className="tocyn-users-dialog-message">User profile editing is currently read-only.</p>
                  <p className="tocyn-users-dialog-email tocyn-users-dialog-hint">In this version, users must update their own profiles via the security settings.</p>
                </div>
              ) : (
                <div className="tocyn-users-dialog-unavailable">
                  <p className="tocyn-users-dialog-message">User activity is not available in this view yet.</p>
                  <p className="tocyn-users-dialog-email tocyn-users-dialog-hint">No activity records have been loaded.</p>
                </div>
              )}
            </div>
            <div className="tocyn-users-dialog-footer">
              <TocynButton
                onClick={closeDialog}
                className="tocyn-users-dialog-submit"
              >
                Close
              </TocynButton>
            </div>
          </div>
        )}
      </TocynDialog>
    </div>
  );
};
