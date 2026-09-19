import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { ParkButton } from '@luminatick/ui/park';
import { css } from '@luminatick/ui/styled-system/css';
import { AlertCircle, X } from './icons';

type InboxAlert = Readonly<{ count: number; scope: string }> | null;
const InboxAlertContext = createContext<(alert: InboxAlert) => void>(() => undefined);

/** A shell-level, route-owned alert. It takes up normal document flow so it never
 * covers the splitter, and accepts only the currently verified inbox projection. */
export function InboxGlobalAlertProvider({ children }: { children: ReactNode }) {
  const [alert, setAlert] = useState<InboxAlert>(null);
  const set = useMemo(() => (next: InboxAlert) => setAlert(next?.count ? next : null), []);
  return <InboxAlertContext.Provider value={set}>
    {alert && <section role="alert" aria-live="assertive" className={css({ display: 'flex', minH: '10', alignItems: 'center', justifyContent: 'center', gap: '2', bg: 'critical', color: 'white', px: '4', py: '2', fontSize: 'sm', fontWeight: 'bold' })}>
      <AlertCircle aria-hidden="true" />
      <span>Action required: {alert.count} overdue unassigned conversation{alert.count === 1 ? '' : 's'} in {alert.scope}.</span>
      <ParkButton type="button" variant="plain" aria-label="Dismiss inbox alert" onClick={() => setAlert(null)} className={css({ color: 'white', _hover: { bg: 'rgba(255,255,255,0.16)' } })}><X aria-hidden="true" /></ParkButton>
    </section>}
    {children}
  </InboxAlertContext.Provider>;
}

export function useInboxGlobalAlert() { return useContext(InboxAlertContext); }
