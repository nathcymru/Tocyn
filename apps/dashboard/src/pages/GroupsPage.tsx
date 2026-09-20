import { css } from '@luminatick/ui/styled-system/css';
import { TocynDialog } from '@luminatick/ui/dialog';
import { ParkAlert, ParkAvatar, ParkAvatarFallback, ParkButton, ParkCard, ParkDialog, ParkEmptyState, ParkInput, ParkSkeleton, ParkTable, ParkTextarea } from '@luminatick/ui/park';
import { Field as ParkField, InputGroup } from '@luminatick/ui/components';
import React, { useState } from 'react';
import {
  IconUsers,
  IconPlus,
  IconTrash,
  IconUserPlus,
  IconXmark,
  IconShieldHalved,
  IconEnvelope,
  IconMagnifyingGlass
} from '@luminatick/ui/icons';
import {
  useGroups,
  useCreateGroup,
  useDeleteGroup,
  useGroupMembers,
  useAddMember,
  useRemoveMember,
  useAgents
} from '../hooks/useGroups';
import { useAuthStore } from '../store/authStore';
import { Group } from '../types';

export const GroupsPage: React.FC = () => {
  const { user: currentUser } = useAuthStore();
  const isAdmin = currentUser?.role === 'admin';

  const { data: groups, isLoading: isLoadingGroups, isError: groupsError, refetch: refetchGroups } = useGroups();
  const createGroupMutation = useCreateGroup();
  const deleteGroupMutation = useDeleteGroup();

  const [isCreating, setIsCreating] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDescription, setNewGroupDescription] = useState('');
  const createTitle = React.useId();
  const deleteTitle = React.useId();
  const createOpener = React.useRef<HTMLButtonElement>(null);
  const groupNameInput = React.useRef<HTMLInputElement>(null);
  const pageHeading = React.useRef<HTMLHeadingElement>(null);
  const deleteOpener = React.useRef<HTMLButtonElement | null>(null);
  const deleteCancel = React.useRef<HTMLButtonElement>(null);
  const createGuard = React.useRef(false);
  const deleteGuard = React.useRef(false);
  const deleteSucceeded = React.useRef(false);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [returnFocusToHeading, setReturnFocusToHeading] = useState(false);
  const [deleteGroup, setDeleteGroup] = useState<Group | null>(null);
  const [createError, setCreateError] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [groupStatus, setGroupStatus] = useState('');
  const closeCreate = () => { if (!createGuard.current) setIsCreating(false); };
  const closeDelete = () => { if (!deleteGuard.current) setDeleteOpen(false); };

  React.useEffect(() => {
    if (returnFocusToHeading && !deleteOpen) {
      pageHeading.current?.focus();
      setReturnFocusToHeading(false);
    }
  }, [deleteOpen, returnFocusToHeading]);

  const [managingGroupId, setManagingGroupId] = useState<string | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const membersOpener = React.useRef<HTMLButtonElement | null>(null);

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin || !newGroupName || createGuard.current) return;
    createGuard.current = true; setCreating(true); setCreateError(''); setGroupStatus('');
    try {
      await createGroupMutation.mutateAsync({
        name: newGroupName,
        description: newGroupDescription
      });
      setNewGroupName('');
      setNewGroupDescription('');
      setIsCreating(false);
      setGroupStatus('Group created.');
    } catch {
      setCreateError('Group could not be created. Your draft has been kept; try again.');
    } finally { createGuard.current = false; setCreating(false); }
  };

  const handleDeleteGroup = async () => {
    if (!isAdmin || !deleteGroup || deleteGuard.current) return;
    deleteGuard.current = true; setDeleting(true); setDeleteError(''); setGroupStatus('');
    try {
      await deleteGroupMutation.mutateAsync(deleteGroup.id);
      deleteSucceeded.current = true; setReturnFocusToHeading(true); setDeleteOpen(false); setGroupStatus('Group deleted.');
    } catch {
      setDeleteError('Group could not be deleted. Check that no active tickets are assigned, then try again.');
    } finally { deleteGuard.current = false; setDeleting(false); }
  };

  if (isLoadingGroups) return <section role="status" aria-label="Loading groups" aria-busy="true" className={css({ display: 'grid', gap: '4', maxW: '6xl', mx: 'auto', p: '6' })}>
    <span className={css({ srOnly: true })}>Loading groups…</span>
    <ParkSkeleton aria-hidden="true" className={css({ h: '8', w: '48' })} />
    <ParkSkeleton aria-hidden="true" className={css({ h: '32', w: 'full' })} />
  </section>;

  const managingGroup = groups?.find(g => g.id === managingGroupId);

  return (
    <div className={css({"maxW":"6xl","mx":"auto","px":{"base":"4","md":"6"},"py":"6","display":"grid","gap":"6"})}>
      <div className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap","mb":"6"})}>
        <div>
          <h1 ref={pageHeading} tabIndex={-1} className={css({ m: '0', textStyle: '2xl', fontWeight: 'semibold', color: 'fg.default' })}>Group Management</h1>
          <p className={css({ color: 'fg.muted', textStyle: 'sm', lineHeight: 'relaxed' })}>Organize agents into teams to handle specific ticket categories.</p>
        </div>
        {isAdmin && (
          <ParkButton
            ref={createOpener} onClick={() => { setCreateError(''); setIsCreating(true); }}
            className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}
          >
            <IconPlus aria-hidden="true" className={css({"w":"4","h":"4","flexShrink":0})} />
            Create Group
          </ParkButton>
        )}
      </div>

      {groupStatus && <p role="status" className={css({"color":"fg.muted","fontSize":"sm","lineHeight":"relaxed"})}>{groupStatus}</p>}
      {groupsError && Boolean(groups?.length) && <ParkAlert.Root role="alert" status="error"><ParkAlert.Content><ParkAlert.Description>The group list could not be refreshed.</ParkAlert.Description><ParkButton type="button" onClick={() => void refetchGroups()}>Retry groups</ParkButton></ParkAlert.Content></ParkAlert.Root>}
      <TocynDialog open={isCreating} busy={creating} labelledBy={createTitle} initialFocusEl={() => groupNameInput.current} finalFocusEl={() => createOpener.current} onOpenChange={next => { if (!next) closeCreate(); }}>
          <ParkDialog.Header className={css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '3' })}>
            <ParkDialog.Title id={createTitle}>New Support Group</ParkDialog.Title>
            <ParkButton type="button" variant="plain" aria-label="Close group editor" disabled={creating} onClick={closeCreate}>
              <IconXmark aria-hidden="true" size={20} />
            </ParkButton>
          </ParkDialog.Header>
          <ParkDialog.Body>
          <form onSubmit={handleCreateGroup} aria-labelledby={createTitle}>
            {createError && <ParkAlert.Root role="alert" status="error"><ParkAlert.Content><ParkAlert.Description>{createError}</ParkAlert.Description></ParkAlert.Content></ParkAlert.Root>}
            <fieldset disabled={creating} className={css({"display":"grid","gap":"4"})}>
            <ParkField.Root required className={css({ w: 'full', display: 'grid', gap: '1', fontSize: 'sm' })}>
              <ParkField.Label htmlFor={`${createTitle}-name`}>Group Name</ParkField.Label>
              <ParkInput
                type="text"
                required
                className={css({ w: 'full' })}
                placeholder="e.g., Technical Support"
                id={`${createTitle}-name`} ref={groupNameInput} value={newGroupName}
                onChange={e => setNewGroupName(e.target.value)}
              />
              <ParkField.HelperText>Use a short, clear team name.</ParkField.HelperText>
            </ParkField.Root>
            <ParkField.Root className={css({ w: 'full', display: 'grid', gap: '1', fontSize: 'sm' })}>
              <ParkField.Label htmlFor={`${createTitle}-description`}>Description (Optional)</ParkField.Label>
              <ParkTextarea
                className={css({ w: 'full' })}
                placeholder="Briefly describe what this group handles..."
                rows={2}
                id={`${createTitle}-description`} value={newGroupDescription}
                onChange={e => setNewGroupDescription(e.target.value)}
              />
              <ParkField.HelperText>Summarise the tickets this team handles.</ParkField.HelperText>
            </ParkField.Root>
            <ParkDialog.Footer>
              <ParkButton
                type="button" variant="outline"
                onClick={closeCreate}
                className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}
              >
                Cancel
              </ParkButton>
              <ParkButton
                type="submit"
                loading={creating} loadingText="Creating group…"
                className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}
              >
                Create Group
              </ParkButton>
            </ParkDialog.Footer>
            </fieldset>
          </form>
          </ParkDialog.Body>
      </TocynDialog>
      <TocynDialog open={deleteOpen} busy={deleting} labelledBy={deleteTitle} initialFocusEl={() => deleteCancel.current}
        finalFocusEl={() => deleteSucceeded.current ? pageHeading.current : deleteOpener.current}
        onOpenChange={next => { if (!next) closeDelete(); }}>
          <ParkDialog.Header><ParkDialog.Title id={deleteTitle}>Delete group: {deleteGroup?.name}</ParkDialog.Title></ParkDialog.Header>
          <ParkDialog.Body>
          <p>Delete this group? It must not have any active tickets. This action cannot be undone.</p>
          {deleteError && <ParkAlert.Root role="alert" status="error"><ParkAlert.Content><ParkAlert.Description>{deleteError}</ParkAlert.Description></ParkAlert.Content></ParkAlert.Root>}
          </ParkDialog.Body>
          <ParkDialog.Footer>
            <ParkButton type="button" variant="outline" ref={deleteCancel} disabled={deleting} onClick={closeDelete}>Cancel</ParkButton>
            <ParkButton type="button" colorPalette="red" loading={deleting} loadingText="Deleting group…" onClick={handleDeleteGroup}>Delete group</ParkButton>
          </ParkDialog.Footer>
      </TocynDialog>

      {groupsError && !groups?.length ? <ParkEmptyState role="alert" title="Groups could not be loaded" description="Retry to load groups before managing members." action={<ParkButton type="button" onClick={() => void refetchGroups()}>Retry groups</ParkButton>} /> : <ParkCard.Root variant="outline"><ParkCard.Body className={css({ overflowX: 'auto' })}>
        <ParkTable.Root className={css({ w: 'full', fontFamily: 'tabular' })}>
          <ParkTable.Head>
            <ParkTable.Row>
              <ParkTable.Header>Group Name</ParkTable.Header>
              <ParkTable.Header>Description</ParkTable.Header>
              <ParkTable.Header>Created</ParkTable.Header>
              <ParkTable.Header>Actions</ParkTable.Header>
            </ParkTable.Row>
          </ParkTable.Head>
          <ParkTable.Body>
            {!groups?.length ? (
              <ParkTable.Row>
                <ParkTable.Cell colSpan={4}>
                  <ParkEmptyState title="No groups found." description={isAdmin ? 'Create a group to organize your team.' : 'No groups are available in this workspace.'} className={css({ minW: '0' })} />
                </ParkTable.Cell>
              </ParkTable.Row>
            ) : (
              groups?.map((group) => (
                <ParkTable.Row key={group.id}>
                  <ParkTable.Cell className={css({ fontWeight: 'medium', color: 'fg.default' })}>{group.name}</ParkTable.Cell>
                  <ParkTable.Cell className={css({ color: 'fg.muted', overflowWrap: 'anywhere' })}>{group.description || 'No description'}</ParkTable.Cell>
                  <ParkTable.Cell className={css({ fontVariantNumeric: 'tabular-nums' })}>
                    {new Date(group.created_at).toLocaleDateString()}
                  </ParkTable.Cell>
                  <ParkTable.Cell><div className={css({ display: 'flex', alignItems: 'center', gap: '2', flexWrap: 'wrap' })}>
                    <ParkButton type="button" variant="outline"
                      onClick={event => { membersOpener.current = event.currentTarget; setManagingGroupId(group.id); setMembersOpen(true); }}
                      className={css({"display":"inline-flex","alignItems":"center","gap":"2","minW":0})}
                    >
                      <IconUsers aria-hidden="true" className={css({"w":"4","h":"4","flexShrink":0})} />
                      Members
                    </ParkButton>
                    {isAdmin && (
                      <ParkButton type="button" variant="outline"
                        aria-label={`Delete ${group.name}`} onClick={event => { deleteOpener.current = event.currentTarget; deleteSucceeded.current = false; setReturnFocusToHeading(false); setDeleteGroup(group); setDeleteError(''); setDeleteOpen(true); }}
                        className={css({"display":"inline-flex","alignItems":"center","gap":"2","minW":0})}
                        title="Delete Group"
                      >
                        <IconTrash aria-hidden="true" className={css({"w":"4","h":"4","flexShrink":0})} />
                      </ParkButton>
                    )}
                  </div></ParkTable.Cell>
                </ParkTable.Row>
              ))
            )}
          </ParkTable.Body>
        </ParkTable.Root>
      </ParkCard.Body></ParkCard.Root>}

      {managingGroupId && managingGroup && (
        <ManageMembersModal
          group={managingGroup} open={membersOpen} finalFocusEl={() => membersOpener.current}
          onClose={() => setMembersOpen(false)}
          isAdmin={isAdmin}
        />
      )}
    </div>
  );
};

interface ManageMembersModalProps {
  group: Group;
  open: boolean;
  finalFocusEl: () => HTMLElement | null;
  onClose: () => void;
  isAdmin: boolean;
}

const ManageMembersModal: React.FC<ManageMembersModalProps> = ({ group, open, finalFocusEl, onClose, isAdmin }) => {
  const { data: members, isLoading: isLoadingMembers, isError: membersError, refetch: refetchMembers } = useGroupMembers(group.id);
  const { data: agents, isLoading: agentsLoading, isError: agentsError, refetch: refetchAgents } = useAgents();
  const addMemberMutation = useAddMember();
  const removeMemberMutation = useRemoveMember();

  const [searchTerm, setSearchTerm] = useState('');
  const titleId = React.useId();
  const closeButton = React.useRef<HTMLButtonElement>(null);
  const confirmRemovalButton = React.useRef<HTMLButtonElement>(null);
  const pendingGuard = React.useRef(false);
  const [pending, setPending] = useState(false);
  const [operationError, setOperationError] = useState('');
  const [status, setStatus] = useState('');
  const [removingId, setRemovingId] = useState<string | null>(null);
  React.useEffect(() => {
    if (!open) { setSearchTerm(''); setOperationError(''); setStatus(''); setRemovingId(null); }
  }, [open]);
  React.useEffect(() => { if (removingId) confirmRemovalButton.current?.focus(); }, [removingId]);
  React.useEffect(() => { if (!pending && status) closeButton.current?.focus(); }, [pending, status]);
  const close = () => { if (!pendingGuard.current) onClose(); };
  const changeMember = async (userId: string, remove: boolean) => {
    if (!isAdmin || pendingGuard.current || isLoadingMembers || membersError || (!remove && (agentsLoading || agentsError))) return;
    pendingGuard.current = true; setPending(true); setOperationError(''); setStatus('');
    try {
      await (remove ? removeMemberMutation : addMemberMutation).mutateAsync({groupId: group.id, userId});
      setRemovingId(null); setStatus(remove ? 'Member removed.' : 'Member added.');
    } catch {
      setOperationError(remove ? 'Member could not be removed. Try again.' : 'Member could not be added. Try again.');
    } finally { pendingGuard.current = false; setPending(false); }
  };

  const availableAgents = agents?.filter(agent =>
    !members?.some(member => member.id === agent.id) &&
    (agent.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
     agent.email.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <TocynDialog open={open} busy={pending} labelledBy={titleId} initialFocusEl={() => closeButton.current} finalFocusEl={finalFocusEl} onOpenChange={next => { if (!next) close(); }}>
        <ParkDialog.Header className={css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '3' })}>
          <div>
            <ParkDialog.Title id={titleId}>Manage Members: {group.name}</ParkDialog.Title>
            <ParkDialog.Description>Add or remove agents from this group.</ParkDialog.Description>
          </div>
          <ParkButton type="button" variant="plain" ref={closeButton} disabled={pending} aria-label="Close group members" onClick={close}>
            <IconXmark aria-hidden="true" size={24} />
          </ParkButton>
        </ParkDialog.Header>

        <ParkDialog.Body className={css({ display: 'grid', gap: '5', minW: '0' })}>
          {operationError && <ParkAlert.Root role="alert" status="error"><ParkAlert.Content><ParkAlert.Description>{operationError}</ParkAlert.Description></ParkAlert.Content></ParkAlert.Root>}
          {status && <p role="status" className={css({"color":"fg.muted","fontSize":"sm","lineHeight":"relaxed"})}>{status}</p>}
          {membersError && (members?.length ? <ParkAlert.Root role="alert" status="error">
            <ParkAlert.Content>
              <ParkAlert.Title>Group members could not be refreshed</ParkAlert.Title>
              <ParkAlert.Description>These members are the last loaded version. Retry before changing membership.</ParkAlert.Description>
              <ParkButton type="button" onClick={() => void refetchMembers()}>Retry members</ParkButton>
            </ParkAlert.Content>
          </ParkAlert.Root> : <ParkEmptyState role="alert" title="Group members could not be loaded" description="Retry before changing membership." action={<ParkButton type="button" onClick={() => void refetchMembers()}>Retry members</ParkButton>} />)}
          {removingId && <div role="group" aria-label="Confirm member removal" className={css({"minW":0})}>
            <p>Remove {members?.find(member => member.id === removingId)?.full_name || members?.find(member => member.id === removingId)?.email || 'this member'} from the group?</p>
            <ParkButton ref={confirmRemovalButton} disabled={pending || isLoadingMembers || membersError} onClick={() => changeMember(removingId, true)}>Remove member</ParkButton>
            <ParkButton disabled={pending} onClick={() => { setRemovingId(null); closeButton.current?.focus(); }}>Cancel removal</ParkButton>
          </div>}
          {/* Current Members Section */}
          <div>
            <h3 className={css({"fontSize":"xl","fontWeight":"semibold","lineHeight":"tight","color":"fg.default"})}>Current Members{members?.length ? ` (${members.length})` : !isLoadingMembers && !membersError ? ' (0)' : ''}</h3>
            <div className={css({"display":"grid","gap":"4"})}>
              {isLoadingMembers ? (
                <div role="status" aria-label="Loading group members" aria-busy="true" className={css({ display: 'grid', gap: '2' })}><span className={css({ srOnly: true })}>Loading members…</span><ParkSkeleton aria-hidden="true" className={css({ h: '12', w: 'full' })} /><ParkSkeleton aria-hidden="true" className={css({ h: '12', w: 'full' })} /></div>
              ) : !membersError && members?.length === 0 ? (
                <ParkEmptyState title="No members assigned yet." className={css({"py":"6"})} />
              ) : (
                members?.map(member => (
                  <div key={member.id} className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap"})}>
                    <div className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap"})}>
                      <ParkAvatar size="md"><ParkAvatarFallback name={member.full_name || member.email} /></ParkAvatar>
                      <div>
                        <div className={css({"fontWeight":"medium","color":"fg.default"})}>
                          {member.full_name || 'Unnamed'}
                          {member.role === 'admin' && <IconShieldHalved aria-hidden="true" className={css({"w":"4","h":"4","flexShrink":0})} />}
                        </div>
                        <div className={css({"color":"fg.muted","fontSize":"sm","lineHeight":"relaxed"})}>
                          <IconEnvelope aria-hidden="true" className={css({"w":"4","h":"4","flexShrink":0})} />
                          {member.email}
                        </div>
                      </div>
                    </div>
                    {isAdmin && (
                      <ParkButton
                        disabled={pending || isLoadingMembers || membersError} aria-label={`Remove ${member.full_name || member.email}`} onClick={() => setRemovingId(member.id)}
                        className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}
                        title="Remove member"
                      >
                        <IconTrash aria-hidden="true" className={css({"w":"4","h":"4","flexShrink":0})} />
                      </ParkButton>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Add New Member Section (Admin Only) */}
          {isAdmin && (
            <div className={css({"minW":0})}>
              <h3 className={css({"fontSize":"xl","fontWeight":"semibold","lineHeight":"tight","color":"fg.default"})}>Add Agent</h3>
              <InputGroup startElement={<IconMagnifyingGlass aria-hidden="true" className={css({ w: '4', h: '4' })} />}>
                <ParkInput
                  type="text"
                  aria-label="Search agents" disabled={pending} placeholder="Search agents by name or email..."
                  className={css({"w":"full"})}
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                />
              </InputGroup>

              <div className={css({"display":"grid","gap":"4"})}>
                {agentsError && (agents?.length ? <ParkAlert.Root role="alert" status="error">
                  <ParkAlert.Content>
                    <ParkAlert.Title>Agents could not be refreshed</ParkAlert.Title>
                    <ParkAlert.Description>These agents are the last loaded version. Retry before adding anyone to the group.</ParkAlert.Description>
                    <ParkButton type="button" onClick={() => void refetchAgents()}>Retry agents</ParkButton>
                  </ParkAlert.Content>
                </ParkAlert.Root> : <ParkEmptyState role="alert" title="Agents could not be loaded" description="Retry to find agents who can join this group." action={<ParkButton type="button" onClick={() => void refetchAgents()}>Retry agents</ParkButton>} />)}
                {agentsLoading && <div role="status" aria-label="Loading available agents" aria-busy="true" className={css({ display: 'grid', gap: '2' })}><span className={css({ srOnly: true })}>Loading agents…</span><ParkSkeleton aria-hidden="true" className={css({ h: '12', w: 'full' })} /></div>}
                {availableAgents?.map(agent => (
                  <ParkButton
                    key={agent.id}
                    disabled={pending || isLoadingMembers || membersError || agentsLoading || agentsError} aria-label={`Add ${agent.full_name || agent.email}`} onClick={() => changeMember(agent.id, false)}
                    className={css({"minW":0})}
                  >
                    <div className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap"})}>
                      <ParkAvatar size="md"><ParkAvatarFallback name={agent.full_name || agent.email} /></ParkAvatar>
                      <div>
                        <div className={css({"fontWeight":"medium","color":"fg.default"})}>{agent.full_name || 'Unnamed'}</div>
                        <div className={css({"color":"fg.muted","fontSize":"sm","lineHeight":"relaxed"})}>{agent.email}</div>
                      </div>
                    </div>
                    <IconUserPlus aria-hidden="true" className={css({"w":"4","h":"4","flexShrink":0})} />
                  </ParkButton>
                ))}
                {!agentsError && availableAgents?.length === 0 && searchTerm && (
                  <ParkEmptyState title="No matching agents found." className={css({"py":"6"})} />
                )}
                {!agentsError && availableAgents?.length === 0 && !searchTerm && (
                  <ParkEmptyState title="All available agents are already in this group." className={css({"py":"6"})} />
                )}
              </div>
            </div>
          )}
        </ParkDialog.Body>

        <ParkDialog.Footer>
          <ParkButton type="button" variant="outline" disabled={pending} onClick={close}>Done</ParkButton>
        </ParkDialog.Footer>
    </TocynDialog>
  );
};
