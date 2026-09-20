import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FiltersSettingsPage } from '../pages/FiltersSettingsPage';

const filters = vi.hoisted(() => ({
  useFilters: vi.fn(),
  useCreateFilter: vi.fn(),
  useUpdateFilter: vi.fn(),
  useDeleteFilter: vi.fn(),
}));

vi.mock('../hooks/useFilters', () => ({
  useFilters: filters.useFilters,
  useCreateFilter: filters.useCreateFilter,
  useUpdateFilter: filters.useUpdateFilter,
  useDeleteFilter: filters.useDeleteFilter,
}));

beforeEach(() => {
  filters.useFilters.mockReturnValue({ data: [], isLoading: false });
  filters.useCreateFilter.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  filters.useUpdateFilter.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  filters.useDeleteFilter.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });

  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
    return (this.isConnected && !this.closest('[hidden]')
      ? [new DOMRect(0, 0, 100, 44)]
      : []) as unknown as DOMRectList;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

it('renders system and custom filters and hides delete for system rows', () => {
  filters.useFilters.mockReturnValue({
    isLoading: false,
    data: [
      { id: 'system-open', name: 'System open', is_system: 1, conditions: [] },
      { id: 'custom-open', name: 'My open', is_system: 0, conditions: [] },
    ],
  });

  render(<FiltersSettingsPage />);

  expect(screen.getByText('System open')).toBeInTheDocument();
  expect(screen.getByText('My open')).toBeInTheDocument();
  expect(screen.getAllByText('System')).toHaveLength(2);
  expect(screen.getAllByText('Custom')).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Delete My open' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Delete System open' })).toBeNull();
  const table = screen.getByRole('table');
  expect(table.querySelector('tbody tr td')).toBeInTheDocument();
  expect(table.querySelector('tbody tr')?.className).not.toMatch(/d_flex|display_flex/);
  expect(screen.getByRole('button', { name: 'Edit My open' })).toBeInTheDocument();
});

it('renders loading state when filters are being fetched', () => {
  filters.useFilters.mockReturnValue({ isLoading: true, data: undefined });

  render(<FiltersSettingsPage />);

  expect(screen.getByText('Loading filters...')).toBeInTheDocument();
});

it('uses an actionable Park empty state when no filters exist', async () => {
  render(<FiltersSettingsPage />);

  const empty = screen.getByRole('region', { name: 'No filters created yet.' });
  fireEvent.click(screen.getByRole('button', { name: 'Create filter' }));
  expect(empty).toBeInTheDocument();
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
});

it('offers an explicit retry when saved filters fail to load', () => {
  const refetch = vi.fn();
  filters.useFilters.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });
  render(<FiltersSettingsPage />);
  expect(screen.getByRole('alert')).toHaveTextContent('Filters could not be loaded');
  fireEvent.click(screen.getByRole('button', { name: 'Retry filters' }));
  expect(refetch).toHaveBeenCalledOnce();
});
