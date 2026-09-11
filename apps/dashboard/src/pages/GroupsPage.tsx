import { TocynDialog } from '@luminatick/ui/dialog';
import { TocynButton, TocynInput, TocynTextarea } from '@luminatick/ui/primitives';
import React, { useState } from 'react';
import {
  Users,
  Plus,
  Trash2,
  UserPlus,
  X,
  Shield,
  Mail,
  Search
} from 'lucide-react';
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

  if (isLoadingGroups) return <div className="p-8 text-center text-slate-500">Loading groups...</div>;

  const managingGroup = groups?.find(g => g.id === managingGroupId);

  return (
    <div className="max-w-6xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 ref={pageHeading} tabIndex={-1} className="text-2xl font-bold text-slate-900">Group Management</h1>
          <p className="text-slate-500 mt-1">Organize agents into teams to handle specific ticket categories.</p>
        </div>
        {isAdmin && (
          <TocynButton
            ref={createOpener} onClick={() => { setCreateError(''); setIsCreating(true); }}
            className="bg-brand-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-brand-700 transition-colors shadow-sm flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Create Group
          </TocynButton>
        )}
      </div>

      {groupStatus && <p role="status" className="mb-4">{groupStatus}</p>}
      <TocynDialog open={isCreating} busy={creating} labelledBy={createTitle} initialFocusEl={() => groupNameInput.current} finalFocusEl={() => createOpener.current} onOpenChange={next => { if (!next) closeCreate(); }}>
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm mb-8 animate-in fade-in slide-in-from-top-4">
          <div className="flex justify-between items-center mb-4">
            <h2 id={createTitle} className="text-lg font-bold text-slate-900">New Support Group</h2>
            <TocynButton aria-label="Close group editor" disabled={creating} onClick={closeCreate} className="text-slate-400 hover:text-slate-600">
              <X size={20} />
            </TocynButton>
          </div>
          <form onSubmit={handleCreateGroup} aria-labelledby={createTitle}>
            {createError && <p role="alert" className="mb-4 text-red-700">{createError}</p>}
            <fieldset disabled={creating} className="space-y-4">
            <div>
              <label htmlFor={`${createTitle}-name`} className="block text-sm font-semibold text-slate-700 mb-1">Group Name</label>
              <TocynInput
                type="text"
                required
                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none"
                placeholder="e.g., Technical Support"
                id={`${createTitle}-name`} ref={groupNameInput} value={newGroupName}
                onChange={e => setNewGroupName(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor={`${createTitle}-description`} className="block text-sm font-semibold text-slate-700 mb-1">Description (Optional)</label>
              <TocynTextarea
                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none"
                placeholder="Briefly describe what this group handles..."
                rows={2}
                id={`${createTitle}-description`} value={newGroupDescription}
                onChange={e => setNewGroupDescription(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-3">
              <TocynButton
                type="button"
                onClick={closeCreate}
                className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancel
              </TocynButton>
              <TocynButton
                type="submit"
                disabled={creating}
                className="bg-brand-600 text-white px-6 py-2 rounded-lg font-bold hover:bg-brand-700 transition-colors disabled:opacity-50"
              >
                {creating ? 'Creating...' : 'Create Group'}
              </TocynButton>
            </div>
            </fieldset>
          </form>
        </div>
      </TocynDialog>
      <TocynDialog open={deleteOpen} busy={deleting} labelledBy={deleteTitle} initialFocusEl={() => deleteCancel.current}
        finalFocusEl={() => deleteSucceeded.current ? pageHeading.current : deleteOpener.current}
        onOpenChange={next => { if (!next) closeDelete(); }}>
        <div className="bg-white rounded-xl p-6 space-y-4">
          <h2 id={deleteTitle} className="text-lg font-bold">Delete group: {deleteGroup?.name}</h2>
          <p>Delete this group? It must not have any active tickets. This action cannot be undone.</p>
          {deleteError && <p role="alert" className="text-red-700">{deleteError}</p>}
          <div className="flex gap-3 justify-end">
            <TocynButton ref={deleteCancel} disabled={deleting} onClick={closeDelete}>Cancel</TocynButton>
            <TocynButton disabled={deleting} onClick={handleDeleteGroup}>{deleting ? 'Deleting...' : 'Delete group'}</TocynButton>
          </div>
        </div>
      </TocynDialog>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-slate-50 text-slate-500 text-xs font-semibold uppercase tracking-wider">
              <th className="px-6 py-4">Group Name</th>
              <th className="px-6 py-4">Description</th>
              <th className="px-6 py-4">Created</th>
              <th className="px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {groups?.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-6 py-12 text-center text-slate-500 italic">
                  No groups found. Create one to start organizing your team.
                </td>
              </tr>
            ) : (
              groups?.map((group) => (
                <tr key={group.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4 font-bold text-slate-900">{group.name}</td>
                  <td className="px-6 py-4 text-sm text-slate-500">{group.description || '-'}</td>
                  <td className="px-6 py-4 text-sm text-slate-500">
                    {new Date(group.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 text-right space-x-2">
                    <TocynButton
                      onClick={event => { membersOpener.current = event.currentTarget; setManagingGroupId(group.id); setMembersOpen(true); }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-brand-600 hover:bg-brand-50 rounded-lg transition-colors border border-brand-200"
                    >
                      <Users className="w-3.5 h-3.5" />
                      Members
                    </TocynButton>
                    {isAdmin && (
                      <TocynButton
                        aria-label={`Delete ${group.name}`} onClick={event => { deleteOpener.current = event.currentTarget; deleteSucceeded.current = false; setReturnFocusToHeading(false); setDeleteGroup(group); setDeleteError(''); setDeleteOpen(true); }}
                        className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Delete Group"
                      >
                        <Trash2 className="w-4 h-4" />
                      </TocynButton>
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
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div>
            <h2 id={titleId} className="text-xl font-bold text-slate-900">Manage Members: {group.name}</h2>
            <p className="text-sm text-slate-500">Add or remove agents from this group.</p>
          </div>
          <TocynButton ref={closeButton} disabled={pending} aria-label="Close group members" onClick={close} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-all">
            <X size={24} />
          </TocynButton>
        </div>

        <div className="flex-1 overflow-auto p-6 space-y-6">
          {operationError && <p role="alert" className="text-red-700">{operationError}</p>}
          {status && <p role="status">{status}</p>}
          {membersError && <p role="alert">Group members could not be loaded. Reopen this page to retry.</p>}
          {removingId && <div role="group" aria-label="Confirm member removal" className="rounded-lg border p-4 space-y-3">
            <p>Remove {members?.find(member => member.id === removingId)?.full_name || members?.find(member => member.id === removingId)?.email || 'this member'} from the group?</p>
            <TocynButton ref={confirmRemovalButton} disabled={pending} onClick={() => changeMember(removingId, true)}>Remove member</TocynButton>
            <TocynButton disabled={pending} onClick={() => { setRemovingId(null); closeButton.current?.focus(); }}>Cancel removal</TocynButton>
          </div>}
          {/* Current Members Section */}
          <div>
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Current Members ({members?.length || 0})</h3>
            <div className="space-y-2">
              {isLoadingMembers ? (
                <div className="text-center py-4 text-slate-400 italic">Loading members...</div>
              ) : members?.length === 0 ? (
                <div className="bg-slate-50 border border-dashed border-slate-200 rounded-xl p-6 text-center text-slate-500 italic">
                  No members assigned yet.
                </div>
              ) : (
                members?.map(member => (
                  <div key={member.id} className="flex items-center justify-between p-3 bg-white border border-slate-100 rounded-xl hover:border-brand-200 transition-colors group">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-brand-50 flex items-center justify-center text-brand-700 font-bold border border-brand-100">
                        {member.full_name?.[0] || member.email[0].toUpperCase()}
                      </div>
                      <div>
                        <div className="font-bold text-slate-900 flex items-center gap-2">
                          {member.full_name || 'Unnamed'}
                          {member.role === 'admin' && <Shield className="w-3 h-3 text-purple-500" />}
                        </div>
                        <div className="text-xs text-slate-500 flex items-center gap-1">
                          <Mail className="w-3 h-3" />
                          {member.email}
                        </div>
                      </div>
                    </div>
                    {isAdmin && (
                      <TocynButton
                        disabled={pending} aria-label={`Remove ${member.full_name || member.email}`} onClick={() => setRemovingId(member.id)}
                        className="p-2 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                        title="Remove member"
                      >
                        <Trash2 className="w-4 h-4" />
                      </TocynButton>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Add New Member Section (Admin Only) */}
          {isAdmin && (
            <div className="pt-6 border-t border-slate-100">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Add Agent</h3>
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <TocynInput
                  type="text"
                  aria-label="Search agents" disabled={pending} placeholder="Search agents by name or email..."
                  className="w-full pl-10 pr-4 py-2 bg-slate-100 border-none rounded-lg text-sm focus:ring-2 focus:ring-brand-500 transition-all focus:bg-white border-transparent"
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                />
              </div>

              <div className="max-h-60 overflow-auto space-y-1 pr-1">
                {agentsError && <p role="alert">Agents could not be loaded. Reopen this page to retry.</p>}
                {agentsLoading && <p role="status">Loading agents...</p>}
                {availableAgents?.map(agent => (
                  <TocynButton
                    key={agent.id}
                    disabled={pending || isLoadingMembers || membersError || agentsLoading || agentsError} aria-label={`Add ${agent.full_name || agent.email}`} onClick={() => changeMember(agent.id, false)}
                    className="w-full flex items-center justify-between p-2 hover:bg-slate-50 rounded-lg transition-colors group text-left"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 text-xs font-bold">
                        {agent.full_name?.[0] || agent.email[0].toUpperCase()}
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-slate-800">{agent.full_name || 'Unnamed'}</div>
                        <div className="text-[11px] text-slate-500">{agent.email}</div>
                      </div>
                    </div>
                    <UserPlus className="w-4 h-4 text-slate-300 group-hover:text-brand-600 transition-colors" />
                  </TocynButton>
                ))}
                {availableAgents?.length === 0 && searchTerm && (
                  <div className="text-center py-4 text-slate-400 text-sm italic">No matching agents found.</div>
                )}
                {availableAgents?.length === 0 && !searchTerm && (
                  <div className="text-center py-4 text-slate-400 text-sm italic">All available agents are already in this group.</div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end">
          <TocynButton
            disabled={pending} onClick={close}
            className="px-6 py-2 bg-white border border-slate-200 text-slate-700 font-bold rounded-lg hover:bg-slate-50 transition-all shadow-sm active:scale-95"
          >
            Done
          </TocynButton>
        </div>
      </div>
    </TocynDialog>
  );
};
