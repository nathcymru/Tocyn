import * as React from 'react';
import type { ComposableState, PrimitiveProps } from './types';
import { css } from '../styled-system/css';

const buttonClass = css({ minBlockSize: 'var(--tocyn-target-min)', borderRadius: '0.375rem', border: '1px solid var(--tocyn-color-divider)', paddingInline: '0.875rem', paddingBlock: '0.5rem', color: 'var(--tocyn-color-text)', background: 'var(--tocyn-color-surface-panel)' });
const inputClass = css({ minBlockSize: 'var(--tocyn-target-min)', borderRadius: '0.375rem', border: '1px solid var(--tocyn-color-divider)', paddingInline: '0.75rem', paddingBlock: '0.5rem', color: 'var(--tocyn-color-text)', background: 'var(--tocyn-color-surface)' });
const selectClass = css({
  appearance: 'none', paddingInlineEnd: '2.5rem',
  backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='none' stroke='%23515f6d' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='m1 1 5 5 5-5'/%3E%3C/svg%3E\")",
  backgroundPosition: 'right 0.75rem center', backgroundRepeat: 'no-repeat', backgroundSize: '0.75rem',
});
const choiceClass = css({ inlineSize: '1.125rem', blockSize: '1.125rem', accentColor: 'var(--tocyn-color-focus)', flex: 'none' });

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

export function TocynEmptyState({ title, description, action, className }: { title: string; description?: string; action?: React.ReactNode; className?: string }) {
  return <section aria-label={title} data-tocyn-primitive="empty-state" className={['flex min-h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center', className].filter(Boolean).join(' ')}>
    <h2 className="text-base font-semibold text-slate-900">{title}</h2>
    {description && <p className="max-w-prose text-sm leading-6 text-slate-600">{description}</p>}
    {action}
  </section>;
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
  return <textarea {...props} data-tocyn-primitive="textarea" ref={ref} className={[inputClass, props.className].filter(Boolean).join(' ')} />;
});

export interface TocynSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement>, PrimitiveProps {
  ref?: React.Ref<HTMLSelectElement>;
}
export const TocynSelect = React.forwardRef<HTMLSelectElement, TocynSelectProps>(function TocynSelect(props, ref) {
  return <select {...props} data-tocyn-primitive="select" ref={ref} className={[inputClass, selectClass, props.className].filter(Boolean).join(' ')} />;
});

export interface TocynCheckboxProps extends React.InputHTMLAttributes<HTMLInputElement>, PrimitiveProps { ref?: React.Ref<HTMLInputElement>; }
export const TocynCheckbox = React.forwardRef<HTMLInputElement, TocynCheckboxProps>(function TocynCheckbox(props, ref) {
  return <input {...props} type="checkbox" data-tocyn-primitive="checkbox" ref={ref} className={[choiceClass, props.className].filter(Boolean).join(' ')} />;
});

export interface TocynRadioProps extends React.InputHTMLAttributes<HTMLInputElement>, PrimitiveProps { ref?: React.Ref<HTMLInputElement>; }
export const TocynRadio = React.forwardRef<HTMLInputElement, TocynRadioProps>(function TocynRadio(props, ref) {
  return <input {...props} type="radio" data-tocyn-primitive="radio" ref={ref} className={[choiceClass, props.className].filter(Boolean).join(' ')} />;
});
