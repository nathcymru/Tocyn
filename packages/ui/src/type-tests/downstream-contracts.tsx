import * as React from 'react';
import {
  ActiveConversation,
  ContextPanel,
  ConversationList,
  TocynButton,
  TocynInput,
  TocynPanel,
  TocynSelect,
  TocynTextarea,
  WorkViewNavigator,
  WorkspaceShell,
} from '../index';
import { TocynConfirmDialog, TocynDialog } from '../dialog';
import type {
  TocynButtonProps,
  TocynInputProps,
  TocynPanelProps,
} from '../primitives';

// This file is compiled as a consumer of the public package surface.
interface AuditedButtonProps extends TocynButtonProps { auditTag: string }
interface AuditedInputProps extends TocynInputProps { auditTag: string }
interface AuditedPanelProps extends TocynPanelProps { auditTag: string }

const buttonRef = React.createRef<HTMLButtonElement>();
const inputRef = React.createRef<HTMLInputElement>();
const textareaRef = React.createRef<HTMLTextAreaElement>();
const selectRef = React.createRef<HTMLSelectElement>();
const panelRef = React.createRef<HTMLElement>();
const shellRef = React.createRef<HTMLDivElement>();
const regionRef = React.createRef<HTMLElement>();
const dialogRef = React.createRef<HTMLDivElement>();

const buttonProps = {
  auditTag: 'primary', type: 'button', state: 'idle', loading: false, 'aria-label': 'Save', ref: buttonRef,
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => event.currentTarget.blur(),
} satisfies AuditedButtonProps;
const inputProps = {
  auditTag: 'search', type: 'search', state: 'error', 'aria-label': 'Search', ref: inputRef,
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => event.currentTarget.value,
} satisfies AuditedInputProps;
const panelProps = {
  auditTag: 'context', state: 'open', 'aria-label': 'Context', ref: panelRef,
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => event.key,
} satisfies AuditedPanelProps;

export function DownstreamContractConsumer() {
  return <>
    <TocynButton {...buttonProps}>Save</TocynButton>
    <TocynInput {...inputProps} />
    <TocynTextarea ref={textareaRef} aria-label="Details" onInput={(event: React.FormEvent<HTMLTextAreaElement>) => event.currentTarget.value} />
    <TocynSelect ref={selectRef} aria-label="Priority" onChange={(event: React.ChangeEvent<HTMLSelectElement>) => event.currentTarget.value}><option>Normal</option></TocynSelect>
    <TocynPanel {...panelProps}>Panel</TocynPanel>
    <WorkspaceShell ref={shellRef} onClick={(event: React.MouseEvent<HTMLDivElement>) => event.currentTarget.dataset.clicked = 'true'} />
    <WorkViewNavigator ref={regionRef} onFocus={(event: React.FocusEvent<HTMLElement>) => event.currentTarget.dataset.focused = 'true'} />
    <ConversationList ref={regionRef} aria-live="polite" />
    <ActiveConversation ref={regionRef} />
    <ContextPanel ref={regionRef} />
    <TocynDialog ref={dialogRef} open labelledBy="dialog-title" onOpenChange={(open: boolean) => open}>
      <h2 id="dialog-title">Details</h2>
    </TocynDialog>
    <TocynConfirmDialog open title="Confirm" description="Description" confirmLabel="Confirm" onConfirm={() => undefined} onOpenChange={(open: boolean) => open} />
  </>;
}

// @ts-expect-error a button cannot receive a text-area ref
<TocynButton ref={textareaRef}>Wrong ref</TocynButton>;
// @ts-expect-error a shell exposes its div ref, not a section ref
<WorkspaceShell ref={regionRef}>Wrong ref</WorkspaceShell>;
// @ts-expect-error native button props cannot be applied to a select
<TocynSelect ref={buttonRef}>Wrong native ref</TocynSelect>;

// Each Tocyn-owned named props interface can be extended directly, without an
// intersection or extracting component props from the implementation.
import { WorkspaceRegion } from '../primitives';
import type { WorkspaceRegionProps, TocynTextareaProps, TocynSelectProps } from '../primitives';
import type { WorkspaceShellProps, WorkViewNavigatorProps, ConversationListProps, ActiveConversationProps, ContextPanelProps } from '../workspace';
import type { TocynDialogProps, TocynConfirmDialogProps } from '../dialog';
interface AuditedTextareaProps extends TocynTextareaProps { auditTag: string }
interface AuditedSelectProps extends TocynSelectProps { auditTag: string }
interface AuditedRegionProps extends WorkspaceRegionProps { auditTag: string }
interface AuditedShellProps extends WorkspaceShellProps { auditTag: string }
interface AuditedNavigatorProps extends WorkViewNavigatorProps { auditTag: string }
interface AuditedListProps extends ConversationListProps { auditTag: string }
interface AuditedConversationProps extends ActiveConversationProps { auditTag: string }
interface AuditedContextProps extends ContextPanelProps { auditTag: string }
interface AuditedDialogProps extends TocynDialogProps { auditTag: string }
interface AuditedConfirmationProps extends TocynConfirmDialogProps { auditTag: string }
const regionAttributes = { auditTag: 'consumer', ref: regionRef, 'aria-describedby': 'help', onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => event.preventDefault() };
const dialogAttributes = { auditTag: 'consumer', ref: dialogRef, open: false, onOpenChange: (_open: boolean) => undefined };
export const extendedInterfaceFixtures = <>
  <TocynTextarea {...{ auditTag: 'consumer', ref: textareaRef, rows: 3, defaultValue: 'draft', 'aria-invalid': true, onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => event.currentTarget.value } satisfies AuditedTextareaProps} />
  <TocynSelect {...{ auditTag: 'consumer', ref: selectRef, multiple: true, defaultValue: ['a'], 'aria-label': 'Choices', onChange: (event: React.ChangeEvent<HTMLSelectElement>) => event.currentTarget.selectedOptions } satisfies AuditedSelectProps} />
  <WorkspaceRegion {...{ ...regionAttributes, label: 'Region' } satisfies AuditedRegionProps} />
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
// @ts-expect-error selects have no textarea rows property
const wrongSelect: AuditedSelectProps = { auditTag: 'consumer', rows: 3 };
// @ts-expect-error dialog div refs cannot be textarea refs
const wrongDialog: AuditedDialogProps = { ...dialogAttributes, labelledBy: 'title', ref: textareaRef };
void wrongTextarea; void wrongSelect; void wrongDialog;

// @ts-expect-error states are bounded, not arbitrary styling strings
const wrongButtonState: AuditedButtonProps = { auditTag: 'consumer', state: 'anything' };
void wrongButtonState;
