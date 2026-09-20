import * as React from 'react';
import type { ComposableState, PrimitiveProps } from './types';
import { ParkButton, ParkInput, ParkTextarea, ParkEmptyState } from './park';

export interface TocynButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, PrimitiveProps, ComposableState<'idle' | 'loading' | 'disabled'> {
  ref?: React.Ref<HTMLButtonElement>;
}
export const TocynButton = React.forwardRef<HTMLButtonElement, TocynButtonProps>(function TocynButton(
  { children, className, disabled, loading, state, ...props }, ref,
) {
  return <ParkButton {...props} ref={ref} data-tocyn-primitive="button" disabled={disabled || loading || state === 'loading' || state === 'disabled'} loading={loading || state === 'loading'} className={className} aria-busy={loading || state === 'loading' || props['aria-busy']}>{children}</ParkButton>;
});

export interface TocynInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'>, PrimitiveProps, ComposableState<'idle' | 'error' | 'success'> {
  ref?: React.Ref<HTMLInputElement>;
}
export const TocynInput = React.forwardRef<HTMLInputElement, TocynInputProps>(function TocynInput(
  { className, disabled, loading, state, ...props }, ref,
) {
  return <ParkInput {...props} data-tocyn-primitive="input" ref={ref} disabled={disabled || loading} className={className} aria-busy={loading || props['aria-busy']} data-state={state} />;
});

export interface TocynPanelProps extends React.HTMLAttributes<HTMLElement>, PrimitiveProps, ComposableState<'open' | 'closed'> {
  ref?: React.Ref<HTMLElement>;
}
export const TocynPanel = React.forwardRef<HTMLElement, TocynPanelProps>(function TocynPanel(
  { className, children, state, loading: _loading, disabled: _disabled, ...props }, ref,
) {
  return <section {...props} data-tocyn-primitive="panel" ref={ref} className={className} data-state={state}>{children}</section>;
});

/** A stable, labelled surface for no-data and recoverable empty views. */
export function TocynEmptyState({ title, description, action, className }: { title: string; description?: string; action?: React.ReactNode; className?: string }) {
  return <ParkEmptyState title={title} description={description} action={action} className={className} data-tocyn-primitive="empty-state" />;
}

export interface WorkspaceRegionProps extends React.HTMLAttributes<HTMLElement> {
  ref?: React.Ref<HTMLElement>;
  label: string;
  children?: React.ReactNode;
}
export const WorkspaceRegion = React.forwardRef<HTMLElement, WorkspaceRegionProps>(function WorkspaceRegion(
  { label, children, ...props }, ref,
) {
  return <section {...props} ref={ref} aria-label={label}>{children}</section>;
});

/** Native form controls preserve platform keyboard, validation and form ownership. */
export interface TocynTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement>, PrimitiveProps {
  ref?: React.Ref<HTMLTextAreaElement>;
}
export const TocynTextarea = React.forwardRef<HTMLTextAreaElement, TocynTextareaProps>(function TocynTextarea(props, ref) {
  return <ParkTextarea {...props} data-tocyn-primitive="textarea" ref={ref} />;
});

export interface TocynSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement>, PrimitiveProps {
  ref?: React.Ref<HTMLSelectElement>;
}
export const TocynSelect = React.forwardRef<HTMLSelectElement, TocynSelectProps>(function TocynSelect(props, ref) {
  return <select {...props} data-tocyn-primitive="select" ref={ref} />;
});
