import { css } from '@luminatick/ui/styled-system/css';
import { TocynDialog } from '@luminatick/ui/dialog';
import { ParkButton, ParkInput, ParkTextarea, ParkTable } from '@luminatick/ui/park';
import { ParkEmptyState } from '@luminatick/ui/park';
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

  const { data: groups, isLoading: isLoadingGroups } = useGroups();
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

  if (isLoadingGroups) return <ParkEmptyState title="Loading groups…" className={css({"minW":0})} aria-busy="true" />;

  const managingGroup = groups?.find(g => g.id === managingGroupId);

  return (
    <div className={css({"maxW":"6xl","mx":"auto","px":{"base":"4","md":"6"},"py":"6","display":"grid","gap":"6"})}>
      <div className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap","mb":"6"})}>
        <div>
          <h1 ref={pageHeading} tabIndex={-1} className={css({"fontSize":"xl","fontWeight":"semibold","lineHeight":"tight","color":"text.default"})}>Group Management</h1>
          <p className={css({"color":"text.muted","fontSize":"sm","lineHeight":"relaxed"})}>Organize agents into teams to handle specific ticket categories.</p>
        </div>
        {isAdmin && (
          <ParkButton
            ref={createOpener} onClick={() => { setCreateError(''); setIsCreating(true); }}
            className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}
          >
            <IconPlus className={css({"w":"4","h":"4","flexShrink":0})} />
            Create Group
          </ParkButton>
        )}
      </div>

      {groupStatus && <p role="status" className={css({"color":"text.muted","fontSize":"sm","lineHeight":"relaxed"})}>{groupStatus}</p>}
      <TocynDialog open={isCreating} busy={creating} labelledBy={createTitle} initialFocusEl={() => groupNameInput.current} finalFocusEl={() => createOpener.current} onOpenChange={next => { if (!next) closeCreate(); }}>
        <div className={css({"bg":"bg.surface","borderWidth":"1px","borderColor":"border.default","rounded":"lg","p":"4"})}>
          <div className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap"})}>
            <h2 id={createTitle} className={css({"fontSize":"xl","fontWeight":"semibold","lineHeight":"tight","color":"text.default"})}>New Support Group</h2>
            <ParkButton aria-label="Close group editor" disabled={creating} onClick={closeCreate} className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}>
              <IconXmark size={20} />
            </ParkButton>
          </div>
          <form onSubmit={handleCreateGroup} aria-labelledby={createTitle}>
            {createError && <p role="alert" className={css({"p":"3","rounded":"md","bg":"bg.subtle","color":"text.default"})}>{createError}</p>}
            <fieldset disabled={creating} className={css({"display":"grid","gap":"4"})}>
            <div className={css({"w":"full","display":"grid","gap":"1","fontSize":"sm"})}>
              <label htmlFor={`${createTitle}-name`}>Group Name</label>
              <ParkInput
                type="text"
                required
                className={css({"w":"full"})}
                placeholder="e.g., Technical Support"
                id={`${createTitle}-name`} ref={groupNameInput} value={newGroupName}
                onChange={e => setNewGroupName(e.target.value)}
              />
            </div>
            <div className={css({"w":"full","display":"grid","gap":"1","fontSize":"sm"})}>
              <label htmlFor={`${createTitle}-description`}>Description (Optional)</label>
              <ParkTextarea
                className={css({"w":"full"})}
                placeholder="Briefly describe what this group handles..."
                rows={2}
                id={`${createTitle}-description`} value={newGroupDescription}
                onChange={e => setNewGroupDescription(e.target.value)}
              />
            </div>
            <div className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap"})}>
              <ParkButton
                type="button"
                onClick={closeCreate}
                className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}
              >
                Cancel
              </ParkButton>
              <ParkButton
                type="submit"
                disabled={creating}
                className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}
              >
                {creating ? 'Creating...' : 'Create Group'}
              </ParkButton>
            </div>
            </fieldset>
          </form>
        </div>
      </TocynDialog>
      <TocynDialog open={deleteOpen} busy={deleting} labelledBy={deleteTitle} initialFocusEl={() => deleteCancel.current}
        finalFocusEl={() => deleteSucceeded.current ? pageHeading.current : deleteOpener.current}
        onOpenChange={next => { if (!next) closeDelete(); }}>
        <div className={css({"bg":"bg.surface","borderWidth":"1px","borderColor":"border.default","rounded":"lg","p":"4"})}>
          <h2 id={deleteTitle} className={css({"fontSize":"xl","fontWeight":"semibold","lineHeight":"tight","color":"text.default"})}>Delete group: {deleteGroup?.name}</h2>
          <p>Delete this group? It must not have any active tickets. This action cannot be undone.</p>
          {deleteError && <p role="alert" className={css({"p":"3","rounded":"md","bg":"bg.subtle","color":"text.default"})}>{deleteError}</p>}
          <div className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap"})}>
            <ParkButton ref={deleteCancel} disabled={deleting} onClick={closeDelete}>Cancel</ParkButton>
            <ParkButton disabled={deleting} onClick={handleDeleteGroup}>{deleting ? 'Deleting...' : 'Delete group'}</ParkButton>
          </div>
        </div>
      </TocynDialog>

      <div className={css({"bg":"bg.surface","borderWidth":"1px","borderColor":"border.default","rounded":"lg","p":"4","overflowX":"auto"})}>
        <ParkTable.Root className={css({"w":"full","borderCollapse":"collapse"})}>
          <ParkTable.Head>
            <ParkTable.Row className={css({"borderBottomWidth":"1px","borderColor":"border.default"})}>
              <ParkTable.Header className={css({"p":"3","textAlign":"left","verticalAlign":"top"})}>Group Name</ParkTable.Header>
              <ParkTable.Header className={css({"p":"3","textAlign":"left","verticalAlign":"top"})}>Description</ParkTable.Header>
              <ParkTable.Header className={css({"p":"3","textAlign":"left","verticalAlign":"top"})}>Created</ParkTable.Header>
              <ParkTable.Header className={css({"p":"3","textAlign":"right","verticalAlign":"top","display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap"})}>Actions</ParkTable.Header>
            </ParkTable.Row>
          </ParkTable.Head>
          <ParkTable.Body className={css({"minW":0})}>
            {groups?.length === 0 ? (
              <ParkTable.Row>
                <ParkTable.Cell colSpan={4} className={css({"p":"3","textAlign":"left","verticalAlign":"top"})}>
                  <ParkEmptyState title="No groups found." description="Create one to start organizing your team." className={css({"minW":0})} />
                </ParkTable.Cell>
              </ParkTable.Row>
            ) : (
              groups?.map((group) => (
                <ParkTable.Row key={group.id} className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap","borderBottomWidth":"1px","borderColor":"border.default"})}>
                  <ParkTable.Cell className={css({"fontWeight":"medium","color":"text.default"})}>{group.name}</ParkTable.Cell>
                  <ParkTable.Cell className={css({"color":"text.muted","fontSize":"sm","lineHeight":"relaxed"})}>{group.description || '-'}</ParkTable.Cell>
                  <ParkTable.Cell className={css({"minW":0})}>
                    {new Date(group.created_at).toLocaleDateString()}
                  </ParkTable.Cell>
                  <ParkTable.Cell className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap"})}>
                    <ParkButton
                      onClick={event => { membersOpener.current = event.currentTarget; setManagingGroupId(group.id); setMembersOpen(true); }}
                      className={css({"display":"inline-flex","alignItems":"center","gap":"2","minW":0})}
                    >
                      <IconUsers className={css({"w":"4","h":"4","flexShrink":0})} />
                      Members
                    </ParkButton>
                    {isAdmin && (
                      <ParkButton
                        aria-label={`Delete ${group.name}`} onClick={event => { deleteOpener.current = event.currentTarget; deleteSucceeded.current = false; setReturnFocusToHeading(false); setDeleteGroup(group); setDeleteError(''); setDeleteOpen(true); }}
                        className={css({"display":"inline-flex","alignItems":"center","gap":"2","minW":0})}
                        title="Delete Group"
                      >
                        <IconTrash className={css({"w":"4","h":"4","flexShrink":0})} />
                      </ParkButton>
                    )}
                  </ParkTable.Cell>
                </ParkTable.Row>
              ))
            )}
          </ParkTable.Body>
        </ParkTable.Root>
      </div>

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
  const { data: members, isLoading: isLoadingMembers, isError: membersError } = useGroupMembers(group.id);
  const { data: agents, isLoading: agentsLoading, isError: agentsError } = useAgents();
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
      <div className={css({"bg":"bg.surface","borderWidth":"1px","borderColor":"border.default","rounded":"lg","p":"4"})}>
        <div className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap"})}>
          <div>
            <h2 id={titleId} className={css({"fontSize":"xl","fontWeight":"semibold","lineHeight":"tight","color":"text.default"})}>Manage Members: {group.name}</h2>
            <p className={css({"color":"text.muted","fontSize":"sm","lineHeight":"relaxed"})}>Add or remove agents from this group.</p>
          </div>
          <ParkButton ref={closeButton} disabled={pending} aria-label="Close group members" onClick={close} className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}>
            <IconXmark size={24} />
          </ParkButton>
        </div>

        <div className={css({"minW":0})}>
          {operationError && <p role="alert" className={css({"p":"3","rounded":"md","bg":"bg.subtle","color":"text.default"})}>{operationError}</p>}
          {status && <p role="status" className={css({"color":"text.muted","fontSize":"sm","lineHeight":"relaxed"})}>{status}</p>}
          {membersError && <p role="alert" className={css({"p":"3","rounded":"md","bg":"bg.subtle","color":"text.default"})}>Group members could not be loaded. Reopen this page to retry.</p>}
          {removingId && <div role="group" aria-label="Confirm member removal" className={css({"minW":0})}>
            <p>Remove {members?.find(member => member.id === removingId)?.full_name || members?.find(member => member.id === removingId)?.email || 'this member'} from the group?</p>
            <ParkButton ref={confirmRemovalButton} disabled={pending} onClick={() => changeMember(removingId, true)}>Remove member</ParkButton>
            <ParkButton disabled={pending} onClick={() => { setRemovingId(null); closeButton.current?.focus(); }}>Cancel removal</ParkButton>
          </div>}
          {/* Current Members Section */}
          <div>
            <h3 className={css({"fontSize":"xl","fontWeight":"semibold","lineHeight":"tight","color":"text.default"})}>Current Members ({members?.length || 0})</h3>
            <div className={css({"display":"grid","gap":"4"})}>
              {isLoadingMembers ? (
                <ParkEmptyState title="Loading members…" className={css({"py":"6"})} aria-busy="true" />
              ) : members?.length === 0 ? (
                <ParkEmptyState title="No members assigned yet." className={css({"py":"6"})} />
              ) : (
                members?.map(member => (
                  <div key={member.id} className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap"})}>
                    <div className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap"})}>
                      <div className={css({"display":"grid","placeItems":"center","w":"10","h":"10","rounded":"full","bg":"bg.muted"})}>
                        {member.full_name?.[0] || member.email[0].toUpperCase()}
                      </div>
                      <div>
                        <div className={css({"fontWeight":"medium","color":"text.default"})}>
                          {member.full_name || 'Unnamed'}
                          {member.role === 'admin' && <IconShieldHalved className={css({"w":"4","h":"4","flexShrink":0})} />}
                        </div>
                        <div className={css({"color":"text.muted","fontSize":"sm","lineHeight":"relaxed"})}>
                          <IconEnvelope className={css({"w":"4","h":"4","flexShrink":0})} />
                          {member.email}
                        </div>
                      </div>
                    </div>
                    {isAdmin && (
                      <ParkButton
                        disabled={pending} aria-label={`Remove ${member.full_name || member.email}`} onClick={() => setRemovingId(member.id)}
                        className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}
                        title="Remove member"
                      >
                        <IconTrash className={css({"w":"4","h":"4","flexShrink":0})} />
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
              <h3 className={css({"fontSize":"xl","fontWeight":"semibold","lineHeight":"tight","color":"text.default"})}>Add Agent</h3>
              <div className={css({"minW":0})}>
                <IconMagnifyingGlass className={css({"w":"4","h":"4","flexShrink":0})} />
                <ParkInput
                  type="text"
                  aria-label="Search agents" disabled={pending} placeholder="Search agents by name or email..."
                  className={css({"w":"full"})}
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                />
              </div>

              <div className={css({"display":"grid","gap":"4"})}>
                {agentsError && <p role="alert" className={css({"p":"3","rounded":"md","bg":"bg.subtle","color":"text.default"})}>Agents could not be loaded. Reopen this page to retry.</p>}
                {agentsLoading && <ParkEmptyState title="Loading agents…" className={css({"py":"6"})} aria-busy="true" />}
                {availableAgents?.map(agent => (
                  <ParkButton
                    key={agent.id}
                    disabled={pending || isLoadingMembers || membersError || agentsLoading || agentsError} aria-label={`Add ${agent.full_name || agent.email}`} onClick={() => changeMember(agent.id, false)}
                    className={css({"minW":0})}
                  >
                    <div className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap"})}>
                      <div className={css({"display":"grid","placeItems":"center","w":"10","h":"10","rounded":"full","bg":"bg.muted"})}>
                        {agent.full_name?.[0] || agent.email[0].toUpperCase()}
                      </div>
                      <div>
                        <div className={css({"fontWeight":"medium","color":"text.default"})}>{agent.full_name || 'Unnamed'}</div>
                        <div className={css({"color":"text.muted","fontSize":"sm","lineHeight":"relaxed"})}>{agent.email}</div>
                      </div>
                    </div>
                    <IconUserPlus className={css({"w":"4","h":"4","flexShrink":0})} />
                  </ParkButton>
                ))}
                {availableAgents?.length === 0 && searchTerm && (
                  <ParkEmptyState title="No matching agents found." className={css({"py":"6"})} />
                )}
                {availableAgents?.length === 0 && !searchTerm && (
                  <ParkEmptyState title="All available agents are already in this group." className={css({"py":"6"})} />
                )}
              </div>
            </div>
          )}
        </div>

        <div className={css({"minW":0})}>
          <ParkButton
            disabled={pending} onClick={close}
            className={css({"minW":0})}
          >
            Done
          </ParkButton>
        </div>
      </div>
    </TocynDialog>
  );
};
