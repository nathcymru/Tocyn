import type { AriaAttributes, CSSProperties, ComponentPropsWithoutRef, ReactNode, Ref, SyntheticEvent } from 'react';

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

export interface InteractionHandlers<TEvent = SyntheticEvent> {
  /** Called first for pointer/interaction start. Calling preventDefault cancels native handling. */
  onInteractionStart?: (event: TEvent) => void;
  /** Called after a non-cancelled interaction completes. */
  onInteractionEnd?: (event: TEvent) => void;
}

export interface ExtendablePrimitiveProps<TElement extends HTMLElement, TState extends string = string>
  extends PrimitiveProps, ComposableState<TState>, InteractionHandlers {
  ref?: Ref<TElement>;
  children?: ReactNode;
}

export type AriaProps = AriaAttributes;
