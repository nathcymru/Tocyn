import * as React from 'react';
import { Dialog } from '@ark-ui/react/dialog';

export interface TocynDialogProps extends React.HTMLAttributes<HTMLDivElement> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy?: boolean;
  labelledBy: string;
  initialFocusEl?: () => HTMLElement | null;
  finalFocusEl?: () => HTMLElement | null;
}

/** Modal focus/escape behavior is shared; the caller owns state and form content. */
export function TocynDialog({ open, onOpenChange, busy, labelledBy, initialFocusEl, finalFocusEl, children, ...props }: TocynDialogProps) {
  return <Dialog.Root open={open} onOpenChange={details => { if (!busy) onOpenChange(details.open); }}
    initialFocusEl={initialFocusEl} finalFocusEl={finalFocusEl} closeOnEscape={!busy}
    closeOnInteractOutside={false} lazyMount unmountOnExit>
    <Dialog.Backdrop data-tocyn-dialog-backdrop="" />
    <Dialog.Positioner data-tocyn-dialog-positioner="">
      <Dialog.Content {...props} aria-labelledby={labelledBy} aria-describedby={undefined}>
        {children}
      </Dialog.Content>
    </Dialog.Positioner>
  </Dialog.Root>;
}
