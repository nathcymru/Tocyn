import { css } from '@luminatick/ui/styled-system/css';
import { OperatorCapacityPanel } from '../components/capacity/OperatorCapacityPanel';
import { useAuthStore } from '../store/authStore';
import { TocynDialog } from '@luminatick/ui/dialog';
import { Badge } from '@luminatick/ui/components';
import { ParkAlert, ParkAvatar, ParkAvatarFallback, ParkButton, ParkCard, ParkDialog, ParkEmptyState, ParkSkeleton } from '@luminatick/ui/park';
import React, { useState } from 'react';
import { useUsers } from '../hooks/useUsers';
import { User } from '../types';
import { Shield, Calendar, ShieldCheck, X } from '../components/icons';

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map(part => part.charAt(0).toUpperCase()).join('') || 'U';
}

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

  if (isLoading) return <section role="status" aria-label="Loading team members" aria-busy="true" className={css({ display: 'grid', gap: '4', maxW: '6xl', mx: 'auto', p: '6' })}>
    <span className={css({ srOnly: true })}>Loading team members…</span>
    <ParkSkeleton aria-hidden="true" className={css({ h: '8', w: '48' })} />
    <ParkSkeleton aria-hidden="true" className={css({ h: '32', w: 'full' })} />
  </section>;

  return (
    <div className={css({"maxW":"6xl","mx":"auto","px":{"base":"4","md":"6"},"py":"6","display":"grid","gap":"6"})}>
      <div className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap","mb":"6"})}>
        <div>
          <h1 className={css({ m: '0', textStyle: '2xl', fontWeight: 'semibold', color: 'fg.default' })}>Team Management</h1>
          <p className={css({"color":"fg.muted","fontSize":"sm","lineHeight":"relaxed"})}>Manage agents, admins, and their access levels.</p>
        </div>
      </div>

      {error && (users.length === 0
        ? <ParkEmptyState role="alert" title="Team members are unavailable" description={error.message}
            action={<ParkButton type="button" loading={isFetching} loadingText="Retrying team members…" onClick={() => void refetch()}>Retry team members</ParkButton>} />
        : <ParkAlert.Root role="alert" status="error"><ParkAlert.Content>
            <ParkAlert.Title>Team members could not be refreshed</ParkAlert.Title>
            <ParkAlert.Description>Showing the last loaded team members. {error.message}</ParkAlert.Description>
            <ParkButton type="button" variant="outline" loading={isFetching} loadingText="Retrying team members…" onClick={() => void refetch()}>Retry team members</ParkButton>
          </ParkAlert.Content></ParkAlert.Root>
      )}

      <div className={css({"display":"grid","gap":"4","gridTemplateColumns":{"base":"1fr","md":"repeat(2,minmax(0,1fr))","xl":"repeat(3,minmax(0,1fr))"}})}>
        {users.map((user) => (
          <ParkCard.Root key={user.id} variant="outline">
            <ParkCard.Header className={css({ flexDirection: 'row', alignItems: 'center', gap: '3' })}>
              <ParkAvatar size="md"><ParkAvatarFallback>{initials(user.full_name || user.email)}</ParkAvatarFallback></ParkAvatar>
              <div className={css({ minW: '0', flex: '1' })}>
                <ParkCard.Title>{user.full_name || 'Unnamed User'}</ParkCard.Title>
                <ParkCard.Description className={css({ overflowWrap: 'anywhere' })}>{user.email}</ParkCard.Description>
              </div>
              <Badge colorPalette={user.role === 'admin' ? 'blue' : 'gray'}>{user.role}</Badge>
            </ParkCard.Header>
            <ParkCard.Body className={css({ display: 'grid', gap: '4' })}>
            <div className={css({"display":"grid","gap":"4"})}>
              <div className={css({ display: 'flex', alignItems: 'center', gap: '2', color: 'fg.muted', textStyle: 'sm' })}>
                <Calendar aria-hidden="true" className={css({"w":"4","h":"4","flexShrink":0})} />
                Joined {new Date(user.created_at).toLocaleDateString()}
              </div>
              <div className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap"})}>
                {user.mfa_enabled ? (
                  <span className={css({"minW":0,"color":"fg.default"})}>
                    <ShieldCheck aria-hidden="true" className={css({"w":"4","h":"4","flexShrink":0})} />
                    MFA Enabled
                  </span>
                ) : (
                  <span className={css({"minW":0})}>
                    <Shield aria-hidden="true" className={css({"w":"4","h":"4","flexShrink":0})} />
                    MFA Disabled
                  </span>
                )}
              </div>
            </div>

            <div className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap"})}>
              {administrator&&['admin','agent'].includes(user.role)&&<ParkButton type="button" variant="outline" aria-haspopup="dialog"
                onClick={event=>{opener.current=event.currentTarget;setCapturedIdentity(selectionIdentity);setSelectedUser(user);setModalType('capacity');}}
                className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}>Capacity</ParkButton>}
              <ParkButton type="button" variant="outline"
                aria-haspopup="dialog" onClick={event => { opener.current=event.currentTarget; setCapturedIdentity(selectionIdentity);setSelectedUser(user); setModalType('edit'); }}
                className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}
              >
                Profile details
              </ParkButton>
              <ParkButton type="button" variant="outline"
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
          <ParkEmptyState className={css({"py":"6"})} title="No team members found" description="No team members were returned for this workspace." action={<ParkButton type="button" onClick={() => void refetch()}>Refresh team members</ParkButton>} />
        )}
      </div>

      <TocynDialog open={Boolean(selectedUser && modalType)} onOpenChange={open => { if (!open) closeDialog(); }}
        labelledBy={dialogTitleId} initialFocusEl={() => closeControl.current} finalFocusEl={() => opener.current}>
        {selectedUser && <>
          <ParkDialog.Header className={css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '3' })}>
            <ParkDialog.Title id={dialogTitleId}>
              {modalType === 'capacity' ? 'Operator capacity' : modalType === 'edit' ? 'User Profile' : 'User Activity Log'}
            </ParkDialog.Title>
            <ParkButton type="button" variant="plain" ref={closeControl} aria-label="Close user details" onClick={closeDialog}>
              <X aria-hidden="true" className={css({ w: '4', h: '4' })} />
            </ParkButton>
          </ParkDialog.Header>
          <ParkDialog.Body className={css({ display: 'grid', gap: '4', minW: '0' })}>
            <div className={css({ display: 'flex', alignItems: 'center', gap: '3', minW: '0' })}>
              <ParkAvatar size="md"><ParkAvatarFallback>{initials(selectedUser.full_name || selectedUser.email)}</ParkAvatarFallback></ParkAvatar>
              <div className={css({ minW: '0' })}>
                <p className={css({ m: '0', fontWeight: 'semibold', color: 'fg.default' })}>{selectedUser.full_name || 'Unnamed User'}</p>
                <p className={css({ m: '0', color: 'fg.muted', overflowWrap: 'anywhere' })}>{selectedUser.email}</p>
              </div>
            </div>
            {modalType === 'capacity' ? <OperatorCapacityPanel userId={selectedUser.id} editable={administrator} />
              : modalType === 'edit' ? <ParkEmptyState headingLevel={false} title="Profile editing is unavailable" description="Users can update their own security profile. This directory view is read-only." />
              : <ParkEmptyState headingLevel={false} title="User activity is unavailable" description="No activity records have been loaded." />}
          </ParkDialog.Body>
          <ParkDialog.Footer><ParkButton type="button" variant="outline" onClick={closeDialog}>Close</ParkButton></ParkDialog.Footer>
        </>}
      </TocynDialog>
    </div>
  );
};
