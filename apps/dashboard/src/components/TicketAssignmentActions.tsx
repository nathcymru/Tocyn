import { useEffect, useId, useRef, useState } from 'react';
import { TocynDialog } from '@luminatick/ui/dialog';
import { TocynButton, TocynSelect, TocynTextarea } from '@luminatick/ui/primitives';
import { useTicketAssignment } from '../hooks/useTicketAssignment';
import { useAuthStore } from '../store/authStore';

type Props = {
  ticketId: string; ownerId: string | null; fresh: boolean; disabled: boolean;
  agents: { id: string; full_name?: string | null; email: string }[];
  refreshTicket: () => Promise<void>; onBlocked: (blocked: boolean) => void;
};
export function TicketAssignmentActions(props: Props) {
  const user = useAuthStore(state => state.user);
  const generation = useAuthStore(state => state.sessionGeneration);
  return <AssignmentPanel key={JSON.stringify([generation, user?.tenant_id, user?.id, user?.role, props.ticketId])} {...props} />;
}
function AssignmentPanel({ ticketId, ownerId, fresh, disabled, agents, refreshTicket, onBlocked }: Props) {
  const action = useTicketAssignment(ticketId, refreshTicket);
  const admin = useAuthStore(state => state.user?.role === 'admin');
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState('');
  const [reason, setReason] = useState('');
  const titleId = useId(), reasonId = useId(), ownerIdInput = useId();
  const trigger = useRef<HTMLButtonElement>(null), close = useRef<HTMLButtonElement>(null);
  useEffect(() => { onBlocked(action.blocked); return () => onBlocked(false); }, [action.blocked, onBlocked]);
  const reasonValid = Boolean(reason.trim()) && new TextEncoder().encode(reason.trim()).length <= 512;
  const unavailable = disabled || !fresh || action.blocked;
  const status = <>
    {action.message && <p role={['uncertain', 'denied', 'refresh-error'].includes(action.phase) ? 'alert' : 'status'}>{action.message}</p>}
    {action.phase === 'uncertain' && <TocynButton className="rounded border border-slate-300 px-3 py-2 font-medium disabled:opacity-50 aria-disabled:opacity-50" type="button" onClick={action.retry}>Retry same assignment</TocynButton>}
    {['refresh-error', 'denied'].includes(action.phase) && <TocynButton className="rounded border border-slate-300 px-3 py-2 font-medium disabled:opacity-50 aria-disabled:opacity-50" type="button" onClick={action.refresh}>Refresh current ownership</TocynButton>}
  </>;
  return <div className="mt-3 space-y-2 text-sm">
    <TocynButton className="rounded border border-slate-300 px-3 py-2 font-medium disabled:opacity-50 aria-disabled:opacity-50" type="button" disabled={unavailable || ownerId !== null} onClick={action.balance}>Balance assignment</TocynButton>
    {!fresh && <p role="status">Refresh current ticket details before assigning.</p>}
    {admin && <TocynButton className="rounded border border-slate-300 px-3 py-2 font-medium disabled:opacity-50 aria-disabled:opacity-50" ref={trigger} type="button" aria-disabled={unavailable} onClick={() => { if (!unavailable) setOpen(true); }}>Override assignment capacity</TocynButton>}
    {!open && status}
    <TocynDialog open={open} onOpenChange={setOpen} labelledBy={titleId}
      initialFocusEl={() => close.current} finalFocusEl={() => trigger.current}>
      <div className="w-full max-w-lg rounded-xl border bg-white p-6 text-slate-900 shadow-xl">
        <h2 id={titleId} className="text-xl font-bold">Override assignment capacity</h2>
        <TocynButton className="rounded border border-slate-300 px-3 py-2 font-medium disabled:opacity-50 aria-disabled:opacity-50" ref={close} type="button" onClick={() => setOpen(false)}>Close assignment override</TocynButton>
        <p className="my-3">Administrators can explicitly override availability or the assignment ceiling. Current access rules still apply. The reason is recorded in the internal audit.</p>
        <p>Current owner: {ownerId === null ? 'Unassigned' : agents.find(agent => agent.id === ownerId)?.full_name || 'Assigned operator'}</p>
        <label htmlFor={ownerIdInput}>Assign to operator</label>
        <TocynSelect className="mb-3 block w-full rounded border border-slate-300 px-3 py-2" id={ownerIdInput} value={selected} disabled={action.blocked} onChange={event => setSelected(event.target.value)}>
          <option value="">Choose an operator</option>
          {agents.map(agent => <option key={agent.id} value={agent.id}>{agent.full_name || agent.email}</option>)}
        </TocynSelect>
        <label htmlFor={reasonId}>Override reason</label>
        <TocynTextarea className="block w-full rounded border border-slate-300 px-3 py-2" id={reasonId} value={reason} disabled={action.blocked} onChange={event => setReason(event.target.value)} />
        <p>A reason is required. Keep it brief.</p>
        {reason.trim() && !reasonValid && <p role="alert">The reason is too long. Shorten it before assigning.</p>}
        <TocynButton className="rounded border border-slate-300 px-3 py-2 font-medium disabled:opacity-50 aria-disabled:opacity-50" type="button" disabled={!fresh || disabled || action.blocked || !selected || !reasonValid}
          onClick={() => action.override(selected, ownerId, reason)}>Assign with audited override</TocynButton>
        {status}
      </div>
    </TocynDialog>
  </div>;
}
