import { ParkButton, ParkTicketDetail } from '@luminatick/ui/park';
import { TocynDialog } from '@luminatick/ui/dialog';
import type { TicketUtilityAction } from '@luminatick/shared';
import React from 'react';

type TicketActionBarProps = Readonly<{
  reference: string;
  actions: readonly TicketUtilityAction[];
  loading: boolean;
  error: boolean;
  retry: () => void;
}>;

/** The only dashboard slot for the finite server-issued utility-action manifest. */
export function TicketActionBar({ reference, actions, loading, error, retry }: TicketActionBarProps) {
  const detailStyles = ParkTicketDetail();
  const [dialogAction, setDialogAction] = React.useState<TicketUtilityAction | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const opener = React.useRef<HTMLButtonElement>(null);
  const close = React.useRef<HTMLButtonElement>(null);
  const titleId = React.useId();
  const descriptionId = React.useId();
  const copyGeneration = React.useRef(0);
  React.useEffect(() => {
    setNotice(null);
    setDialogAction(null);
    return () => { copyGeneration.current++; };
  }, [reference]);
  const action = (id: TicketUtilityAction['id']) => actions.find(candidate => candidate.id === id);
  const copy = action('copy-ticket-reference');
  const more = actions.filter(candidate => candidate.slot === 'more');

  const copyReference = async () => {
    if (!copy?.enabled) return;
    const generation = ++copyGeneration.current;
    const failed = 'The ticket reference could not be copied. Select it in More ticket actions instead.';
    if (!navigator.clipboard?.writeText) { setNotice(failed); return; }
    try {
      await navigator.clipboard.writeText(reference);
      if (generation === copyGeneration.current) setNotice('Ticket reference copied.');
    } catch {
      if (generation === copyGeneration.current) setNotice(failed);
    }
  };

  const renderAction = (current: TicketUtilityAction) => {
    const reasonId = `ticket-action-${current.id}-reason`;
    const disabled = !current.enabled;
    const description = disabled ? <p id={reasonId} className={detailStyles.actionReason}>{current.reason}</p> : null;
    if (current.kind === 'application-command') return <div key={current.id} className={detailStyles.actionItem}>
      <ParkButton type="button" disabled={disabled} aria-describedby={disabled ? reasonId : undefined} onClick={() => void copyReference()}>{current.label}</ParkButton>
      {description}
    </div>;
    if (current.kind === 'internal-dialog') return <div key={current.id} className={detailStyles.actionItem}>
      <ParkButton type="button" ref={opener} disabled={disabled} aria-describedby={disabled ? reasonId : undefined} onClick={() => setDialogAction(current)}>{current.label}</ParkButton>
      {description}
    </div>;
    return <div key={current.id} className={detailStyles.actionItem}>
      {disabled ? <ParkButton type="button" disabled aria-describedby={reasonId}>{current.label}</ParkButton>
        : <a href={current.href} target="_blank" rel="noopener noreferrer" className={detailStyles.actionLink}>{current.label}</a>}
      {description}
    </div>;
  };

  return <section aria-label="Ticket actions" className={detailStyles.actions}>
    {loading && <p role="status" className={detailStyles.actionStatus}>Loading ticket actions…</p>}
    {error && <p role="alert" className={detailStyles.actionStatus}>Ticket actions are unavailable. <ParkButton type="button" onClick={retry}>Retry ticket actions</ParkButton></p>}
    {!loading && !error && copy && renderAction(copy)}
    {!loading && !error && more.length > 0 && <details>
      <summary className={detailStyles.actionSummary}>More ticket actions</summary>
      <div className={detailStyles.actionMore}>{more.map(renderAction)}</div>
    </details>}
    {notice && <p role="status" className={detailStyles.actionNotice}>{notice}</p>}
    <TocynDialog open={dialogAction?.kind === 'internal-dialog'} onOpenChange={open => { if (!open) setDialogAction(null); }}
      labelledBy={titleId} describedBy={descriptionId} initialFocusEl={() => close.current} finalFocusEl={() => opener.current}
      >
      <h2 id={titleId} className="tocyn-ticket-action-dialog-title">Ticket reference</h2>
      <p id={descriptionId} className="tocyn-ticket-action-dialog-copy">Use this reference when you need to identify this ticket in a governed support workflow.</p>
      <p className="tocyn-ticket-action-reference">{reference}</p>
      <ParkButton type="button" ref={close} onClick={() => setDialogAction(null)}>Close ticket reference</ParkButton>
    </TocynDialog>
  </section>;
}
