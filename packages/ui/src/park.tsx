import * as React from 'react';
import { Avatar, Field, PinInput } from '@ark-ui/react';
import { Select as ArkSelect } from '@ark-ui/react/select';
import { ScrollArea as ArkScrollArea } from '@ark-ui/react/scroll-area';
import { Splitter as ArkSplitter } from '@ark-ui/react/splitter';
import { Tabs as ArkTabs } from '@ark-ui/react/tabs';
import { Menu as ArkMenu } from '@ark-ui/react/menu';

/** Park-compatible shared primitives. Styles are emitted by the package CSS; these
 * wrappers deliberately keep the existing Tocyn data attributes and DOM contracts. */
export const ParkButton = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  function ParkButton({ className, ...props }, ref) {
    return <button {...props} ref={ref} data-tocyn-primitive="button" data-park="button" className={['tocyn-button', className].filter(Boolean).join(' ')}>{props.children}</button>;
  },
);

export const ParkInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function ParkInput({ className, ...props }, ref) {
    return <input {...props} ref={ref} data-tocyn-primitive="input" data-park="input" className={['tocyn-input', className].filter(Boolean).join(' ')} />;
  },
);

export const ParkTextarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function ParkTextarea({ className, ...props }, ref) {
    return <textarea {...props} ref={ref} data-tocyn-primitive="textarea" data-park="textarea" className={['tocyn-textarea', className].filter(Boolean).join(' ')} />;
  },
);

/** Native compatibility entry point. Compound anatomy is attached below. */
const ParkSelectNative = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function ParkSelect({ className, ...props }, ref) {
    return <select {...props} ref={ref} data-tocyn-primitive="select" data-park="select" className={['tocyn-select', className].filter(Boolean).join(' ')} />;
  },
);

const parkPart = (name: string, className?: string) => ['tocyn-park-part', `tocyn-park-${name}`, className].filter(Boolean).join(' ');

export const ParkSelectRoot = (props: React.ComponentProps<typeof ArkSelect.Root>) => <ArkSelect.Root {...props} data-park="select-root" className={parkPart('select-root', props.className)} />;
export const ParkSelectLabel = (props: React.ComponentProps<typeof ArkSelect.Label>) => <ArkSelect.Label {...props} data-park="select-label" className={parkPart('select-label', props.className)} />;
export const ParkSelectControl = (props: React.ComponentProps<typeof ArkSelect.Control>) => <ArkSelect.Control {...props} data-park="select-control" className={parkPart('select-control', props.className)} />;
export const ParkSelectTrigger = (props: React.ComponentProps<typeof ArkSelect.Trigger>) => <ArkSelect.Trigger {...props} data-park="select-trigger" className={parkPart('select-trigger', props.className)} />;
export const ParkSelectValueText = (props: React.ComponentProps<typeof ArkSelect.ValueText>) => <ArkSelect.ValueText {...props} data-park="select-value" className={parkPart('select-value', props.className)} />;
export const ParkSelectIndicator = (props: React.ComponentProps<typeof ArkSelect.Indicator>) => <ArkSelect.Indicator {...props} data-park="select-indicator" className={parkPart('select-indicator', props.className)} />;
export const ParkSelectPositioner = (props: React.ComponentProps<typeof ArkSelect.Positioner>) => <ArkSelect.Positioner {...props} data-park="select-positioner" className={parkPart('select-positioner', props.className)} />;
export const ParkSelectContent = (props: React.ComponentProps<typeof ArkSelect.Content>) => <ArkSelect.Content {...props} data-park="select-content" className={parkPart('select-content', props.className)} />;
export const ParkSelectList = (props: React.ComponentProps<typeof ArkSelect.List>) => <ArkSelect.List {...props} data-park="select-list" className={parkPart('select-list', props.className)} />;
export const ParkSelectItem = (props: React.ComponentProps<typeof ArkSelect.Item>) => <ArkSelect.Item {...props} data-park="select-item" className={parkPart('select-item', props.className)} />;
export const ParkSelectItemText = (props: React.ComponentProps<typeof ArkSelect.ItemText>) => <ArkSelect.ItemText {...props} data-park="select-item-text" className={parkPart('select-item-text', props.className)} />;
export const ParkSelectItemIndicator = (props: React.ComponentProps<typeof ArkSelect.ItemIndicator>) => <ArkSelect.ItemIndicator {...props} data-park="select-item-indicator" className={parkPart('select-item-indicator', props.className)} />;
export const ParkSelectHiddenSelect = (props: React.ComponentProps<typeof ArkSelect.HiddenSelect>) => <ArkSelect.HiddenSelect {...props} data-park="select-hidden" />;

/** Ark Select anatomy with a native-compatible call signature for existing consumers. */
export const ParkSelect = Object.assign(ParkSelectNative, {
  Root: ParkSelectRoot,
  Label: ParkSelectLabel,
  Control: ParkSelectControl,
  Trigger: ParkSelectTrigger,
  ValueText: ParkSelectValueText,
  Indicator: ParkSelectIndicator,
  Positioner: ParkSelectPositioner,
  Content: ParkSelectContent,
  List: ParkSelectList,
  Item: ParkSelectItem,
  ItemText: ParkSelectItemText,
  ItemIndicator: ParkSelectItemIndicator,
  HiddenSelect: ParkSelectHiddenSelect,
});

export const ParkTabsRoot = (props: React.ComponentProps<typeof ArkTabs.Root>) => <ArkTabs.Root {...props} data-park="tabs-root" className={parkPart('tabs-root', props.className)} />;
export const ParkTabsList = (props: React.ComponentProps<typeof ArkTabs.List>) => <ArkTabs.List {...props} data-park="tabs-list" className={parkPart('tabs-list', props.className)} />;
export const ParkTabsTrigger = (props: React.ComponentProps<typeof ArkTabs.Trigger>) => <ArkTabs.Trigger {...props} data-park="tabs-trigger" className={parkPart('tabs-trigger', props.className)} />;
export const ParkTabsContent = (props: React.ComponentProps<typeof ArkTabs.Content>) => <ArkTabs.Content {...props} data-park="tabs-content" className={parkPart('tabs-content', props.className)} />;
export const ParkTabsIndicator = (props: React.ComponentProps<typeof ArkTabs.Indicator>) => <ArkTabs.Indicator {...props} data-park="tabs-indicator" className={parkPart('tabs-indicator', props.className)} />;
export const ParkTabs = { Root: ParkTabsRoot, List: ParkTabsList, Trigger: ParkTabsTrigger, Content: ParkTabsContent, Indicator: ParkTabsIndicator };

export const ParkScrollAreaRoot = (props: React.ComponentProps<typeof ArkScrollArea.Root>) => <ArkScrollArea.Root {...props} data-park="scroll-area-root" className={parkPart('scroll-area-root', props.className)} />;
export const ParkScrollAreaViewport = (props: React.ComponentProps<typeof ArkScrollArea.Viewport>) => <ArkScrollArea.Viewport {...props} data-park="scroll-area-viewport" className={parkPart('scroll-area-viewport', props.className)} />;
export const ParkScrollAreaContent = (props: React.ComponentProps<typeof ArkScrollArea.Content>) => <ArkScrollArea.Content {...props} data-park="scroll-area-content" className={parkPart('scroll-area-content', props.className)} />;
export const ParkScrollAreaScrollbar = (props: React.ComponentProps<typeof ArkScrollArea.Scrollbar>) => <ArkScrollArea.Scrollbar {...props} data-park="scroll-area-scrollbar" className={parkPart('scroll-area-scrollbar', props.className)} />;
export const ParkScrollAreaThumb = (props: React.ComponentProps<typeof ArkScrollArea.Thumb>) => <ArkScrollArea.Thumb {...props} data-park="scroll-area-thumb" className={parkPart('scroll-area-thumb', props.className)} />;
export const ParkScrollArea = { Root: ParkScrollAreaRoot, Viewport: ParkScrollAreaViewport, Content: ParkScrollAreaContent, Scrollbar: ParkScrollAreaScrollbar, Thumb: ParkScrollAreaThumb };

export const ParkSplitterRoot = (props: React.ComponentProps<typeof ArkSplitter.Root>) => <ArkSplitter.Root {...props} data-park="splitter-root" className={parkPart('splitter-root', props.className)} />;
export const ParkSplitterPanel = (props: React.ComponentProps<typeof ArkSplitter.Panel>) => <ArkSplitter.Panel {...props} data-park="splitter-panel" className={parkPart('splitter-panel', props.className)} />;
export const ParkSplitterResizeTrigger = (props: React.ComponentProps<typeof ArkSplitter.ResizeTrigger>) => <ArkSplitter.ResizeTrigger {...props} data-park="splitter-resize-trigger" className={parkPart('splitter-resize-trigger', props.className)} />;
export const ParkSplitter = { Root: ParkSplitterRoot, Panel: ParkSplitterPanel, ResizeTrigger: ParkSplitterResizeTrigger };

export interface ParkFieldProps extends React.HTMLAttributes<HTMLDivElement> {
  label?: React.ReactNode;
  description?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  children: React.ReactNode;
}

/** A labelled Ark Field with stable IDs supplied by the state machine. */
export function ParkField({ label, description, error, required, children, className, ...props }: ParkFieldProps) {
  return <Field.Root {...props} required={required} data-park="field" className={['tocyn-field', className].filter(Boolean).join(' ')}>
    {label !== undefined && <Field.Label>{label}{required && <Field.RequiredIndicator> *</Field.RequiredIndicator>}</Field.Label>}
    {children}
    {error !== undefined ? <Field.ErrorText>{error}</Field.ErrorText> : description !== undefined && <Field.HelperText>{description}</Field.HelperText>}
  </Field.Root>;
}

export const ParkAvatar = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<typeof Avatar.Root>>(
  function ParkAvatar({ className, children, ...props }, ref) {
    return <Avatar.Root {...props} ref={ref} data-park="avatar" className={['tocyn-avatar', className].filter(Boolean).join(' ')}>{children}</Avatar.Root>;
  },
);

export const ParkAvatarImage = Avatar.Image;
export const ParkAvatarFallback = Avatar.Fallback;

export const ParkMenuRoot = (props: React.ComponentProps<typeof ArkMenu.Root>) => <ArkMenu.Root {...props} data-park="menu-root" />;
export const ParkMenuTrigger = (props: React.ComponentProps<typeof ArkMenu.Trigger>) => <ArkMenu.Trigger {...props} data-park="menu-trigger" className={parkPart('menu-trigger', props.className)} />;
export const ParkMenuPositioner = (props: React.ComponentProps<typeof ArkMenu.Positioner>) => <ArkMenu.Positioner {...props} data-park="menu-positioner" className={parkPart('menu-positioner', props.className)} />;
export const ParkMenuContent = (props: React.ComponentProps<typeof ArkMenu.Content>) => <ArkMenu.Content {...props} data-park="menu-content" className={parkPart('menu-content', props.className)} />;
export const ParkMenuItem = (props: React.ComponentProps<typeof ArkMenu.Item>) => <ArkMenu.Item {...props} data-park="menu-item" className={parkPart('menu-item', props.className)} />;
export const ParkMenuSeparator = (props: React.ComponentProps<typeof ArkMenu.Separator>) => <ArkMenu.Separator {...props} data-park="menu-separator" className={parkPart('menu-separator', props.className)} />;
export const ParkMenu = { Root: ParkMenuRoot, Trigger: ParkMenuTrigger, Positioner: ParkMenuPositioner, Content: ParkMenuContent, Item: ParkMenuItem, Separator: ParkMenuSeparator };

export interface ParkPinInputProps extends React.ComponentPropsWithoutRef<typeof PinInput.Root> {
  label?: React.ReactNode;
  readOnly?: boolean;
}

/** Ark PinInput anatomy with a compact Park-compatible default control layout. */
export const ParkPinInput = React.forwardRef<HTMLDivElement, ParkPinInputProps>(function ParkPinInput({ label, children, className, readOnly, ...props }, ref) {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    rootRef.current?.querySelectorAll<HTMLInputElement>('[data-part="input"]').forEach(input => {
      if (readOnly) input.setAttribute('readonly', ''); else input.removeAttribute('readonly');
    });
  }, [readOnly]);
  const setRef = React.useCallback((node: HTMLDivElement | null) => {
    rootRef.current = node;
    if (typeof ref === 'function') ref(node); else if (ref) ref.current = node;
  }, [ref]);
  return <PinInput.Root {...props} ref={setRef} data-park="pin-input" className={['tocyn-pin-input', className].filter(Boolean).join(' ')}>
    {label !== undefined && <PinInput.Label>{label}</PinInput.Label>}
    <PinInput.Control>{React.Children.map(children, child => React.isValidElement(child) ? React.cloneElement(child, { readOnly }) : child)}</PinInput.Control>
    <PinInput.HiddenInput />
  </PinInput.Root>;
});

export const ParkPinInputSlot = PinInput.Input;

export interface ParkEmptyStateProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6 | false;
}

export function ParkEmptyState({ title, description, action, headingLevel = 2, className, ...props }: ParkEmptyStateProps) {
  const Heading = headingLevel === false ? 'p' : `h${headingLevel}` as keyof JSX.IntrinsicElements;
  return <section {...props} aria-label={typeof title === 'string' ? title : undefined} data-tocyn-primitive="empty-state" data-park="empty-state" className={['tocyn-empty-state', className].filter(Boolean).join(' ')}>
    <Heading>{title}</Heading>
    {description !== undefined && <p>{description}</p>}
    {action}
  </section>;
}
