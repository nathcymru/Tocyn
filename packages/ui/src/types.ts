import type { AriaAttributes, CSSProperties, ComponentPropsWithoutRef, ReactNode, Ref } from 'react';

/** Public contract shared by every named Tocyn primitive. */
export interface PrimitiveProps {
  /** Stable styling hook; values must be safe static-CSS tokens/classes. */
  className?: string;
  style?: CSSProperties;
  /** Optional test/automation hook that does not replace an accessible name. */
  'data-testid'?: string;
}

export type NativeButtonProps = ComponentPropsWithoutRef<'button'>;
export type NativeInputProps = ComponentPropsWithoutRef<'input'>;
export type NativePanelProps = ComponentPropsWithoutRef<'section'>;

export interface ComposableState<TState extends string = string> {
  state?: TState;
  disabled?: boolean;
  loading?: boolean;
}

/** Compose native handlers; a consumer can prevent the internal behavior explicitly. */
export function composeEventHandlers<TEvent extends { defaultPrevented: boolean }>(
  consumer: ((event: TEvent) => void) | undefined,
  internal: (event: TEvent) => void,
): (event: TEvent) => void {
  return event => {
    consumer?.(event);
    if (!event.defaultPrevented) internal(event);
  };
}

export interface ExtendablePrimitiveProps<TElement extends HTMLElement, TState extends string = string>
  extends PrimitiveProps, ComposableState<TState> {
  ref?: Ref<TElement>;
  children?: ReactNode;
}

export type AriaProps = AriaAttributes;
