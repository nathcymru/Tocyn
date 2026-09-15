import * as React from 'react';
import { Avatar, Field, PinInput, createListCollection } from '@ark-ui/react';
import { Select as ArkSelect } from '@ark-ui/react/select';
import { ScrollArea as ArkScrollArea } from '@ark-ui/react/scroll-area';
import { Splitter as ArkSplitter } from '@ark-ui/react/splitter';
import { Tabs as ArkTabs } from '@ark-ui/react/tabs';
import { Menu as ArkMenu } from '@ark-ui/react/menu';
import { IconChevronDown, IconCheck } from './icons';
import { visuallyHidden } from './styles/generated/patterns';
import { button as buttonRecipe, input as inputRecipe, select as selectRecipe, textarea as textareaRecipe, tabs as tabsRecipe, splitter as splitterRecipe, scrollArea as scrollAreaRecipe, avatar as avatarRecipe, emptyState as emptyStateRecipe, shell as shellRecipe, card as cardRecipe, page as pageRecipe } from './styles/generated/recipes';

const selectStyles = selectRecipe();
const buttonClass = buttonRecipe();
const inputClass = inputRecipe();
const textareaClass = textareaRecipe();
const cardStyles = cardRecipe();
const pageStyles = (kind: 'dashboard' | 'knowledge' | 'inbox' | 'settings' | 'account') => pageRecipe({ kind });
const tabsStyles = tabsRecipe();
const splitterStyles = splitterRecipe();
const scrollAreaStyles = scrollAreaRecipe();
const avatarStyles = avatarRecipe();
const emptyStateStyles = emptyStateRecipe();

/** Shared Park recipes. Stateless controls intentionally use their semantic HTML
 * element (as Park does); stateful controls below use Ark state machines. Every
 * visible control carries the same Park scope/part contract and package recipe. */
export type ParkButtonVariant = 'solid' | 'subtle' | 'surface' | 'outline' | 'plain' | 'ghost' | 'destructive';
export type ParkButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
export interface ParkButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { variant?: ParkButtonVariant; size?: ParkButtonSize; }
export const ParkButton = React.forwardRef<HTMLButtonElement, ParkButtonProps>(
  function ParkButton({ className, ...props }, ref) {
    const { variant, size, ...buttonProps } = props;
    const recipeClass = buttonRecipe(variant || size ? { variant, size } : undefined);
    return <button {...buttonProps} ref={ref} data-tocyn-primitive="button" data-park="button" data-scope="button" data-part="root" className={[recipeClass || buttonClass, 'tocyn-button', 'tocyn-park-button', className].filter(Boolean).join(' ')}>{buttonProps.children}</button>;
  },
);

export const ParkInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function ParkInput({ className, ...props }, ref) {
    return <input {...props} ref={ref} data-tocyn-primitive="input" data-park="input" data-scope="input" data-part="root" className={[inputClass, 'tocyn-input', 'tocyn-park-input', className].filter(Boolean).join(' ')} />;
  },
);

export const ParkTextarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function ParkTextarea({ className, ...props }, ref) {
    return <textarea {...props} ref={ref} data-tocyn-primitive="textarea" data-park="textarea" data-scope="textarea" data-part="root" className={[textareaClass, 'tocyn-textarea', 'tocyn-park-textarea', className].filter(Boolean).join(' ')} />;
  },
);

/** Native compatibility entry point. Compound anatomy is attached below. */
type ParkSelectCompatProps = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value' | 'defaultValue'> & {
  value?: string;
  defaultValue?: string;
  onChange?: React.ChangeEventHandler<HTMLSelectElement>;
};

const parkPart = (name: string, className?: string) => ['tocyn-park-part', `tocyn-park-${name}`, className].filter(Boolean).join(' ');

export const ParkSelectRoot = (props: React.ComponentProps<typeof ArkSelect.Root>) => <ArkSelect.Root {...props} data-park="select-root" className={[selectStyles.root, parkPart('select-root', props.className)].filter(Boolean).join(' ')} />;
export const ParkSelectLabel = (props: React.ComponentProps<typeof ArkSelect.Label>) => <ArkSelect.Label {...props} data-park="select-label" className={[selectStyles.label, parkPart('select-label', props.className)].filter(Boolean).join(' ')} />;
export const ParkSelectControl = (props: React.ComponentProps<typeof ArkSelect.Control>) => <ArkSelect.Control {...props} data-park="select-control" className={[selectStyles.control, parkPart('select-control', props.className)].filter(Boolean).join(' ')} />;
export const ParkSelectTrigger = (props: React.ComponentProps<typeof ArkSelect.Trigger>) => <ArkSelect.Trigger {...props} data-park="select-trigger" className={[selectStyles.trigger, parkPart('select-trigger', props.className)].filter(Boolean).join(' ')} />;
export const ParkSelectValueText = (props: React.ComponentProps<typeof ArkSelect.ValueText>) => <ArkSelect.ValueText {...props} data-park="select-value" className={[selectStyles.valueText, parkPart('select-value', props.className)].filter(Boolean).join(' ')} />;
export const ParkSelectIndicatorGroup = (props: React.HTMLAttributes<HTMLSpanElement>) => <span {...props} data-park="select-indicator-group" className={[selectStyles.indicatorGroup, parkPart('select-indicator-group', props.className)].filter(Boolean).join(' ')} />;
export const ParkSelectIndicator = ({ children, ...props }: React.ComponentProps<typeof ArkSelect.Indicator>) => <ArkSelect.Indicator {...props} data-park="select-indicator" className={[selectStyles.indicator, parkPart('select-indicator', props.className)].filter(Boolean).join(' ')}>{children ?? <IconChevronDown size={16} aria-hidden="true" />}</ArkSelect.Indicator>;
export const ParkSelectPositioner = (props: React.ComponentProps<typeof ArkSelect.Positioner>) => <ArkSelect.Positioner {...props} data-park="select-positioner" className={[selectStyles.positioner, parkPart('select-positioner', props.className)].filter(Boolean).join(' ')} />;
export const ParkSelectContent = (props: React.ComponentProps<typeof ArkSelect.Content>) => <ArkSelect.Content {...props} data-park="select-content" className={[selectStyles.content, parkPart('select-content', props.className)].filter(Boolean).join(' ')} />;
export const ParkSelectList = (props: React.ComponentProps<typeof ArkSelect.List>) => <ArkSelect.List {...props} data-park="select-list" className={[selectStyles.list, parkPart('select-list', props.className)].filter(Boolean).join(' ')} />;
export const ParkSelectItem = (props: React.ComponentProps<typeof ArkSelect.Item>) => <ArkSelect.Item {...props} data-park="select-item" className={[selectStyles.item, parkPart('select-item', props.className)].filter(Boolean).join(' ')} />;
export const ParkSelectItemText = (props: React.ComponentProps<typeof ArkSelect.ItemText>) => <ArkSelect.ItemText {...props} data-park="select-item-text" className={[selectStyles.itemText, parkPart('select-item-text', props.className)].filter(Boolean).join(' ')} />;
export const ParkSelectItemIndicator = ({ children, ...props }: React.ComponentProps<typeof ArkSelect.ItemIndicator>) => <ArkSelect.ItemIndicator {...props} data-park="select-item-indicator" className={[selectStyles.itemIndicator, parkPart('select-item-indicator', props.className)].filter(Boolean).join(' ')}>{children ?? <IconCheck size={16} aria-hidden="true" />}</ArkSelect.ItemIndicator>;
export const ParkSelectHiddenSelect = (props: React.ComponentProps<typeof ArkSelect.HiddenSelect>) => <ArkSelect.HiddenSelect {...props} data-park="select-hidden" />;

/** Ark Select anatomy with a native-compatible call signature for existing consumers. */
const ParkSelectCompat = React.forwardRef<any, ParkSelectCompatProps>(function ParkSelectCompat({ className, children, value, defaultValue, onChange, name, disabled, id, 'aria-label': ariaLabel, 'aria-describedby': ariaDescribedBy }, ref) {
  const options = React.Children.toArray(children).flatMap(child => React.isValidElement(child) && child.type === 'option' ? [{ label: String(child.props.children), value: String(child.props.value ?? '') }] : []);
  const collection = React.useMemo(() => createListCollection({ items: options }), [options.map(option => `${option.value}:${option.label}`).join('|')]);
  const initial = value ?? defaultValue ?? options[0]?.value ?? '';
  return <ArkSelect.Root collection={collection} value={[initial]} disabled={disabled} onValueChange={({ value: next }) => {
    const target = { value: next[0] ?? '' } as HTMLSelectElement;
    onChange?.({ target, currentTarget: target } as React.ChangeEvent<HTMLSelectElement>);
  }} data-tocyn-primitive="select" data-park="select-root" className={[selectStyles.root, 'tocyn-select-root', className].filter(Boolean).join(' ')}>
    <ArkSelect.Control className={selectStyles.control}><ArkSelect.Trigger ref={ref} id={id} aria-label={ariaLabel} aria-describedby={ariaDescribedBy} aria-disabled={disabled} className={selectStyles.trigger}><ArkSelect.ValueText className={selectStyles.valueText} /></ArkSelect.Trigger><ParkSelectIndicatorGroup><ArkSelect.Indicator aria-hidden="true" className={selectStyles.indicator}><IconChevronDown size={16} aria-hidden="true" /></ArkSelect.Indicator></ParkSelectIndicatorGroup></ArkSelect.Control>
    <ArkSelect.HiddenSelect name={name} />
    <ArkSelect.Positioner className={selectStyles.positioner}><ArkSelect.Content className={selectStyles.content}><ArkSelect.List className={selectStyles.list}>{options.map(option => <ArkSelect.Item key={option.value} item={option} className={selectStyles.item}><ArkSelect.ItemText className={selectStyles.itemText}>{option.label}</ArkSelect.ItemText><ArkSelect.ItemIndicator className={selectStyles.itemIndicator}><IconCheck size={16} aria-hidden="true" /></ArkSelect.ItemIndicator></ArkSelect.Item>)}</ArkSelect.List></ArkSelect.Content></ArkSelect.Positioner>
  </ArkSelect.Root>;
});

export const ParkSelect = Object.assign(ParkSelectCompat, {
  Root: ParkSelectRoot,
  Label: ParkSelectLabel,
  Control: ParkSelectControl,
  Trigger: ParkSelectTrigger,
  ValueText: ParkSelectValueText,
  IndicatorGroup: ParkSelectIndicatorGroup,
  Indicator: ParkSelectIndicator,
  Positioner: ParkSelectPositioner,
  Content: ParkSelectContent,
  List: ParkSelectList,
  Item: ParkSelectItem,
  ItemText: ParkSelectItemText,
  ItemIndicator: ParkSelectItemIndicator,
  HiddenSelect: ParkSelectHiddenSelect,
});

export const ParkTabsRoot = (props: React.ComponentProps<typeof ArkTabs.Root>) => <ArkTabs.Root {...props} data-park="tabs-root" className={[tabsStyles.root, parkPart('tabs-root', props.className)].join(' ')} />;
export const ParkTabsList = (props: React.ComponentProps<typeof ArkTabs.List>) => <ArkTabs.List {...props} data-park="tabs-list" className={[tabsStyles.list, parkPart('tabs-list', props.className)].join(' ')} />;
export const ParkTabsTrigger = (props: React.ComponentProps<typeof ArkTabs.Trigger>) => <ArkTabs.Trigger {...props} data-park="tabs-trigger" className={[tabsStyles.trigger, parkPart('tabs-trigger', props.className)].join(' ')} />;
export const ParkTabsContent = (props: React.ComponentProps<typeof ArkTabs.Content>) => <ArkTabs.Content {...props} data-park="tabs-content" className={[tabsStyles.content, parkPart('tabs-content', props.className)].join(' ')} />;
export const ParkTabsIndicator = (props: React.ComponentProps<typeof ArkTabs.Indicator>) => <ArkTabs.Indicator {...props} data-park="tabs-indicator" className={[tabsStyles.indicator, parkPart('tabs-indicator', props.className)].join(' ')} />;
export const ParkTabs = { Root: ParkTabsRoot, List: ParkTabsList, Trigger: ParkTabsTrigger, Content: ParkTabsContent, Indicator: ParkTabsIndicator };

export const ParkScrollAreaRoot = (props: React.ComponentProps<typeof ArkScrollArea.Root>) => <ArkScrollArea.Root {...props} data-park="scroll-area-root" className={[scrollAreaStyles.root, parkPart('scroll-area-root', props.className)].join(' ')} />;
export const ParkScrollAreaViewport = (props: React.ComponentProps<typeof ArkScrollArea.Viewport>) => <ArkScrollArea.Viewport {...props} data-park="scroll-area-viewport" className={[scrollAreaStyles.viewport, parkPart('scroll-area-viewport', props.className)].join(' ')} />;
export const ParkScrollAreaContent = (props: React.ComponentProps<typeof ArkScrollArea.Content>) => <ArkScrollArea.Content {...props} data-park="scroll-area-content" className={[scrollAreaStyles.content, parkPart('scroll-area-content', props.className)].join(' ')} />;
export const ParkScrollAreaScrollbar = (props: React.ComponentProps<typeof ArkScrollArea.Scrollbar>) => <ArkScrollArea.Scrollbar {...props} data-park="scroll-area-scrollbar" className={[scrollAreaStyles.scrollbar, parkPart('scroll-area-scrollbar', props.className)].join(' ')} />;
export const ParkScrollAreaThumb = (props: React.ComponentProps<typeof ArkScrollArea.Thumb>) => <ArkScrollArea.Thumb {...props} data-park="scroll-area-thumb" className={[scrollAreaStyles.thumb, parkPart('scroll-area-thumb', props.className)].join(' ')} />;
export const ParkScrollArea = { Root: ParkScrollAreaRoot, Viewport: ParkScrollAreaViewport, Content: ParkScrollAreaContent, Scrollbar: ParkScrollAreaScrollbar, Thumb: ParkScrollAreaThumb };

export const ParkSplitterRoot = (props: React.ComponentProps<typeof ArkSplitter.Root>) => <ArkSplitter.Root {...props} data-park="splitter-root" className={[splitterStyles.root, parkPart('splitter-root', props.className)].join(' ')} />;
export const ParkSplitterPanel = (props: React.ComponentProps<typeof ArkSplitter.Panel>) => <ArkSplitter.Panel {...props} data-park="splitter-panel" className={[splitterStyles.panel, parkPart('splitter-panel', props.className)].join(' ')} />;
export const ParkSplitterResizeTrigger = (props: React.ComponentProps<typeof ArkSplitter.ResizeTrigger>) => <ArkSplitter.ResizeTrigger {...props} data-park="splitter-resize-trigger" className={[splitterStyles.resizeTrigger, parkPart('splitter-resize-trigger', props.className)].join(' ')} />;
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
  return <Field.Root {...props} required={required} data-park="field" data-scope="field" data-part="root" className={['tocyn-field', 'tocyn-park-field', className].filter(Boolean).join(' ')}>
    {label !== undefined && <Field.Label>{label}{required && <Field.RequiredIndicator> *</Field.RequiredIndicator>}</Field.Label>}
    {children}
    {error !== undefined ? <Field.ErrorText>{error}</Field.ErrorText> : description !== undefined && <Field.HelperText>{description}</Field.HelperText>}
  </Field.Root>;
}

export const ParkAvatar = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<typeof Avatar.Root>>(
  function ParkAvatar({ className, children, ...props }, ref) {
    return <Avatar.Root {...props} ref={ref} data-park="avatar" className={[avatarStyles.root, 'tocyn-avatar', className].filter(Boolean).join(' ')}>{children}</Avatar.Root>;
  },
);

export const ParkAvatarImage = (props: React.ComponentProps<typeof Avatar.Image>) => <Avatar.Image {...props} data-part="image" className={[avatarStyles.image, props.className].filter(Boolean).join(' ')} />;
export const ParkAvatarFallback = (props: React.ComponentProps<typeof Avatar.Fallback>) => <Avatar.Fallback {...props} data-part="fallback" className={[avatarStyles.fallback, props.className].filter(Boolean).join(' ')} />;

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
  return <section {...props} aria-label={typeof title === 'string' ? title : undefined} data-tocyn-primitive="empty-state" data-park="empty-state" data-scope="empty-state" data-part="root" className={[emptyStateStyles.root, 'tocyn-empty-state', 'tocyn-park-empty-state', className].filter(Boolean).join(' ')}>
    <Heading data-part="title">{title}</Heading>
    {description !== undefined && <p data-part="description">{description}</p>}
    {action !== undefined && <div data-part="action">{action}</div>}
  </section>;
}

/** Panda slot recipe for the application shell layout. */
export const ParkShell = shellRecipe;
export const ParkPage = pageStyles;
export const ParkVisuallyHidden = React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>(function ParkVisuallyHidden({ className, ...props }, ref) {
  return <span {...props} ref={ref} className={[visuallyHidden(), className].filter(Boolean).join(' ')} />;
});

export const ParkCard = {
  Root: (props: React.HTMLAttributes<HTMLDivElement> & { variant?: 'elevated' | 'outline' | 'subtle' }) => {
    const { variant: _variant, className, ...rest } = props;
    return <div {...rest} data-park="card" data-part="root" className={[cardStyles.root, className].filter(Boolean).join(' ')} />;
  },
  Header: (props: React.HTMLAttributes<HTMLDivElement>) => <div {...props} data-part="header" className={[cardStyles.header, props.className].filter(Boolean).join(' ')} />,
  Body: (props: React.HTMLAttributes<HTMLDivElement>) => <div {...props} data-part="body" className={[cardStyles.body, props.className].filter(Boolean).join(' ')} />,
  Footer: (props: React.HTMLAttributes<HTMLDivElement>) => <div {...props} data-part="footer" className={[cardStyles.footer, props.className].filter(Boolean).join(' ')} />,
  Title: (props: React.HTMLAttributes<HTMLHeadingElement>) => <h3 {...props} data-part="title" className={[cardStyles.title, props.className].filter(Boolean).join(' ')} />,
  Description: (props: React.HTMLAttributes<HTMLParagraphElement>) => <p {...props} data-part="description" className={[cardStyles.description, props.className].filter(Boolean).join(' ')} />,
};
