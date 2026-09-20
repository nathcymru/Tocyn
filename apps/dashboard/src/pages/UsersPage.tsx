import { css } from '@luminatick/ui/styled-system/css';
import { OperatorCapacityPanel } from '../components/capacity/OperatorCapacityPanel';
import { useAuthStore } from '../store/authStore';
import { TocynDialog } from '@luminatick/ui/dialog';
import { ParkButton, ParkCard, ParkEmptyState } from '@luminatick/ui/park';
import React, { useState } from 'react';
import { useUsers } from '../hooks/useUsers';
import { User } from '../types';
import { User as UserIcon, Shield, Mail, Calendar, ShieldCheck, X, Settings } from '../components/icons';

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

  if (isLoading) return <ParkEmptyState role="status" className={css({"py":"6"})} title="Loading team members…" headingLevel={false} />;

  return (
    <div className={css({"maxW":"6xl","mx":"auto","px":{"base":"4","md":"6"},"py":"6","display":"grid","gap":"6"})}>
      <div className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap","mb":"6"})}>
        <div>
          <h1 className={css({"fontSize":"xl","fontWeight":"semibold","lineHeight":"tight","color":"text.default"})}>Team Management</h1>
          <p className={css({"color":"text.muted","fontSize":"sm","lineHeight":"relaxed"})}>Manage agents, admins, and their access levels.</p>
        </div>
        <ParkButton className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}>
          Invite New User
        </ParkButton>
      </div>

      {error && (
        <div role="alert" className={css({"p":"3","rounded":"md","bg":"bg.subtle","color":"text.default"})}>
          {error.message}
          <ParkButton type="button" disabled={isFetching} onClick={() => void refetch()} className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}>Retry team members</ParkButton>
        </div>
      )}

      <div className={css({"display":"grid","gap":"4","gridTemplateColumns":{"base":"1fr","md":"repeat(2,minmax(0,1fr))","xl":"repeat(3,minmax(0,1fr))"}})}>
        {users.map((user) => (
          <ParkCard.Root key={user.id} variant="outline">
            <ParkCard.Body className={css({ display: 'grid', gap: '4' })}>
            <div className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap"})}>
              <div className={css({"display":"grid","placeItems":"center","w":"10","h":"10","rounded":"full","bg":"bg.muted"})}>
                <UserIcon className={css({"w":"4","h":"4","flexShrink":0})} />
              </div>
              <span className={css({ display: 'inline-flex', alignItems: 'center', rounded: 'full', px: '2', py: '0.5', fontSize: 'xs', fontWeight: 'medium', bg: user.role === 'admin' ? 'colorPalette.3' : 'bg.muted', color: 'text.default' })}>
                {user.role}
              </span>
            </div>

            <h3 className={css({"fontWeight":"medium","color":"text.default"})}>{user.full_name || 'Unnamed User'}</h3>
            <div className={css({"display":"grid","gap":"4"})}>
              <div className={css({"minW":0})}>
                <Mail className={css({"w":"4","h":"4","flexShrink":0})} />
                {user.email}
              </div>
              <div className={css({"minW":0})}>
                <Calendar className={css({"w":"4","h":"4","flexShrink":0})} />
                Joined {new Date(user.created_at).toLocaleDateString()}
              </div>
              <div className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap"})}>
                {user.mfa_enabled ? (
                  <span className={css({"minW":0,"color":"text.default"})}>
                    <ShieldCheck className={css({"w":"4","h":"4","flexShrink":0})} />
                    MFA Enabled
                  </span>
                ) : (
                  <span className={css({"minW":0})}>
                    <Shield className={css({"w":"4","h":"4","flexShrink":0})} />
                    MFA Disabled
                  </span>
                )}
              </div>
            </div>

            <div className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap"})}>
              {administrator&&['admin','agent'].includes(user.role)&&<ParkButton type="button" variant="outline" aria-haspopup="dialog"
                onClick={event=>{opener.current=event.currentTarget;setCapturedIdentity(selectionIdentity);setSelectedUser(user);setModalType('capacity');}}
                className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}>Capacity</ParkButton>}
              <ParkButton variant="outline"
                aria-haspopup="dialog" onClick={event => { opener.current=event.currentTarget; setCapturedIdentity(selectionIdentity);setSelectedUser(user); setModalType('edit'); }}
                className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}
              >
                Edit Profile
              </ParkButton>
              <ParkButton variant="outline"
                aria-haspopup="dialog" onClick={event => { opener.current=event.currentTarget; setCapturedIdentity(selectionIdentity);setSelectedUser(user); setModalType('activity'); }}
                className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}
              >
                View Activity
              </ParkButton>
            </div>
            </ParkCard.Body>
          </ParkCard.Root>
        ))}
        {!error && users.length === 0 && (
          <ParkEmptyState className={css({"py":"6"})} title="No team members found" description="Start by inviting your first agent or admin." />
        )}
      </div>

      <TocynDialog open={Boolean(selectedUser && modalType)} onOpenChange={open => { if (!open) closeDialog(); }}
        labelledBy={dialogTitleId} initialFocusEl={() => closeControl.current} finalFocusEl={() => opener.current}>
        {selectedUser && (
          <div className={css({"bg":"bg.surface","borderWidth":"1px","borderColor":"border.default","rounded":"lg","p":"4"})}>
            <div className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap"})}>
              <h2 id={dialogTitleId} className={css({"fontSize":"xl","fontWeight":"semibold","lineHeight":"tight","color":"text.default"})}>
                {modalType === 'capacity' ? 'Operator capacity' : modalType === 'edit' ? 'Edit User Profile' : 'User Activity Log'}
              </h2>
              <ParkButton type="button" ref={closeControl} aria-label="Close user details" onClick={closeDialog} className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}>
                <X className={css({"w":"4","h":"4","flexShrink":0})} />
              </ParkButton>
            </div>
            <div className={css({"minW":0})}>
              <div className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap"})}>
                <div className={css({"display":"grid","placeItems":"center","w":"10","h":"10","rounded":"full","bg":"bg.muted"})}>
                  {(selectedUser.full_name || selectedUser.email).charAt(0).toUpperCase()}
                </div>
                <div>
                  <h3 className={css({"fontWeight":"medium","color":"text.default"})}>{selectedUser.full_name || 'Unnamed User'}</h3>
                  <p className={css({"color":"text.muted","fontSize":"sm","lineHeight":"relaxed"})}>{selectedUser.email}</p>
                </div>
              </div>

              {modalType === 'capacity' ? (
                <OperatorCapacityPanel userId={selectedUser.id} editable={administrator}/>
              ) : modalType === 'edit' ? (
                <div className={css({"minW":0})}>
                  <Settings className={css({"w":"4","h":"4","flexShrink":0})} />
                  <p className={css({"minW":0})}>User profile editing is currently read-only.</p>
                  <p className={css({"color":"text.muted","fontSize":"sm","lineHeight":"relaxed"})}>In this version, users must update their own profiles via the security settings.</p>
                </div>
              ) : (
                <div className={css({"minW":0})}>
                  <p className={css({"minW":0})}>User activity is not available in this view yet.</p>
                  <p className={css({"color":"text.muted","fontSize":"sm","lineHeight":"relaxed"})}>No activity records have been loaded.</p>
                </div>
              )}
            </div>
            <div className={css({"minW":0})}>
              <ParkButton
                onClick={closeDialog}
                className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}
              >
                Close
              </ParkButton>
            </div>
          </div>
        )}
      </TocynDialog>
    </div>
  );
};
