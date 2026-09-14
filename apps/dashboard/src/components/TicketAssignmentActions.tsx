import { useEffect, useId, useRef, useState } from 'react';
import { TocynDialog } from '@luminatick/ui/dialog';
import { ParkButton, ParkSelect, ParkTextarea } from '@luminatick/ui/park';
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
    {action.phase === 'uncertain' && <ParkButton className="tocyn-assignment-action" type="button" onClick={action.retry}>Retry same assignment</ParkButton>}
    {['refresh-error', 'denied'].includes(action.phase) && <ParkButton className="tocyn-assignment-action" type="button" onClick={action.refresh}>Refresh current ownership</ParkButton>}
  </>;
  return <div className="tocyn-assignment-panel">
    <ParkButton className="tocyn-assignment-action" type="button" disabled={unavailable || ownerId !== null} onClick={action.balance}>Balance assignment</ParkButton>
    {!fresh && <p role="status">Refresh current ticket details before assigning.</p>}
    {admin && <ParkButton className="tocyn-assignment-action" ref={trigger} type="button" aria-disabled={unavailable} onClick={() => { if (!unavailable) setOpen(true); }}>Override assignment capacity</ParkButton>}
    {!open && status}
    <TocynDialog open={open} onOpenChange={setOpen} labelledBy={titleId}
      initialFocusEl={() => close.current} finalFocusEl={() => trigger.current}>
      <div className="tocyn-assignment-dialog">
        <h2 id={titleId} className="tocyn-assignment-dialog-title">Override assignment capacity</h2>
        <ParkButton className="tocyn-assignment-action" ref={close} type="button" onClick={() => setOpen(false)}>Close assignment override</ParkButton>
        <p className="tocyn-assignment-dialog-copy">Administrators can explicitly override availability or the assignment ceiling. Current access rules still apply. The reason is recorded in the internal audit.</p>
        <p>Current owner: {ownerId === null ? 'Unassigned' : agents.find(agent => agent.id === ownerId)?.full_name || 'Assigned operator'}</p>
        <label htmlFor={ownerIdInput}>Assign to operator</label>
        <ParkSelect className="tocyn-assignment-select" id={ownerIdInput} value={selected} disabled={action.blocked} onChange={event => setSelected(event.target.value)}>
          <option value="">Choose an operator</option>
          {agents.map(agent => <option key={agent.id} value={agent.id}>{agent.full_name || agent.email}</option>)}
        </ParkSelect>
        <label htmlFor={reasonId}>Override reason</label>
        <ParkTextarea className="tocyn-assignment-reason" id={reasonId} value={reason} disabled={action.blocked} onChange={event => setReason(event.target.value)} />
        <p>A reason is required. Keep it brief.</p>
        {reason.trim() && !reasonValid && <p role="alert">The reason is too long. Shorten it before assigning.</p>}
        <ParkButton className="tocyn-assignment-action" type="button" disabled={!fresh || disabled || action.blocked || !selected || !reasonValid}
          onClick={() => action.override(selected, ownerId, reason)}>Assign with audited override</ParkButton>
        {status}
      </div>
    </TocynDialog>
  </div>;
}
