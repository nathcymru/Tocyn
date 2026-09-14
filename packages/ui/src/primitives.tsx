import * as React from 'react';
import type { ComposableState, PrimitiveProps } from './types';
import { css } from '../styled-system/css';

const buttonClass = css({ minBlockSize: 'var(--tocyn-target-min)', borderRadius: '0.375rem', border: '1px solid var(--tocyn-color-divider)', paddingInline: '0.875rem', paddingBlock: '0.5rem', color: 'var(--tocyn-color-text)', background: 'var(--tocyn-color-surface-panel)' });
const inputClass = css({ minBlockSize: 'var(--tocyn-target-min)', borderRadius: '0.375rem', border: '1px solid var(--tocyn-color-divider)', paddingInline: '0.75rem', paddingBlock: '0.5rem', color: 'var(--tocyn-color-text)', background: 'var(--tocyn-color-surface)' });

export interface TocynButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, PrimitiveProps, ComposableState<'idle' | 'loading' | 'disabled'> {
  ref?: React.Ref<HTMLButtonElement>;
}
export const TocynButton = React.forwardRef<HTMLButtonElement, TocynButtonProps>(function TocynButton(
  { children, className, disabled, loading, state, ...props }, ref,
) {
  return <button {...props} ref={ref} data-tocyn-primitive="button" disabled={disabled || loading || state === 'loading' || state === 'disabled'} className={[buttonClass, className].filter(Boolean).join(' ')} aria-busy={loading || state === 'loading' || props['aria-busy']}>
    {children}
  </button>;
});

export interface TocynInputProps extends React.InputHTMLAttributes<HTMLInputElement>, PrimitiveProps, ComposableState<'idle' | 'error' | 'success'> {
  ref?: React.Ref<HTMLInputElement>;
}
export const TocynInput = React.forwardRef<HTMLInputElement, TocynInputProps>(function TocynInput(
  { className, disabled, loading, state, ...props }, ref,
) {
  return <input {...props} data-tocyn-primitive="input" ref={ref} disabled={disabled || loading} className={[inputClass, className].filter(Boolean).join(' ')} aria-busy={loading || props['aria-busy']} data-state={state} />;
});

export interface TocynPanelProps extends React.HTMLAttributes<HTMLElement>, PrimitiveProps, ComposableState<'open' | 'closed'> {
  ref?: React.Ref<HTMLElement>;
}
export const TocynPanel = React.forwardRef<HTMLElement, TocynPanelProps>(function TocynPanel(
  { className, children, state, loading: _loading, disabled: _disabled, ...props }, ref,
) {
  return <section {...props} data-tocyn-primitive="panel" ref={ref} className={className} data-state={state}>{children}</section>;
});

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
  return <textarea {...props} data-tocyn-primitive="textarea" ref={ref} className={[inputClass, props.className].filter(Boolean).join(' ')} />;
});

export interface TocynSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement>, PrimitiveProps {
  ref?: React.Ref<HTMLSelectElement>;
}
export const TocynSelect = React.forwardRef<HTMLSelectElement, TocynSelectProps>(function TocynSelect(props, ref) {
  return <select {...props} data-tocyn-primitive="select" ref={ref} className={[inputClass, props.className].filter(Boolean).join(' ')} />;
});
