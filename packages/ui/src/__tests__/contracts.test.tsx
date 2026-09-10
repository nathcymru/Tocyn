// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { composeEventHandlers, TocynButton, TocynInput, TocynSelect, TocynTextarea, WorkspaceShell, WorkViewNavigator, ConversationList, ActiveConversation, ContextPanel } from '../index';
import { Dialog, Listbox, createListCollection } from '../ark';
import { TocynDialog, TocynConfirmDialog } from '../dialog';
import type { TocynButtonProps, TocynInputProps, TocynPanelProps } from '../primitives';

afterEach(cleanup);

describe('named primitive contracts', () => {
  it('composes native handlers consumer-first and honours cancellation', () => {
    const events: string[] = [];
    const handler = composeEventHandlers<React.PointerEvent<HTMLButtonElement>>(
      () => events.push('consumer'), () => events.push('internal'));
    render(<TocynButton onPointerDown={handler}>Open</TocynButton>);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Open' }));
    expect(events).toEqual(['consumer', 'internal']);
    const internal = vi.fn();
    render(<TocynButton onPointerDown={composeEventHandlers(event => event.preventDefault(), internal)}>Cancel</TocynButton>);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Cancel' }));
    expect(internal).not.toHaveBeenCalled();
  });

  it('keeps native keyboard activation, forwards refs, and honours loading/disabled state', async () => {
    const click = vi.fn();
    const ref = { current: null as HTMLButtonElement | null };
    render(<TocynButton ref={ref} aria-label="Send" onClick={click}>Send</TocynButton>);
    const button = screen.getByRole('button', { name: 'Send' });
    button.focus();
    await userEvent.setup().keyboard('{Enter}');
    expect(click).toHaveBeenCalledTimes(1);
    expect(ref.current).toBe(button);

    const { rerender } = render(<TocynButton aria-label="Busy" state="loading">Busy</TocynButton>);
    expect(screen.getByRole('button', { name: 'Busy' })).toBeDisabled();
    rerender(<TocynButton aria-label="Busy" state="disabled">Busy</TocynButton>);
    expect(screen.getByRole('button', { name: 'Busy' })).toBeDisabled();
  });

  it('supports controlled and uncontrolled input editing', async () => {
    function Controlled() {
      const [value, setValue] = React.useState('');
      return <TocynInput aria-label="Controlled" value={value} onChange={event => setValue(event.target.value)} />;
    }
    render(<><TocynInput aria-label="Uncontrolled" defaultValue="initial" /><Controlled /></>);
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Uncontrolled' }), ' edit');
    await user.type(screen.getByRole('textbox', { name: 'Controlled' }), 'typed');
    expect(screen.getByRole('textbox', { name: 'Uncontrolled' })).toHaveValue('initial edit');
    expect(screen.getByRole('textbox', { name: 'Controlled' })).toHaveValue('typed');
  });

  it('retains form names, values, validation and caller busy state', async () => {
    render(<form aria-label="Create"><TocynInput name="subject" aria-label="Subject" required aria-busy="true" defaultValue="Question" />
      <TocynSelect name="priority" aria-label="Priority" defaultValue="normal"><option value="normal">Normal</option><option value="high">High</option></TocynSelect>
      <TocynTextarea name="body" aria-label="Body" required defaultValue="Details" />
      <TocynButton aria-busy="true">Send</TocynButton></form>);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Priority' }), 'high');
    await user.type(screen.getByRole('textbox', { name: 'Body' }), ' added');
    const form = screen.getByRole('form', { name: 'Create' }) as HTMLFormElement;
    expect(Object.fromEntries(new FormData(form))).toEqual({subject:'Question', priority:'high', body:'Details added'});
    expect(screen.getByRole('textbox', { name: 'Subject' })).toBeRequired();
    expect(screen.getByRole('textbox', { name: 'Subject' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Send' })).toHaveAttribute('aria-busy', 'true');
  });

  it('exposes stable labelled workspace regions without owning application state', () => {
    const shellRef = React.createRef<HTMLDivElement>();
    const regionRef = React.createRef<HTMLElement>();
    const listRef = React.createRef<HTMLElement>();
    const conversationRef = React.createRef<HTMLElement>();
    const contextRef = React.createRef<HTMLElement>();
    const { unmount } = render(<WorkspaceShell ref={shellRef}><WorkViewNavigator ref={regionRef} /><ConversationList ref={listRef} /><ActiveConversation ref={conversationRef} /><ContextPanel ref={contextRef} /></WorkspaceShell>);
    expect(shellRef.current).toBe(document.querySelector('[data-tocyn-workspace]'));
    expect(screen.getByRole('region', { name: 'Work views' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Conversations' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Active conversation' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Context' })).toBeInTheDocument();
    expect(regionRef.current).toBe(screen.getByRole('region', { name: 'Work views' }));
    expect(listRef.current).toBe(screen.getByRole('region', { name: 'Conversations' }));
    expect(conversationRef.current).toBe(screen.getByRole('region', { name: 'Active conversation' }));
    expect(contextRef.current).toBe(screen.getByRole('region', { name: 'Context' }));
    unmount();
    expect(shellRef.current).toBeNull();
    expect(regionRef.current).toBeNull();
    expect(listRef.current).toBeNull();
    expect(conversationRef.current).toBeNull();
    expect(contextRef.current).toBeNull();
  });
});

describe('Ark complex controls', () => {
  it('opens a dialog, returns focus on escape, and selects a listbox item', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    const collection = createListCollection({ items: ['Mine', 'Needs Action'] });
    function DialogHarness() {
      const [open, setOpen] = React.useState(false);
      return <Dialog.Root open={open} onOpenChange={details => setOpen(details.open)}>
        <Dialog.Trigger>Open filters</Dialog.Trigger>
        <Dialog.Backdrop />
        <Dialog.Positioner><Dialog.Content><Dialog.Title>Filters</Dialog.Title><Dialog.CloseTrigger>Close</Dialog.CloseTrigger></Dialog.Content></Dialog.Positioner>
      </Dialog.Root>;
    }
    render(<>
      <DialogHarness />
      <Listbox.Root collection={collection} onValueChange={onValueChange}>
        <Listbox.Label>Views</Listbox.Label>
        <Listbox.Content>{collection.items.map(item => <Listbox.Item key={item} item={item}><Listbox.ItemText>{item}</Listbox.ItemText></Listbox.Item>)}</Listbox.Content>
      </Listbox.Root>
    </>);
    const trigger = screen.getByRole('button', { name: 'Open filters' });
    await user.click(trigger);
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Filters' })).toHaveAttribute('data-state', 'open'));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'));
    await waitFor(() => expect(trigger).toHaveFocus());

    screen.getByRole('listbox').focus();
    await user.keyboard('{End}{Enter}');
    expect(onValueChange).toHaveBeenCalledWith(expect.objectContaining({ value: ['Needs Action'] }));
  });
});

interface ConsumerButtonProps extends TocynButtonProps { auditTag: string; }
const consumerButtonProps = { type: 'button', auditTag: 'workspace', children: 'Open' } satisfies ConsumerButtonProps;
interface ConsumerInputProps extends TocynInputProps { auditTag: string; }
interface ConsumerPanelProps extends TocynPanelProps { auditTag: string; }
const consumerInputProps = { type: 'search', auditTag: 'filter', 'aria-label': 'Filter' } satisfies ConsumerInputProps;
const consumerPanelProps = { auditTag: 'context', 'aria-label': 'Context' } satisfies ConsumerPanelProps;
void consumerButtonProps;
void consumerInputProps;
void consumerPanelProps;

it('forwards dialog content refs and caller ARIA descriptions through the shared wrappers',async()=>{
  const ref=React.createRef<HTMLDivElement>();const confirmation=React.createRef<HTMLDivElement>();const key=vi.fn();
  const {unmount}=render(<TocynDialog open labelledBy="dialog-title" aria-describedby="caller-description" onOpenChange={()=>{}} ref={ref} onKeyDown={key}>
    <h2 id="dialog-title">Reference test</h2><p id="caller-description">Caller supplied description</p><button>Close</button>
  </TocynDialog>);
  const dialog=await screen.findByRole('dialog',{name:'Reference test'});expect(ref.current).toBe(dialog);expect(dialog).toHaveAccessibleDescription('Caller supplied description');
  fireEvent.keyDown(dialog,{key:'x'});expect(key).toHaveBeenCalledOnce();unmount();expect(ref.current).toBeNull();
  render(<TocynConfirmDialog open ref={confirmation} title="Confirmation reference" description="Action description" confirmLabel="Confirm" onConfirm={()=>{}} onOpenChange={()=>{}}/>);
  const confirm=await screen.findByRole('dialog',{name:'Confirmation reference'});expect(confirmation.current).toBe(confirm);expect(confirm).toHaveAccessibleDescription('Action description');
});
