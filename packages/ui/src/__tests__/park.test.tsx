// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createListCollection } from '@ark-ui/react';
import { ParkAvatar, ParkAvatarFallback, ParkButton, ParkEmptyState, ParkField, ParkInput, ParkPinInput, ParkPinInputSlot, ParkScrollArea, ParkSelect, ParkSplitter, ParkTabs, ParkTextarea } from '../park';

if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
if (!window.IntersectionObserver) {
  window.IntersectionObserver = class {
    readonly root = null;
    readonly rootMargin = '';
    readonly thresholds: number[] = [];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  } as unknown as typeof IntersectionObserver;
}

describe('Park-compatible shared primitives', () => {
  it('provides styled native controls without changing form semantics', () => {
    render(<form aria-label="Park form"><ParkField label="Name"><ParkInput name="name" aria-label="Name" required /></ParkField><ParkSelect name="priority" aria-label="Priority" defaultValue="normal"><option value="normal">Normal</option><option value="high">High</option></ParkSelect><ParkTextarea name="details" aria-label="Details" /><ParkButton type="submit">Save</ParkButton></form>);
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveAttribute('data-park', 'input');
    expect(screen.getByRole('textbox', { name: 'Details' })).toHaveAttribute('data-park', 'textarea');
    expect(screen.getByRole('combobox', { name: 'Priority' })).toHaveAttribute('data-park', 'select');
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('data-park', 'button');
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeRequired();
  });

  it('uses Ark anatomy for pin input and avatar', () => {
    render(<><ParkPinInput label="Verification code" count={4}>{[0, 1, 2, 3].map(index => <ParkPinInputSlot key={index} index={index} />)}</ParkPinInput><ParkAvatar><ParkAvatarFallback>TC</ParkAvatarFallback></ParkAvatar></>);
    expect(screen.getByText('Verification code')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-scope="pin-input"][data-part="input"]')).toHaveLength(4);
    expect(screen.getByText('TC')).toBeInTheDocument();
  });

  it('renders empty state as a labelled region with optional action', () => {
    render(<ParkEmptyState title="No tickets" description="Your queue is empty." action={<ParkButton>Refresh</ParkButton>} />);
    expect(screen.getByRole('region', { name: 'No tickets' })).toHaveAttribute('data-park', 'empty-state');
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });

  it('exposes real Ark Select anatomy while retaining the native compatibility entry point', () => {
    const collection = createListCollection({ items: [{ label: 'Normal', value: 'normal' }] });
    render(<ParkSelect.Root collection={collection as never} defaultValue={['normal']}>
      <ParkSelect.Label>Priority</ParkSelect.Label>
      <ParkSelect.Control><ParkSelect.Trigger><ParkSelect.ValueText placeholder="Choose priority" /></ParkSelect.Trigger><ParkSelect.Indicator>⌄</ParkSelect.Indicator></ParkSelect.Control>
      <ParkSelect.HiddenSelect />
      <ParkSelect.Positioner><ParkSelect.Content><ParkSelect.List>{collection.items.map(item => <ParkSelect.Item key={item.value} item={item}><ParkSelect.ItemText>{item.label}</ParkSelect.ItemText></ParkSelect.Item>)}</ParkSelect.List></ParkSelect.Content></ParkSelect.Positioner>
    </ParkSelect.Root>);
    expect(screen.getAllByRole('combobox', { name: 'Priority' }).find(element => element.getAttribute('data-park') === 'select-trigger')).toBeTruthy();
    expect(document.querySelector('[data-park="select-content"]')).toBeInTheDocument();
  });

  it('marks Ark Tabs, ScrollArea and Splitter anatomy for Park styling', () => {
    render(<>
      <ParkTabs.Root defaultValue="inbox"><ParkTabs.List><ParkTabs.Trigger value="inbox">Inbox</ParkTabs.Trigger></ParkTabs.List><ParkTabs.Content value="inbox">Messages</ParkTabs.Content></ParkTabs.Root>
      <ParkScrollArea.Root><ParkScrollArea.Viewport><ParkScrollArea.Content>Scrollable</ParkScrollArea.Content></ParkScrollArea.Viewport></ParkScrollArea.Root>
      <ParkSplitter.Root size={[40, 60]} panels={[{ id: 'list' }, { id: 'detail' }]}><ParkSplitter.Panel id="list">List</ParkSplitter.Panel><ParkSplitter.ResizeTrigger id="list:detail" /><ParkSplitter.Panel id="detail">Detail</ParkSplitter.Panel></ParkSplitter.Root>
    </>);
    expect(document.querySelector('[data-park="tabs-root"]')).toBeInTheDocument();
    expect(document.querySelector('[data-park="scroll-area-viewport"]')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-park="splitter-panel"]')).toHaveLength(2);
    expect(document.querySelector('[data-park="splitter-resize-trigger"]')).toBeInTheDocument();
  });
});
