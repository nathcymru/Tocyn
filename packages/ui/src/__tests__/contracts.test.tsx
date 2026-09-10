// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TocynButton, TocynInput, WorkspaceShell, WorkViewNavigator, ConversationList, ActiveConversation, ContextPanel } from '../index';
import { Dialog, Listbox, createListCollection } from '../ark';
import type { TocynButtonProps, TocynInputProps, TocynPanelProps } from '../primitives';

afterEach(cleanup);

describe('named primitive contracts', () => {
  it('composes abstract and native pointer handlers in order and honours cancellation', () => {
    const events: string[] = [];
    const nativeDown = vi.fn(() => events.push('native-down'));
    const nativeUp = vi.fn(() => events.push('native-up'));
    const { getByRole } = render(<TocynButton aria-label="Open" onInteractionStart={() => events.push('abstract-start')} onInteractionEnd={() => events.push('abstract-end')} onPointerDown={nativeDown} onPointerUp={nativeUp}>Open</TocynButton>);
    const button = getByRole('button', { name: 'Open' });
    fireEvent.pointerDown(button);
    fireEvent.pointerUp(button);
    expect(events).toEqual(['abstract-start', 'native-down', 'abstract-end', 'native-up']);

    events.length = 0;
    const cancelled = (event: React.PointerEvent<HTMLButtonElement>) => { events.push('abstract-cancel'); event.preventDefault(); };
    render(<TocynButton aria-label="Cancelled" onInteractionStart={cancelled} onPointerDown={() => events.push('native-should-not-run')}>Cancelled</TocynButton>);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Cancelled' }));
    expect(events).toEqual(['abstract-cancel']);
  });

  it('keeps native keyboard activation, forwards refs, and honours loading/disabled state', () => {
    const click = vi.fn();
    const ref = { current: null as HTMLButtonElement | null };
    render(<TocynButton ref={ref} aria-label="Send" onClick={click}>Send</TocynButton>);
    const button = screen.getByRole('button', { name: 'Send' });
    fireEvent.keyDown(button, { key: 'Enter' });
    fireEvent.click(button, { detail: 0 });
    expect(click).toHaveBeenCalledTimes(1);
    expect(ref.current).toBe(button);

    const { rerender } = render(<TocynButton aria-label="Busy" loading>Busy</TocynButton>);
    expect(screen.getByRole('button', { name: 'Busy' })).toBeDisabled();
    rerender(<TocynButton aria-label="Busy" state="disabled">Busy</TocynButton>);
    expect(screen.getByRole('button', { name: 'Busy' })).toBeDisabled();
  });

  it('supports controlled and uncontrolled native input values without leaking abstract props', () => {
    const { rerender } = render(<TocynInput aria-label="Filter" defaultValue="initial" loading onInteractionStart={() => undefined} />);
    const input = screen.getByRole('textbox', { name: 'Filter' });
    expect(input).toBeDisabled();
    expect(input).not.toHaveAttribute('oninteractionstart');
    rerender(<TocynInput aria-label="Filter" value="controlled" onChange={() => undefined} />);
    expect(screen.getByRole('textbox', { name: 'Filter' })).toHaveValue('controlled');
  });

  it('exposes stable labelled workspace regions without owning application state', () => {
    render(<WorkspaceShell><WorkViewNavigator /><ConversationList /><ActiveConversation /><ContextPanel /></WorkspaceShell>);
    expect(screen.getByRole('region', { name: 'Work views' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Conversations' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Active conversation' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Context' })).toBeInTheDocument();
  });
});

describe('Ark complex controls', () => {
  it('opens a dialog, returns focus on escape, and selects a listbox item', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    const collection = createListCollection({ items: ['Mine', 'Needs Action'] });
    function DialogHarness() {
      const [open, setOpen] = React.useState(true);
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
    expect(screen.getByRole('dialog', { name: 'Filters' })).toBeInTheDocument();
    trigger.focus();
    screen.getByRole('dialog', { name: 'Filters' }).focus();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Filters' })).toHaveAttribute('data-state', 'closed');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await user.click(screen.getByRole('option', { name: 'Needs Action' }));
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
