import { TocynButton } from '@luminatick/ui/primitives';
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

const buttonClass = 'rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-60';

/** The only dashboard slot for the finite server-issued utility-action manifest. */
export function TicketActionBar({ reference, actions, loading, error, retry }: TicketActionBarProps) {
  const [dialogAction, setDialogAction] = React.useState<TicketUtilityAction | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const opener = React.useRef<HTMLButtonElement>(null);
  const close = React.useRef<HTMLButtonElement>(null);
  const titleId = React.useId();
  const descriptionId = React.useId();
  const action = (id: TicketUtilityAction['id']) => actions.find(candidate => candidate.id === id);
  const copy = action('copy-ticket-reference');
  const more = actions.filter(candidate => candidate.slot === 'more');

  const copyReference = async () => {
    if (!copy?.enabled || !navigator.clipboard?.writeText) return;
    try { await navigator.clipboard.writeText(reference); setNotice('Ticket reference copied.'); }
    catch { setNotice('The ticket reference could not be copied. Select it in More ticket actions instead.'); }
  };

  const renderAction = (current: TicketUtilityAction) => {
    const reasonId = `ticket-action-${current.id}-reason`;
    const disabled = !current.enabled;
    const description = disabled ? <p id={reasonId} className="text-xs text-slate-600">{current.reason}</p> : null;
    if (current.kind === 'application-command') return <div key={current.id} className="space-y-1">
      <TocynButton type="button" disabled={disabled} aria-describedby={disabled ? reasonId : undefined} onClick={() => void copyReference()} className={buttonClass}>{current.label}</TocynButton>
      {description}
    </div>;
    if (current.kind === 'internal-dialog') return <div key={current.id} className="space-y-1">
      <TocynButton type="button" ref={opener} disabled={disabled} aria-describedby={disabled ? reasonId : undefined} onClick={() => setDialogAction(current)} className={buttonClass}>{current.label}</TocynButton>
      {description}
    </div>;
    return <div key={current.id} className="space-y-1">
      {disabled ? <TocynButton type="button" disabled aria-describedby={reasonId} className={buttonClass}>{current.label}</TocynButton>
        : <a href={current.href} target="_blank" rel="noopener noreferrer" className={`${buttonClass} inline-block`}>{current.label}</a>}
      {description}
    </div>;
  };

  return <section aria-label="Ticket actions" className="flex flex-wrap items-start gap-2">
    {loading && <p role="status" className="text-sm text-slate-700">Loading ticket actions…</p>}
    {error && <p role="alert" className="text-sm text-slate-700">Ticket actions are unavailable. <TocynButton type="button" onClick={retry} className="underline">Retry ticket actions</TocynButton></p>}
    {!loading && !error && copy && renderAction(copy)}
    {!loading && !error && more.length > 0 && <details>
      <summary className={`${buttonClass} cursor-pointer`}>More ticket actions</summary>
      <div className="mt-2 flex flex-col items-start gap-3 rounded border border-slate-200 bg-white p-3">{more.map(renderAction)}</div>
    </details>}
    {notice && <p role="status" className="basis-full text-sm text-slate-700">{notice}</p>}
    <TocynDialog open={dialogAction?.kind === 'internal-dialog'} onOpenChange={open => { if (!open) setDialogAction(null); }}
      labelledBy={titleId} describedBy={descriptionId} initialFocusEl={() => close.current} finalFocusEl={() => opener.current}
      className="max-w-md rounded bg-white p-6 shadow-xl">
      <h2 id={titleId} className="text-lg font-semibold text-slate-900">Ticket reference</h2>
      <p id={descriptionId} className="mt-2 text-slate-700">Use this reference when you need to identify this ticket in a governed support workflow.</p>
      <p className="mt-4 rounded bg-slate-100 p-3 font-mono text-slate-900">{reference}</p>
      <TocynButton type="button" ref={close} onClick={() => setDialogAction(null)} className={`${buttonClass} mt-4`}>Close ticket reference</TocynButton>
    </TocynDialog>
  </section>;
}
