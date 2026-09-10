import * as React from 'react';
import type { ComposableState, InteractionHandlers, PrimitiveProps } from './types';

export interface TocynButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, PrimitiveProps, ComposableState<'idle' | 'loading' | 'disabled'>, InteractionHandlers<React.PointerEvent<HTMLButtonElement>> {
  ref?: React.Ref<HTMLButtonElement>;
}
export const TocynButton = React.forwardRef<HTMLButtonElement, TocynButtonProps>(function TocynButton(
  { children, className, disabled, loading, state, onInteractionStart, onInteractionEnd, onPointerDown, onPointerUp, onClick, ...props }, ref,
) {
  return <button {...props} ref={ref} disabled={disabled || loading || state === 'disabled'} className={className} aria-busy={loading || undefined}
    onPointerDown={event => { onInteractionStart?.(event); if (!event.defaultPrevented) onPointerDown?.(event); }}
    onPointerUp={event => { if (!event.defaultPrevented) { onInteractionEnd?.(event); if (!event.defaultPrevented) onPointerUp?.(event); } }}
    onClick={event => { if (!event.defaultPrevented) onClick?.(event); }}>
    {children}
  </button>;
});

export interface TocynInputProps extends React.InputHTMLAttributes<HTMLInputElement>, PrimitiveProps, ComposableState<'idle' | 'error' | 'success'>, InteractionHandlers<React.SyntheticEvent<HTMLInputElement>> {
  ref?: React.Ref<HTMLInputElement>;
}
export const TocynInput = React.forwardRef<HTMLInputElement, TocynInputProps>(function TocynInput(
  { className, disabled, loading, state, onInteractionStart, onInteractionEnd, onPointerDown, onPointerUp, ...props }, ref,
) {
  return <input {...props} ref={ref} disabled={disabled || loading} className={className} aria-busy={loading || undefined} data-state={state}
    onPointerDown={event => { onInteractionStart?.(event); if (!event.defaultPrevented) onPointerDown?.(event); }}
    onPointerUp={event => { if (!event.defaultPrevented) { onInteractionEnd?.(event); if (!event.defaultPrevented) onPointerUp?.(event); } }} />;
});

export interface TocynPanelProps extends React.HTMLAttributes<HTMLElement>, PrimitiveProps, ComposableState<'open' | 'closed'>, InteractionHandlers<React.SyntheticEvent<HTMLElement>> {
  ref?: React.Ref<HTMLElement>;
}
export const TocynPanel = React.forwardRef<HTMLElement, TocynPanelProps>(function TocynPanel(
  { className, children, state, loading: _loading, disabled: _disabled, onInteractionStart, onInteractionEnd, onPointerDown, onPointerUp, ...props }, ref,
) {
  return <section {...props} ref={ref} className={className} data-state={state}
    onPointerDown={event => { onInteractionStart?.(event); if (!event.defaultPrevented) onPointerDown?.(event); }}
    onPointerUp={event => { if (!event.defaultPrevented) { onInteractionEnd?.(event); if (!event.defaultPrevented) onPointerUp?.(event); } }}>{children}</section>;
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
