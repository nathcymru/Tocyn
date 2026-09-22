import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ParkAlert, ParkButton } from '@luminatick/ui/park';
import { AlertCircle, X } from './icons';
import { useStandardQueueCounts } from '../hooks/useTickets';

type InboxAlert = Readonly<{ count: number; scope: string; kind?: 'calendar-sla' | 'priority-triage' }> | null;
const InboxAlertContext = createContext<(alert: InboxAlert) => void>(() => undefined);
type AlertState = Readonly<{ calendar: InboxAlert; priority: InboxAlert; dismissed: Readonly<{calendar:string|null;priority:string|null}> }>;
const alertKey = (alert: NonNullable<InboxAlert>) => JSON.stringify([alert.kind ?? 'calendar-sla', alert.scope, alert.count]);

/** The fixed-hour signal comes from the authenticated whole-visible-inbox count;
 * a route may separately report its page-local contractual SLA signal. */
export function InboxGlobalAlertProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AlertState>({ calendar: null, priority: null, dismissed: {calendar:null,priority:null} });
  const set = useMemo(() => (next: InboxAlert) => setState(current => {
    const priority = next?.kind === 'priority-triage';
    const field = priority ? 'priority' : 'calendar';
    const updated = next?.count ? next : null;
    const previous = current[field];
    if (previous === updated || (previous && updated && alertKey(previous) === alertKey(updated))) return current;
    return { ...current, [field]: updated, dismissed: {
      ...current.dismissed,[field]: updated && current.dismissed[field] === alertKey(updated) ? current.dismissed[field] : null,
    } };
  }), []);
  const alert = state.priority?.count ? state.priority : state.calendar;
  const visible = alert && state.dismissed[alert.kind === 'priority-triage' ? 'priority' : 'calendar'] !== alertKey(alert) ? alert : null;
  return <InboxAlertContext.Provider value={set}>
    {visible && <ParkAlert.Root role="alert" aria-live="assertive" status="error" variant="surface">
      <AlertCircle aria-hidden="true" />
      <ParkAlert.Content><ParkAlert.Description>{visible.kind === 'priority-triage'
        ? `Action required: ${visible.count} fixed-hour priority countdown${visible.count === 1 ? ' has' : 's have'} expired in ${visible.scope}.`
        : `Action required: ${visible.count} overdue unassigned conversation${visible.count === 1 ? '' : 's'} in ${visible.scope}.`}</ParkAlert.Description></ParkAlert.Content>
      <ParkButton type="button" variant="plain" aria-label="Dismiss inbox alert" onClick={() => setState(current => ({
        ...current,dismissed:{...current.dismissed,[visible.kind === 'priority-triage' ? 'priority' : 'calendar']:alertKey(visible)},
      }))}><X aria-hidden="true" /></ParkButton>
    </ParkAlert.Root>}
    {children}
  </InboxAlertContext.Provider>;
}

export function useInboxGlobalAlert() { return useContext(InboxAlertContext); }

/** Mounted once in the authenticated shell, independent of the active route. */
export function GlobalPriorityAlertBridge() {
  const queue = useStandardQueueCounts();
  const setAlert = useInboxGlobalAlert();
  useEffect(() => {
    const count = !queue.isError && queue.data ? queue.data.triageOverdueCount : 0;
    setAlert({ kind: 'priority-triage', count, scope: 'your accessible inbox' });
  }, [queue.data, queue.isError, setAlert]);
  return null;
}
