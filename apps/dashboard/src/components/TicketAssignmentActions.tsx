import { useEffect, useId, useRef, useState } from 'react';
import { TocynDialog } from '@luminatick/ui/dialog';
import { ParkButton, ParkTextarea } from '@luminatick/ui/park';
import { css } from '@luminatick/ui/styled-system/css';
import { useTicketAssignment } from '../hooks/useTicketAssignment';
import { useAuthStore } from '../store/authStore';
import { DashboardSelect } from './DashboardSelect';

const assignmentStyles = {
  panel: css({ display: 'grid', gap: '0.5rem', marginTop: '0.75rem' }),
  dialog: css({ width: '100%', maxWidth: '32rem', display: 'grid', gap: '0.75rem', padding: '1.5rem' }),
  note: css({ margin: '0', color: 'text.muted' }),
};

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
    {action.phase === 'uncertain' && <ParkButton type="button" onClick={action.retry}>Retry same assignment</ParkButton>}
    {['refresh-error', 'denied'].includes(action.phase) && <ParkButton type="button" onClick={action.refresh}>Refresh current ownership</ParkButton>}
  </>;
  return <div className={assignmentStyles.panel}>
    <ParkButton type="button" disabled={unavailable || ownerId !== null} onClick={action.balance}>Balance assignment</ParkButton>
    {!fresh && <p role="status">Refresh current ticket details before assigning.</p>}
    {admin && <ParkButton ref={trigger} type="button" aria-disabled={unavailable} onClick={() => { if (!unavailable) setOpen(true); }}>Override assignment capacity</ParkButton>}
    {!open && status}
    <TocynDialog open={open} onOpenChange={setOpen} labelledBy={titleId}
      initialFocusEl={() => close.current} finalFocusEl={() => trigger.current}>
      <div className={assignmentStyles.dialog}>
        <h2 id={titleId}>Override assignment capacity</h2>
        <ParkButton ref={close} type="button" onClick={() => setOpen(false)}>Close assignment override</ParkButton>
        <p className={assignmentStyles.note}>Administrators can explicitly override availability or the assignment ceiling. Current access rules still apply. The reason is recorded in the internal audit.</p>
        <p>Current owner: {ownerId === null ? 'Unassigned' : agents.find(agent => agent.id === ownerId)?.full_name || 'Assigned operator'}</p>
        <DashboardSelect id={ownerIdInput} label="Assign to operator" value={selected} disabled={action.blocked} onValueChange={setSelected} options={[{ value: '', label: 'Choose an operator' }, ...agents.map(agent => ({ value: agent.id, label: agent.full_name || agent.email }))]} />
        <label htmlFor={reasonId}>Override reason</label>
        <ParkTextarea id={reasonId} value={reason} disabled={action.blocked} onChange={event => setReason(event.target.value)} />
        <p>A reason is required. Keep it brief.</p>
        {reason.trim() && !reasonValid && <p role="alert">The reason is too long. Shorten it before assigning.</p>}
        <ParkButton type="button" disabled={!fresh || disabled || action.blocked || !selected || !reasonValid}
          onClick={() => action.override(selected, ownerId, reason)}>Assign with audited override</ParkButton>
        {status}
      </div>
    </TocynDialog>
  </div>;
}
