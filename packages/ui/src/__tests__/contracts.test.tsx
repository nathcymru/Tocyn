// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { composeEventHandlers } from '../index';
import { createListCollection } from '@ark-ui/react';
import { TocynDialog, TocynConfirmDialog } from '../dialog';
import { ParkButton, ParkInput, ParkSelect, ParkTextarea, ParkEmptyState, type ParkButtonProps } from '../park';

afterEach(cleanup);

// Floating UI and Zag measure/scroll the popup in a browser; jsdom omits both APIs.
globalThis.ResizeObserver ??= class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
HTMLElement.prototype.scrollTo ??= () => {};

describe('official Park control contracts', () => {
  it('composes native handlers consumer-first and honours cancellation', () => {
    const events: string[] = [];
    const handler = composeEventHandlers<React.PointerEvent<HTMLButtonElement>>(
      () => events.push('consumer'), () => events.push('internal'));
    render(<ParkButton onPointerDown={handler}>Open</ParkButton>);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Open' }));
    expect(events).toEqual(['consumer', 'internal']);
    const internal = vi.fn();
    render(<ParkButton onPointerDown={composeEventHandlers(event => event.preventDefault(), internal)}>Cancel</ParkButton>);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Cancel' }));
    expect(internal).not.toHaveBeenCalled();
  });

  it('keeps native keyboard activation, forwards refs, and honours loading/disabled state', async () => {
    const click = vi.fn();
    const ref = { current: null as HTMLButtonElement | null };
    render(<ParkButton ref={ref} aria-label="Send" onClick={click}>Send</ParkButton>);
    const button = screen.getByRole('button', { name: 'Send' });
    button.focus();
    await userEvent.setup().keyboard('{Enter}');
    expect(click).toHaveBeenCalledTimes(1);
    expect(ref.current).toBe(button);

    const { rerender } = render(<ParkButton aria-label="Busy" loading>Busy</ParkButton>);
    expect(screen.getByRole('button', { name: 'Busy' })).toBeDisabled();
    rerender(<ParkButton aria-label="Busy" disabled>Busy</ParkButton>);
    expect(screen.getByRole('button', { name: 'Busy' })).toBeDisabled();
  });

  it('supports controlled and uncontrolled input editing', async () => {
    function Controlled() {
      const [value, setValue] = React.useState('');
      return <ParkInput aria-label="Controlled" value={value} onChange={event => setValue(event.target.value)} />;
    }
    render(<><ParkInput aria-label="Uncontrolled" defaultValue="initial" /><Controlled /></>);
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Uncontrolled' }), ' edit');
    await user.type(screen.getByRole('textbox', { name: 'Controlled' }), 'typed');
    expect(screen.getByRole('textbox', { name: 'Uncontrolled' })).toHaveValue('initial edit');
    expect(screen.getByRole('textbox', { name: 'Controlled' })).toHaveValue('typed');
  });

  it('retains form names, values, validation and caller busy state', async () => {
    const priorities = createListCollection({ items: [{ label: 'Normal', value: 'normal' }, { label: 'High', value: 'high' }] });
    render(<form aria-label="Create"><ParkInput name="subject" aria-label="Subject" required aria-busy="true" defaultValue="Question" />
      <ParkSelect.Root collection={priorities} defaultValue={['normal']}>
        <ParkSelect.Label>Priority</ParkSelect.Label>
        <ParkSelect.Control><ParkSelect.Trigger><ParkSelect.ValueText /></ParkSelect.Trigger></ParkSelect.Control>
        <ParkSelect.HiddenSelect name="priority" />
        <ParkSelect.Positioner><ParkSelect.Content><ParkSelect.List>{priorities.items.map(item => <ParkSelect.Item key={item.value} item={item}><ParkSelect.ItemText>{item.label}</ParkSelect.ItemText></ParkSelect.Item>)}</ParkSelect.List></ParkSelect.Content></ParkSelect.Positioner>
      </ParkSelect.Root>
      <ParkTextarea name="body" aria-label="Body" required defaultValue="Details" />
      <ParkButton aria-busy="true">Send</ParkButton></form>);
    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: 'Priority' }));
    await user.click(screen.getByRole('option', { name: 'High' }));
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Priority' })).toHaveAttribute('aria-expanded', 'false'));
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    await user.type(screen.getByRole('textbox', { name: 'Body' }), ' added');
    const form = screen.getByRole('form', { name: 'Create' }) as HTMLFormElement;
    await waitFor(() => expect(Object.fromEntries(new FormData(form))).toEqual({subject:'Question', priority:'high', body:'Details added'}));
    expect(screen.getByRole('textbox', { name: 'Subject' })).toBeRequired();
    expect(screen.getByRole('textbox', { name: 'Subject' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Send' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('combobox', { name: 'Priority' })).toHaveAttribute('data-scope', 'select');
  });

  it('renders the shared empty state without a compatibility panel wrapper', () => {
    render(<ParkEmptyState title="No tickets" description="Create a ticket to begin." action={<ParkButton>Create ticket</ParkButton>} />);
    expect(screen.getByRole('region', { name: 'No tickets' })).toHaveTextContent('Create a ticket to begin.');
    expect(screen.getByRole('button', { name: 'Create ticket' })).toBeInTheDocument();
  });

});

interface ConsumerButtonProps extends ParkButtonProps { auditTag: string; }
const consumerButtonProps = { type: 'button', auditTag: 'workspace', children: 'Open' } satisfies ConsumerButtonProps;
interface ConsumerInputProps extends React.ComponentProps<typeof ParkInput> { auditTag: string; }
const consumerInputProps = { type: 'search', auditTag: 'filter', 'aria-label': 'Filter' } satisfies ConsumerInputProps;
void consumerButtonProps;
void consumerInputProps;

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

it('renders confirmation failures with Park Alert anatomy without changing busy actions', async () => {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  const props = { open: true, title: 'Confirm removal', description: 'Review this action', confirmLabel: 'Remove', error: 'Could not remove item', onConfirm, onOpenChange };
  const { rerender } = render(<TocynConfirmDialog {...props} busy />);
  const dialog = await screen.findByRole('dialog', { name: 'Confirm removal' });
  expect(dialog).toHaveAccessibleDescription('Review this action');
  const alert = within(dialog).getByRole('alert');
  expect(alert).toHaveClass('alert__root');
  expect(alert.querySelector('.alert__description')).toHaveTextContent('Could not remove item');
  expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
  expect(within(dialog).getByRole('button', { name: 'Remove' })).toBeDisabled();
  rerender(<TocynConfirmDialog {...props} busy={false} />);
  const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
  cancel.focus();
  expect(cancel).toHaveFocus();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
  expect(onConfirm).toHaveBeenCalledOnce();
});
