import * as React from 'react';
import { ParkButton } from './park';
import { Dialog } from '@ark-ui/react/dialog';

export interface TocynDialogProps extends React.HTMLAttributes<HTMLDivElement> {
  ref?: React.Ref<HTMLDivElement>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy?: boolean;
  labelledBy: string;
  describedBy?: string;
  initialFocusEl?: () => HTMLElement | null;
  finalFocusEl?: () => HTMLElement | null;
}

/** Modal focus/escape behavior is shared; the caller owns state and form content. */
export const TocynDialog = React.forwardRef<HTMLDivElement, TocynDialogProps>(function TocynDialog({ open, onOpenChange, busy, labelledBy, describedBy, initialFocusEl, finalFocusEl, children, ...props }, ref) {
  return <Dialog.Root ids={props.id ? { content: props.id } : undefined} open={open} onOpenChange={details => { if (!busy) onOpenChange(details.open); }}
    initialFocusEl={initialFocusEl} finalFocusEl={finalFocusEl} closeOnEscape={!busy}
    closeOnInteractOutside={false} lazyMount unmountOnExit>
    <Dialog.Backdrop data-tocyn-dialog-backdrop="" />
    <Dialog.Positioner data-tocyn-dialog-positioner="">
      <Dialog.Content {...props} ref={ref} aria-labelledby={labelledBy} aria-describedby={describedBy ?? props['aria-describedby']}>
        {children}
      </Dialog.Content>
    </Dialog.Positioner>
  </Dialog.Root>;
});

export interface TocynConfirmDialogProps extends Omit<TocynDialogProps, 'labelledBy' | 'describedBy' | 'initialFocusEl' | 'children'> {
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  error?: string;
  onConfirm: () => void;
  confirmClassName?: string;
  cancelClassName?: string;
}

/** The caller owns admission, mutation and recovery; cancellation receives initial focus. */
export const TocynConfirmDialog = React.forwardRef<HTMLDivElement, TocynConfirmDialogProps>(function TocynConfirmDialog({title, description, confirmLabel, cancelLabel = 'Cancel', error, onConfirm, confirmClassName, cancelClassName, ...dialog}, ref) {
  const titleId = React.useId();
  const descriptionId = React.useId();
  const cancel = React.useRef<HTMLButtonElement>(null);
  return <TocynDialog {...dialog} ref={ref} labelledBy={titleId} describedBy={descriptionId} initialFocusEl={() => cancel.current}>
    <div data-tocyn-confirm-body="">
      <h2 id={titleId}>{title}</h2>
      <p id={descriptionId}>{description}</p>
      {error && <p role="alert">{error}</p>}
      <div data-tocyn-confirm-actions="">
        <ParkButton type="button" ref={cancel} disabled={dialog.busy} onClick={() => dialog.onOpenChange(false)} className={cancelClassName}>{cancelLabel}</ParkButton>
        <ParkButton type="button" disabled={dialog.busy} onClick={onConfirm} className={confirmClassName}>{confirmLabel}</ParkButton>
      </div>
    </div>
  </TocynDialog>;
});
