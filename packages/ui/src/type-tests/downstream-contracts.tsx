import * as React from 'react';
import { ActiveConversation, ContextPanel, ConversationList, WorkViewNavigator, WorkspaceShell, WorkspaceRegion } from '../index';
import { TocynConfirmDialog, TocynDialog } from '../dialog';
import { createListCollection } from '../ark';
import { ParkButton, ParkInput, ParkSelect, ParkTextarea, ParkEmptyState, type ParkButtonProps } from '../park';
import type { WorkspaceRegionProps } from '../primitives';
import type { WorkspaceShellProps, WorkViewNavigatorProps, ConversationListProps, ActiveConversationProps, ContextPanelProps } from '../workspace';
import type { TocynDialogProps, TocynConfirmDialogProps } from '../dialog';

// This file is compiled as a consumer of the public package surface.
interface AuditedButtonProps extends ParkButtonProps { auditTag: string }
interface AuditedInputProps extends React.ComponentProps<typeof ParkInput> { auditTag: string }
interface AuditedTextareaProps extends React.ComponentProps<typeof ParkTextarea> { auditTag: string }
interface AuditedRegionProps extends WorkspaceRegionProps { auditTag: string }
interface AuditedShellProps extends WorkspaceShellProps { auditTag: string }
interface AuditedNavigatorProps extends WorkViewNavigatorProps { auditTag: string }
interface AuditedListProps extends ConversationListProps { auditTag: string }
interface AuditedConversationProps extends ActiveConversationProps { auditTag: string }
interface AuditedContextProps extends ContextPanelProps { auditTag: string }
interface AuditedDialogProps extends TocynDialogProps { auditTag: string }
interface AuditedConfirmationProps extends TocynConfirmDialogProps { auditTag: string }

const buttonRef = React.createRef<HTMLButtonElement>();
const inputRef = React.createRef<HTMLInputElement>();
const textareaRef = React.createRef<HTMLTextAreaElement>();
const shellRef = React.createRef<HTMLDivElement>();
const regionRef = React.createRef<HTMLElement>();
const dialogRef = React.createRef<HTMLDivElement>();
const priorities = createListCollection({ items: [{ label: 'Normal', value: 'normal' }] });
const buttonProps = {
  auditTag: 'primary', type: 'button', loading: false, 'aria-label': 'Save', ref: buttonRef,
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => event.currentTarget.blur(),
} satisfies AuditedButtonProps;
const inputProps = {
  auditTag: 'search', type: 'search', 'aria-invalid': true, 'aria-label': 'Search', ref: inputRef,
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => event.currentTarget.value,
} satisfies AuditedInputProps;
const regionAttributes = { auditTag: 'consumer', ref: regionRef, 'aria-describedby': 'help', onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => event.preventDefault() };
const dialogAttributes = { auditTag: 'consumer', ref: dialogRef, open: false, onOpenChange: (_open: boolean) => undefined };

export function DownstreamContractConsumer() {
  return <>
    <ParkButton {...buttonProps}>Save</ParkButton>
    <ParkInput {...inputProps} />
    <ParkTextarea ref={textareaRef} aria-label="Details" onInput={(event: React.FormEvent<HTMLTextAreaElement>) => event.currentTarget.value} />
    <ParkSelect.Root collection={priorities} defaultValue={['normal']}>
      <ParkSelect.Label>Priority</ParkSelect.Label>
      <ParkSelect.Control><ParkSelect.Trigger><ParkSelect.ValueText /></ParkSelect.Trigger></ParkSelect.Control>
      <ParkSelect.HiddenSelect name="priority" />
      <ParkSelect.Positioner><ParkSelect.Content><ParkSelect.List>{priorities.items.map(item => <ParkSelect.Item key={item.value} item={item}><ParkSelect.ItemText>{item.label}</ParkSelect.ItemText></ParkSelect.Item>)}</ParkSelect.List></ParkSelect.Content></ParkSelect.Positioner>
    </ParkSelect.Root>
    <ParkEmptyState title="No data" description="Try again later" />
    <WorkspaceRegion {...{ ...regionAttributes, label: 'Region' } satisfies AuditedRegionProps} />
    <WorkspaceShell ref={shellRef} onClick={(event: React.MouseEvent<HTMLDivElement>) => event.currentTarget.dataset.clicked = 'true'} />
    <WorkViewNavigator ref={regionRef} onFocus={(event: React.FocusEvent<HTMLElement>) => event.currentTarget.dataset.focused = 'true'} />
    <ConversationList ref={regionRef} aria-live="polite" />
    <ActiveConversation ref={regionRef} />
    <ContextPanel ref={regionRef} />
    <TocynDialog ref={dialogRef} open labelledBy="dialog-title" onOpenChange={(open: boolean) => open}><h2 id="dialog-title">Details</h2></TocynDialog>
    <TocynConfirmDialog open title="Confirm" description="Description" confirmLabel="Confirm" onConfirm={() => undefined} onOpenChange={(open: boolean) => open} />
  </>;
}

// @ts-expect-error a button cannot receive a text-area ref
<ParkButton ref={textareaRef}>Wrong ref</ParkButton>;
// @ts-expect-error a shell exposes its div ref, not a section ref
<WorkspaceShell ref={regionRef}>Wrong ref</WorkspaceShell>;
// @ts-expect-error a select trigger cannot receive a textarea ref
<ParkSelect.Trigger ref={textareaRef}>Wrong ref</ParkSelect.Trigger>;

export const extendedInterfaceFixtures = <>
  <ParkTextarea {...{ auditTag: 'consumer', ref: textareaRef, rows: 3, defaultValue: 'draft', 'aria-invalid': true, onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => event.currentTarget.value } satisfies AuditedTextareaProps} />
  <WorkspaceShell {...{ auditTag: 'consumer', ref: shellRef, 'aria-label': 'Workspace', onClick: (event: React.MouseEvent<HTMLDivElement>) => event.preventDefault() } satisfies AuditedShellProps} />
  <WorkViewNavigator {...regionAttributes satisfies AuditedNavigatorProps} />
  <ConversationList {...regionAttributes satisfies AuditedListProps} />
  <ActiveConversation {...regionAttributes satisfies AuditedConversationProps} />
  <ContextPanel {...regionAttributes satisfies AuditedContextProps} />
  <TocynDialog {...{ ...dialogAttributes, labelledBy: 'title', busy: true } satisfies AuditedDialogProps} />
  <TocynConfirmDialog {...{ ...dialogAttributes, title: 'Confirm', description: 'Details', confirmLabel: 'Confirm', onConfirm: () => undefined } satisfies AuditedConfirmationProps} />
</>;
// @ts-expect-error textarea refs must expose an HTMLTextAreaElement
const wrongTextarea: AuditedTextareaProps = { auditTag: 'consumer', ref: buttonRef };
// @ts-expect-error dialog div refs cannot be textarea refs
const wrongDialog: AuditedDialogProps = { ...dialogAttributes, labelledBy: 'title', ref: textareaRef };
void wrongTextarea; void wrongDialog;
