import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { ParkAlert, ParkButton } from '@luminatick/ui/park';
import { AlertCircle, X } from './icons';

type InboxAlert = Readonly<{ count: number; scope: string; kind?: 'calendar-sla' | 'priority-triage' }> | null;
const InboxAlertContext = createContext<(alert: InboxAlert) => void>(() => undefined);
type AlertState = Readonly<{ alert: InboxAlert; dismissed: string | null }>;
const alertKey = (alert: NonNullable<InboxAlert>) => JSON.stringify([alert.kind ?? 'calendar-sla', alert.scope, alert.count]);

/** A shell-level, route-owned alert. It takes up normal document flow so it never
 * covers the splitter, and accepts only the currently verified inbox projection. */
export function InboxGlobalAlertProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AlertState>({ alert: null, dismissed: null });
  const set = useMemo(() => (next: InboxAlert) => setState(current => {
    if (!next?.count) return current.alert === null && current.dismissed === null ? current : { alert: null, dismissed: null };
    const key = alertKey(next);
    if (current.dismissed === key || (current.alert && alertKey(current.alert) === key)) return current;
    return { alert: next, dismissed: null };
  }), []);
  const alert = state.alert;
  return <InboxAlertContext.Provider value={set}>
    {alert && <ParkAlert.Root role="alert" aria-live="assertive" status="error" variant="surface">
      <AlertCircle aria-hidden="true" />
      <ParkAlert.Content><ParkAlert.Description>{alert.kind === 'priority-triage'
        ? `Action required: ${alert.count} fixed-hour priority countdown${alert.count === 1 ? ' has' : 's have'} expired in ${alert.scope}.`
        : `Action required: ${alert.count} overdue unassigned conversation${alert.count === 1 ? '' : 's'} in ${alert.scope}.`}</ParkAlert.Description></ParkAlert.Content>
      <ParkButton type="button" variant="plain" aria-label="Dismiss inbox alert" onClick={() => setState(current => current.alert
        ? { alert: null, dismissed: alertKey(current.alert) } : current)}><X aria-hidden="true" /></ParkButton>
    </ParkAlert.Root>}
    {children}
  </InboxAlertContext.Provider>;
}

export function useInboxGlobalAlert() { return useContext(InboxAlertContext); }
