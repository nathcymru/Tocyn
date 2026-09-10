import * as React from 'react';
import type { ExtendablePrimitiveProps, NativeButtonProps, NativeInputProps, NativePanelProps } from './types';

export type TocynButtonProps = Omit<NativeButtonProps, 'disabled'> & ExtendablePrimitiveProps<HTMLButtonElement, 'idle' | 'loading' | 'disabled'>;
export const TocynButton = React.forwardRef<HTMLButtonElement, TocynButtonProps>(function TocynButton(
  { children, className, disabled, loading, state, onInteractionStart, onInteractionEnd, onClick, ...props }, ref,
) {
  return <button {...props} ref={ref} disabled={disabled || loading || state === 'disabled'} className={className} aria-busy={loading || undefined}
    onMouseDown={event => { onInteractionStart?.(event); }}
    onMouseUp={event => { onInteractionEnd?.(event); }}
    onClick={event => { onClick?.(event); }}>
    {children}
  </button>;
});

export type TocynInputProps = NativeInputProps & ExtendablePrimitiveProps<HTMLInputElement, 'idle' | 'error' | 'success'>;
export const TocynInput = React.forwardRef<HTMLInputElement, TocynInputProps>(function TocynInput(
  { className, disabled, loading, state, ...props }, ref,
) {
  return <input {...props} ref={ref} disabled={disabled || loading} className={className} aria-busy={loading || undefined} data-state={state} />;
});

export type TocynPanelProps = NativePanelProps & ExtendablePrimitiveProps<HTMLElement, 'open' | 'closed'>;
export const TocynPanel = React.forwardRef<HTMLElement, TocynPanelProps>(function TocynPanel(
  { className, children, state, ...props }, ref,
) {
  return <section {...props} ref={ref} className={className} data-state={state}>{children}</section>;
});

export interface WorkspaceRegionProps extends React.HTMLAttributes<HTMLElement> {
  label: string;
  children?: React.ReactNode;
}
export const WorkspaceRegion = React.forwardRef<HTMLElement, WorkspaceRegionProps>(function WorkspaceRegion(
  { label, children, ...props }, ref,
) {
  return <section {...props} ref={ref} aria-label={label}>{children}</section>;
});
