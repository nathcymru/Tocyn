import * as React from 'react';
import { createListCollection } from '@ark-ui/react';
import { ParkButton, ParkDialog, ParkInput, ParkSelect, ParkTextarea, ParkEmptyState, type ParkButtonProps } from '../park';

// This file is compiled as a consumer of the public package surface.
interface AuditedButtonProps extends ParkButtonProps { auditTag: string }
interface AuditedInputProps extends React.ComponentProps<typeof ParkInput> { auditTag: string }
interface AuditedTextareaProps extends React.ComponentProps<typeof ParkTextarea> { auditTag: string }

const buttonRef = React.createRef<HTMLButtonElement>();
const inputRef = React.createRef<HTMLInputElement>();
const textareaRef = React.createRef<HTMLTextAreaElement>();
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
const dialogAttributes = { open: false, onOpenChange: (details: { open: boolean }) => details.open } satisfies React.ComponentProps<typeof ParkDialog.Root>;
const dialogContentAttributes = { ref: dialogRef, 'aria-labelledby': 'dialog-title' } satisfies React.ComponentProps<typeof ParkDialog.Content>;

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
    <ParkDialog.Root {...dialogAttributes}>
      <ParkDialog.Backdrop />
      <ParkDialog.Positioner><ParkDialog.Content {...dialogContentAttributes}>
        <ParkDialog.Title id="dialog-title">Details</ParkDialog.Title>
        <ParkDialog.Description>Description</ParkDialog.Description>
        <ParkDialog.Footer><ParkButton type="button">Confirm</ParkButton></ParkDialog.Footer>
      </ParkDialog.Content></ParkDialog.Positioner>
    </ParkDialog.Root>
  </>;
}

// @ts-expect-error a button cannot receive a text-area ref
<ParkButton ref={textareaRef}>Wrong ref</ParkButton>;
// @ts-expect-error a select trigger cannot receive a textarea ref
<ParkSelect.Trigger ref={textareaRef}>Wrong ref</ParkSelect.Trigger>;

export const extendedInterfaceFixtures = <>
  <ParkTextarea {...{ auditTag: 'consumer', ref: textareaRef, rows: 3, defaultValue: 'draft', 'aria-invalid': true, onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => event.currentTarget.value } satisfies AuditedTextareaProps} />
  <ParkDialog.Root open={false} onOpenChange={details => details.open} closeOnEscape={false} closeOnInteractOutside={false}>
    <ParkDialog.Positioner><ParkDialog.Content ref={dialogRef} aria-label="Details" /></ParkDialog.Positioner>
  </ParkDialog.Root>
</>;
// @ts-expect-error textarea refs must expose an HTMLTextAreaElement
const wrongTextarea: AuditedTextareaProps = { auditTag: 'consumer', ref: buttonRef };
// @ts-expect-error Park Dialog content refs cannot be textarea refs
<ParkDialog.Content ref={textareaRef}>Wrong ref</ParkDialog.Content>;
void wrongTextarea;
