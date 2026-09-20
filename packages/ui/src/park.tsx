import * as React from 'react';
import { visuallyHidden } from './styles/generated/patterns';
import { emptyState as emptyStateRecipe, globalSearch as globalSearchRecipe, knowledgeEditor as knowledgeEditorRecipe, composer as composerRecipe, ticketFields as ticketFieldsRecipe, shell as shellRecipe, page as pageRecipe, ticketDetail as ticketDetailRecipe } from './styles/generated/recipes';
import { Button as OfficialButton, type ButtonProps as OfficialButtonProps } from './components/ui/button';
import { Input as OfficialInput } from './components/ui/input';
import { Textarea as OfficialTextarea } from './components/ui/textarea';
import { Skeleton as OfficialSkeleton } from './components/ui/skeleton';
import * as OfficialProgress from './components/ui/progress';
import * as OfficialSelect from './components/ui/select';
import * as OfficialTabs from './components/ui/tabs';
import * as OfficialScrollArea from './components/ui/scroll-area';
import * as OfficialSplitter from './components/ui/splitter';
import * as OfficialField from './components/ui/field';
import * as OfficialAvatar from './components/ui/avatar';
import * as OfficialMenu from './components/ui/menu';
import * as OfficialPinInput from './components/ui/pin-input';
import * as OfficialCard from './components/ui/card';
import * as OfficialPopover from './components/ui/popover';
import * as OfficialDialog from './components/ui/dialog';
import * as OfficialCheckbox from './components/ui/checkbox';
import * as OfficialSwitch from './components/ui/switch';
import * as OfficialTable from './components/ui/table';
import * as OfficialRadioGroup from './components/ui/radio-group';
import * as OfficialAlert from './components/ui/alert';
import * as OfficialFileUpload from './components/ui/file-upload';

export type ParkButtonProps = OfficialButtonProps;
export const ParkButton = OfficialButton;

export const ParkInput = OfficialInput;
export const ParkTextarea = OfficialTextarea;
export const ParkSkeleton = OfficialSkeleton;

export function ParkProgress({ value = null, label, className }: { value?: number | null; label: React.ReactNode; className?: string }) {
  return <OfficialProgress.Root value={value} size="sm" shape="full" variant="subtle" className={className}>
    <OfficialProgress.Label>{label}</OfficialProgress.Label>
    <OfficialProgress.Track aria-label={typeof label === 'string' ? label : undefined}><OfficialProgress.Range /></OfficialProgress.Track>
  </OfficialProgress.Root>;
}

export const ParkSelect = OfficialSelect;

export const ParkTabs = OfficialTabs;

export const ParkScrollArea = OfficialScrollArea;

export const ParkSplitter = OfficialSplitter;

export interface ParkFieldProps extends React.HTMLAttributes<HTMLDivElement> {
  label?: React.ReactNode;
  description?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  children: React.ReactNode;
}
export function ParkField({ label, description, error, required, children, className, ...props }: ParkFieldProps) {
  return <OfficialField.Root {...props} required={required} className={className}>
    {label !== undefined && <OfficialField.Label>{label}{required && <OfficialField.RequiredIndicator> *</OfficialField.RequiredIndicator>}</OfficialField.Label>}
    {children}
    {error !== undefined ? <OfficialField.ErrorText>{error}</OfficialField.ErrorText> : description !== undefined && <OfficialField.HelperText>{description}</OfficialField.HelperText>}
  </OfficialField.Root>;
}

export type ParkAvatarProps = React.ComponentProps<typeof OfficialAvatar.Root>;
export const ParkAvatar = OfficialAvatar.Root;
export const ParkAvatarFallback = OfficialAvatar.Fallback;

export const ParkMenu = OfficialMenu;

export const ParkPopover = OfficialPopover;
export const ParkDialog = OfficialDialog;
export const ParkCheckbox = OfficialCheckbox;
export const ParkSwitch = OfficialSwitch;
export const ParkTable = OfficialTable;
export const ParkRadioGroup = OfficialRadioGroup;
export const ParkAlert = OfficialAlert;
export const ParkCard = OfficialCard;
export const ParkFileUpload = OfficialFileUpload;

export interface ParkPinInputProps extends React.ComponentPropsWithoutRef<typeof OfficialPinInput.Root> {
  label?: React.ReactNode;
  readOnly?: boolean;
}
/** Compact composition of Park's installed Ark-backed Pin Input parts. */
export const ParkPinInput = React.forwardRef<HTMLDivElement, ParkPinInputProps>(function ParkPinInput({ label, children, readOnly, ...props }, ref) {
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
  return <OfficialPinInput.Root {...props} ref={setRef}>
    {label !== undefined && <OfficialPinInput.Label>{label}</OfficialPinInput.Label>}
    <OfficialPinInput.Control>{React.Children.map(children, child => React.isValidElement(child) ? React.cloneElement(child, { readOnly } as object) : child)}</OfficialPinInput.Control>
    <OfficialPinInput.HiddenInput />
  </OfficialPinInput.Root>;
});
export const ParkPinInputSlot = OfficialPinInput.Input;

/** Tocyn-specific empty state layout composed with a Panda app recipe. */
export interface ParkEmptyStateProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6 | false;
  headingRef?: React.Ref<HTMLHeadingElement>;
}
const emptyStateStyles = emptyStateRecipe();
export function ParkEmptyState({ title, description, action, headingLevel = 2, headingRef, className, ...props }: ParkEmptyStateProps) {
  const Heading = `h${headingLevel}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
  return <section {...props} aria-label={typeof title === 'string' ? title : undefined} className={[emptyStateStyles.root, className].filter(Boolean).join(' ')}>
    {headingLevel === false
      ? <p className={emptyStateStyles.title}>{title}</p>
      : <Heading ref={headingRef} tabIndex={headingRef ? -1 : undefined} className={emptyStateStyles.title}>{title}</Heading>}
    {description !== undefined && <p className={emptyStateStyles.description}>{description}</p>}
    {action !== undefined && <div className={emptyStateStyles.action}>{action}</div>}
  </section>;
}

// Static calls keep app-only Panda recipes in the shared stylesheet.
export const ParkShell = (props?: Parameters<typeof shellRecipe>[0]) => shellRecipe(props);
export const ParkGlobalSearch = () => globalSearchRecipe();
export const ParkKnowledgeEditor = () => knowledgeEditorRecipe();
export const ParkComposer = () => composerRecipe();
export const ParkTicketFields = () => ticketFieldsRecipe();
export const ParkTicketDetail = () => ticketDetailRecipe();
export const ParkPage = (kind: 'dashboard' | 'knowledge' | 'inbox' | 'settings' | 'account') => pageRecipe({ kind });
export const ParkVisuallyHidden = React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>(function ParkVisuallyHidden({ className, ...props }, ref) {
  return <span {...props} ref={ref} className={[visuallyHidden(), className].filter(Boolean).join(' ')} />;
});
