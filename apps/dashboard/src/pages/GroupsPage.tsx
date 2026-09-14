import { TocynDialog } from '@luminatick/ui/dialog';
import { ParkButton, ParkInput, ParkTextarea } from '@luminatick/ui/park';
import { ParkEmptyState } from '@luminatick/ui/park';
import React, { useState } from 'react';
import {
  FaUsers,
  FaPlus,
  FaTrash,
  FaUserPlus,
  FaXmark,
  FaShieldHalved,
  FaEnvelope,
  FaMagnifyingGlass
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

  if (isLoadingGroups) return <ParkEmptyState title="Loading groups…" className="tocyn-groups-loading-state" aria-busy="true" />;

  const managingGroup = groups?.find(g => g.id === managingGroupId);

  return (
    <div className="tocyn-groups-page">
      <div className="tocyn-groups-header">
        <div>
          <h1 ref={pageHeading} tabIndex={-1} className="tocyn-groups-title">Group Management</h1>
          <p className="tocyn-groups-description">Organize agents into teams to handle specific ticket categories.</p>
        </div>
        {isAdmin && (
          <ParkButton
            ref={createOpener} onClick={() => { setCreateError(''); setIsCreating(true); }}
            className="tocyn-groups-create"
          >
            <FaPlus className="tocyn-groups-create-icon" />
            Create Group
          </ParkButton>
        )}
      </div>

      {groupStatus && <p role="status" className="tocyn-groups-status">{groupStatus}</p>}
      <TocynDialog open={isCreating} busy={creating} labelledBy={createTitle} initialFocusEl={() => groupNameInput.current} finalFocusEl={() => createOpener.current} onOpenChange={next => { if (!next) closeCreate(); }}>
        <div className="tocyn-groups-editor">
          <div className="tocyn-groups-editor-header">
            <h2 id={createTitle} className="tocyn-groups-editor-title">New Support Group</h2>
            <ParkButton aria-label="Close group editor" disabled={creating} onClick={closeCreate} className="tocyn-groups-editor-close">
              <FaXmark size={20} />
            </ParkButton>
          </div>
          <form onSubmit={handleCreateGroup} aria-labelledby={createTitle}>
            {createError && <p role="alert" className="tocyn-groups-editor-error">{createError}</p>}
            <fieldset disabled={creating} className="tocyn-groups-editor-fields">
            <div className="tocyn-form-field">
              <label htmlFor={`${createTitle}-name`}>Group Name</label>
              <ParkInput
                type="text"
                required
                className="tocyn-form-control"
                placeholder="e.g., Technical Support"
                id={`${createTitle}-name`} ref={groupNameInput} value={newGroupName}
                onChange={e => setNewGroupName(e.target.value)}
              />
            </div>
            <div className="tocyn-form-field">
              <label htmlFor={`${createTitle}-description`}>Description (Optional)</label>
              <ParkTextarea
                className="tocyn-form-control"
                placeholder="Briefly describe what this group handles..."
                rows={2}
                id={`${createTitle}-description`} value={newGroupDescription}
                onChange={e => setNewGroupDescription(e.target.value)}
              />
            </div>
            <div className="tocyn-groups-dialog-actions">
              <ParkButton
                type="button"
                onClick={closeCreate}
                className="tocyn-groups-cancel-action"
              >
                Cancel
              </ParkButton>
              <ParkButton
                type="submit"
                disabled={creating}
                className="tocyn-groups-create-action"
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
        <div className="tocyn-groups-delete-dialog">
          <h2 id={deleteTitle} className="tocyn-groups-delete-title">Delete group: {deleteGroup?.name}</h2>
          <p>Delete this group? It must not have any active tickets. This action cannot be undone.</p>
          {deleteError && <p role="alert" className="tocyn-groups-delete-error">{deleteError}</p>}
          <div className="tocyn-groups-dialog-actions">
            <ParkButton ref={deleteCancel} disabled={deleting} onClick={closeDelete}>Cancel</ParkButton>
            <ParkButton disabled={deleting} onClick={handleDeleteGroup}>{deleting ? 'Deleting...' : 'Delete group'}</ParkButton>
          </div>
        </div>
      </TocynDialog>

      <div className="tocyn-groups-table-shell">
        <table className="tocyn-groups-table">
          <thead>
            <tr className="tocyn-groups-table-head">
              <th className="tocyn-groups-table-heading-cell">Group Name</th>
              <th className="tocyn-groups-table-heading-cell">Description</th>
              <th className="tocyn-groups-table-heading-cell">Created</th>
              <th className="tocyn-groups-table-heading-cell tocyn-groups-table-heading-actions">Actions</th>
            </tr>
          </thead>
          <tbody className="tocyn-groups-table-body">
            {groups?.length === 0 ? (
              <tr>
                <td colSpan={4} className="tocyn-groups-table-empty-cell">
                  <ParkEmptyState title="No groups found." description="Create one to start organizing your team." className="tocyn-groups-empty-state" />
                </td>
              </tr>
            ) : (
              groups?.map((group) => (
                <tr key={group.id} className="tocyn-groups-table-row">
                  <td className="tocyn-groups-name">{group.name}</td>
                  <td className="tocyn-groups-description">{group.description || '-'}</td>
                  <td className="tocyn-groups-count">
                    {new Date(group.created_at).toLocaleDateString()}
                  </td>
                  <td className="tocyn-groups-actions">
                    <ParkButton
                      onClick={event => { membersOpener.current = event.currentTarget; setManagingGroupId(group.id); setMembersOpen(true); }}
                      className="tocyn-groups-action tocyn-groups-action-primary"
                    >
                      <FaUsers className="tocyn-groups-member-icon-md" />
                      Members
                    </ParkButton>
                    {isAdmin && (
                      <ParkButton
                        aria-label={`Delete ${group.name}`} onClick={event => { deleteOpener.current = event.currentTarget; deleteSucceeded.current = false; setReturnFocusToHeading(false); setDeleteGroup(group); setDeleteError(''); setDeleteOpen(true); }}
                        className="tocyn-groups-action tocyn-groups-action-danger"
                        title="Delete Group"
                      >
                        <FaTrash className="tocyn-groups-member-remove-icon" />
                      </ParkButton>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
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
      <div className="tocyn-groups-members-dialog">
        <div className="tocyn-groups-dialog-header">
          <div>
            <h2 id={titleId} className="tocyn-groups-members-title">Manage Members: {group.name}</h2>
            <p className="tocyn-groups-members-description">Add or remove agents from this group.</p>
          </div>
          <ParkButton ref={closeButton} disabled={pending} aria-label="Close group members" onClick={close} className="tocyn-groups-members-close">
            <FaXmark size={24} />
          </ParkButton>
        </div>

        <div className="tocyn-groups-dialog-body">
          {operationError && <p role="alert" className="tocyn-groups-members-error">{operationError}</p>}
          {status && <p role="status" className="tocyn-groups-dialog-status">{status}</p>}
          {membersError && <p role="alert" className="tocyn-groups-dialog-alert">Group members could not be loaded. Reopen this page to retry.</p>}
          {removingId && <div role="group" aria-label="Confirm member removal" className="tocyn-groups-removal-confirm">
            <p>Remove {members?.find(member => member.id === removingId)?.full_name || members?.find(member => member.id === removingId)?.email || 'this member'} from the group?</p>
            <ParkButton ref={confirmRemovalButton} disabled={pending} onClick={() => changeMember(removingId, true)}>Remove member</ParkButton>
            <ParkButton disabled={pending} onClick={() => { setRemovingId(null); closeButton.current?.focus(); }}>Cancel removal</ParkButton>
          </div>}
          {/* Current Members Section */}
          <div>
            <h3 className="tocyn-groups-members-heading">Current Members ({members?.length || 0})</h3>
            <div className="tocyn-groups-members-list">
              {isLoadingMembers ? (
                <ParkEmptyState title="Loading members…" className="tocyn-groups-members-loading" aria-busy="true" />
              ) : members?.length === 0 ? (
                <ParkEmptyState title="No members assigned yet." className="tocyn-groups-members-empty" />
              ) : (
                members?.map(member => (
                  <div key={member.id} className="tocyn-groups-member-row">
                    <div className="tocyn-groups-member-identity">
                      <div className="tocyn-groups-member-avatar">
                        {member.full_name?.[0] || member.email[0].toUpperCase()}
                      </div>
                      <div>
                        <div className="tocyn-groups-member-name">
                          {member.full_name || 'Unnamed'}
                          {member.role === 'admin' && <FaShieldHalved className="tocyn-groups-member-admin-icon" />}
                        </div>
                        <div className="tocyn-groups-member-meta">
                          <FaEnvelope className="tocyn-groups-member-icon" />
                          {member.email}
                        </div>
                      </div>
                    </div>
                    {isAdmin && (
                      <ParkButton
                        disabled={pending} aria-label={`Remove ${member.full_name || member.email}`} onClick={() => setRemovingId(member.id)}
                        className="tocyn-groups-member-remove"
                        title="Remove member"
                      >
                        <FaTrash className="tocyn-groups-member-remove-icon" />
                      </ParkButton>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Add New Member Section (Admin Only) */}
          {isAdmin && (
            <div className="tocyn-groups-add-agent">
              <h3 className="tocyn-groups-members-heading">Add Agent</h3>
              <div className="tocyn-groups-agent-search">
                <FaMagnifyingGlass className="tocyn-groups-agent-search-icon" />
                <ParkInput
                  type="text"
                  aria-label="Search agents" disabled={pending} placeholder="Search agents by name or email..."
                  className="tocyn-groups-agent-search-input"
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                />
              </div>

              <div className="tocyn-groups-agent-options">
                {agentsError && <p role="alert" className="tocyn-groups-dialog-alert">Agents could not be loaded. Reopen this page to retry.</p>}
                {agentsLoading && <ParkEmptyState title="Loading agents…" className="tocyn-groups-members-loading" aria-busy="true" />}
                {availableAgents?.map(agent => (
                  <ParkButton
                    key={agent.id}
                    disabled={pending || isLoadingMembers || membersError || agentsLoading || agentsError} aria-label={`Add ${agent.full_name || agent.email}`} onClick={() => changeMember(agent.id, false)}
                    className="tocyn-groups-agent-option"
                  >
                    <div className="tocyn-groups-member-identity">
                      <div className="tocyn-groups-agent-avatar">
                        {agent.full_name?.[0] || agent.email[0].toUpperCase()}
                      </div>
                      <div>
                        <div className="tocyn-groups-agent-name">{agent.full_name || 'Unnamed'}</div>
                        <div className="tocyn-groups-agent-email">{agent.email}</div>
                      </div>
                    </div>
                    <FaUserPlus className="tocyn-groups-agent-add-icon" />
                  </ParkButton>
                ))}
                {availableAgents?.length === 0 && searchTerm && (
                  <ParkEmptyState title="No matching agents found." className="tocyn-groups-members-loading" />
                )}
                {availableAgents?.length === 0 && !searchTerm && (
                  <ParkEmptyState title="All available agents are already in this group." className="tocyn-groups-members-loading" />
                )}
              </div>
            </div>
          )}
        </div>

        <div className="tocyn-groups-members-footer">
          <ParkButton
            disabled={pending} onClick={close}
            className="tocyn-groups-members-done"
          >
            Done
          </ParkButton>
        </div>
      </div>
    </TocynDialog>
  );
};
