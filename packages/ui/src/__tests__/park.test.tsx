// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createListCollection } from '@ark-ui/react';
import { ParkAvatar, ParkAvatarFallback, ParkButton, ParkCheckbox, ParkDialog, ParkEmptyState, ParkField, ParkInput, ParkPinInput, ParkPinInputSlot, ParkScrollArea, ParkSelect, ParkSplitter, ParkSwitch, ParkTabs, ParkTextarea } from '../park';

if (!window.ResizeObserver) {
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
}
if (!window.IntersectionObserver) {
  window.IntersectionObserver = class {
    readonly root = null;
    readonly rootMargin = '';
    readonly thresholds: number[] = [];
    observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
  } as unknown as typeof IntersectionObserver;
}
if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const priorities = createListCollection({ items: [{ label: 'Normal', value: 'normal' }, { label: 'High', value: 'high' }] });

describe('installed Park UI components', () => {
  it('uses official button variants and loading behavior', () => {
    render(<><ParkButton variant="solid">Save</ParkButton><ParkButton variant="plain">More</ParkButton><ParkButton variant="solid" colorPalette="red">Delete</ParkButton><ParkButton loading loadingText="Saving">Submit</ParkButton></>);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveClass('button--variant_solid');
    expect(screen.getByRole('button', { name: 'More' })).toHaveClass('button--variant_plain');
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('button--variant_solid');
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('color-palette_red');
    expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled();
  });

  it('retains form semantics through Park Field, Input, Textarea and Select anatomy', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<form aria-label="Park form">
      <ParkField label="Name"><ParkInput name="name" required /></ParkField>
      <ParkTextarea name="details" aria-label="Details" />
      <ParkSelect.Root collection={priorities} onValueChange={onValueChange}>
        <ParkSelect.Label>Priority</ParkSelect.Label>
        <ParkSelect.Control><ParkSelect.Trigger><ParkSelect.ValueText placeholder="Choose priority" /></ParkSelect.Trigger><ParkSelect.Indicator /></ParkSelect.Control>
        <ParkSelect.HiddenSelect name="priority" />
        <ParkSelect.Positioner><ParkSelect.Content><ParkSelect.List>{priorities.items.map(item => <ParkSelect.Item key={item.value} item={item}><ParkSelect.ItemText>{item.label}</ParkSelect.ItemText><ParkSelect.ItemIndicator /></ParkSelect.Item>)}</ParkSelect.List></ParkSelect.Content></ParkSelect.Positioner>
      </ParkSelect.Root>
    </form>);
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeRequired();
    expect(screen.getByRole('textbox', { name: 'Details' })).toHaveClass('textarea');
    expect(screen.getByRole('combobox', { name: 'Priority' })).toHaveClass('select__trigger');
    await user.click(screen.getByRole('combobox', { name: 'Priority' }));
    expect(screen.getByRole('option', { name: 'High' })).toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: 'High' }));
    expect(onValueChange).toHaveBeenCalledWith(expect.objectContaining({ value: ['high'] }));
  });

  it('keeps Select trigger and indicator in one narrow control while its keyboard popup works', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    const view = render(<ParkSelect.Root collection={priorities} onValueChange={onValueChange} style={{ width: 144 }}>
      <ParkSelect.Label>Priority</ParkSelect.Label>
      <ParkSelect.Control><ParkSelect.Trigger><ParkSelect.ValueText placeholder="Choose priority" /></ParkSelect.Trigger><ParkSelect.IndicatorGroup><ParkSelect.Indicator /></ParkSelect.IndicatorGroup></ParkSelect.Control>
      <ParkSelect.HiddenSelect />
      <ParkSelect.Positioner><ParkSelect.Content><ParkSelect.List>{priorities.items.map(item => <ParkSelect.Item key={item.value} item={item}><ParkSelect.ItemText>{item.label}</ParkSelect.ItemText></ParkSelect.Item>)}</ParkSelect.List></ParkSelect.Content></ParkSelect.Positioner>
    </ParkSelect.Root>);
    const trigger = within(view.container).getByRole('combobox', { name: 'Priority' });
    const control = trigger.parentElement;
    expect(control).toHaveClass('select__control');
    expect(control?.querySelector('.select__indicatorGroup')).toContainElement(control?.querySelector('.select__indicator') ?? null);
    expect(trigger.querySelector('.select__valueText')).toBeInTheDocument();
    expect(trigger).toHaveClass('select__trigger--size_md');
    trigger.focus();
    await user.keyboard('{ArrowDown}');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'));
    expect(onValueChange).not.toHaveBeenCalled();
    trigger.focus();
    await user.keyboard('{Enter}');
    const listbox = await screen.findByRole('listbox', { name: 'Priority' });
    await waitFor(() => expect(listbox).toHaveFocus());
    await user.keyboard('{End}{Enter}');
    await waitFor(() => expect(onValueChange).toHaveBeenCalledWith(expect.objectContaining({ value: ['high'] })));
    expect(trigger).toHaveTextContent('High');
  });

  it('uses Park checkbox, switch, pin input and avatar anatomy', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<>
      <ParkCheckbox.Root onCheckedChange={onCheckedChange}><ParkCheckbox.HiddenInput /><ParkCheckbox.Control><ParkCheckbox.Indicator /></ParkCheckbox.Control><ParkCheckbox.Label>Enabled</ParkCheckbox.Label></ParkCheckbox.Root>
      <ParkSwitch.Root><ParkSwitch.HiddenInput /><ParkSwitch.Control /><ParkSwitch.Label>Notifications</ParkSwitch.Label></ParkSwitch.Root>
      <ParkPinInput label="Verification code" count={4}>{[0, 1, 2, 3].map(index => <ParkPinInputSlot key={index} index={index} />)}</ParkPinInput>
      <ParkAvatar><ParkAvatarFallback>TC</ParkAvatarFallback></ParkAvatar>
    </>);
    await user.click(screen.getByText('Enabled'));
    expect(onCheckedChange).toHaveBeenCalledWith(expect.objectContaining({ checked: true }));
    expect(document.querySelector('.checkbox__control')).toBeInTheDocument();
    expect(document.querySelector('.switch__control')).toBeInTheDocument();
    expect(document.querySelectorAll('.pin-input__input')).toHaveLength(4);
    expect(screen.getByText('TC')).toBeInTheDocument();
  });

  it('renders layout and overlay slot classes from installed recipes', () => {
    render(<>
      <ParkTabs.Root defaultValue="inbox"><ParkTabs.List><ParkTabs.Trigger value="inbox">Inbox</ParkTabs.Trigger></ParkTabs.List><ParkTabs.Content value="inbox">Messages</ParkTabs.Content></ParkTabs.Root>
      <ParkScrollArea.Root><ParkScrollArea.Viewport><ParkScrollArea.Content>Scrollable</ParkScrollArea.Content></ParkScrollArea.Viewport></ParkScrollArea.Root>
      <ParkSplitter.Root size={[40, 60]} panels={[{ id: 'list' }, { id: 'detail' }]}><ParkSplitter.Panel id="list">List</ParkSplitter.Panel><ParkSplitter.ResizeTrigger id="list:detail" /><ParkSplitter.Panel id="detail">Detail</ParkSplitter.Panel></ParkSplitter.Root>
      <ParkDialog.Root open><ParkDialog.Backdrop /><ParkDialog.Positioner><ParkDialog.Content><ParkDialog.Title>Details</ParkDialog.Title></ParkDialog.Content></ParkDialog.Positioner></ParkDialog.Root>
    </>);
    expect(document.querySelector('.tabs__root')).toBeInTheDocument();
    expect(document.querySelector('.scroll-area__viewport')).toBeInTheDocument();
    expect(document.querySelectorAll('.splitter__panel')).toHaveLength(2);
    expect(document.querySelector('.splitter__resizeTrigger')).toBeInTheDocument();
    expect(document.querySelector('.dialog__content')).toBeInTheDocument();
  });

  it('resizes Splitter panels by keyboard within declared bounds', async () => {
    const user = userEvent.setup();
    // Zag waits for a measurable root before initializing its panel sizes.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 0, 500, 100));
    function Harness() {
      const [size, setSize] = React.useState([50, 50]);
      return <ParkSplitter.Root size={size} onResize={details => setSize(details.size)} keyboardResizeBy={10} panels={[{ id: 'list', minSize: 30, maxSize: 70 }, { id: 'detail', minSize: 30, maxSize: 70 }]}>
        <ParkSplitter.Panel id="list">List</ParkSplitter.Panel>
        <ParkSplitter.ResizeTrigger id="list:detail" />
        <ParkSplitter.Panel id="detail">Detail</ParkSplitter.Panel>
      </ParkSplitter.Root>;
    }
    const view = render(<Harness />);
    const separator = within(view.container).getByRole('separator');
    expect(separator).toHaveAttribute('aria-valuenow', '50');
    separator.focus();
    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}');
    await waitFor(() => expect(separator).toHaveAttribute('aria-valuenow', '70'));
    await user.keyboard('{ArrowRight}');
    expect(separator).toHaveAttribute('aria-valuenow', '70');
    await user.keyboard('{Home}');
    expect(separator).toHaveAttribute('aria-valuenow', '30');
  });

  it('returns focus to the Dialog trigger when closed', async () => {
    const user = userEvent.setup();
    render(<ParkDialog.Root>
      <ParkDialog.Trigger>Open details</ParkDialog.Trigger>
      <ParkDialog.Backdrop />
      <ParkDialog.Positioner><ParkDialog.Content><ParkDialog.Title>Details</ParkDialog.Title><ParkDialog.CloseTrigger>Close details</ParkDialog.CloseTrigger></ParkDialog.Content></ParkDialog.Positioner>
    </ParkDialog.Root>);
    const trigger = screen.getByRole('button', { name: 'Open details' });
    await user.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Details' });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Details' })).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('keeps Tocyn empty state as an app composition', () => {
    render(<ParkEmptyState title="No tickets" description="Your queue is empty." action={<ParkButton>Refresh</ParkButton>} />);
    expect(screen.getByRole('region', { name: 'No tickets' })).toHaveClass('emptyState__root');
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });
});
