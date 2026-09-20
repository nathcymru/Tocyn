import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it } from 'vitest';
import { PRODUCT_BRAND } from '@luminatick/shared/product-brand';
import { Layout } from '../components/Layout';
import { useAuthStore } from '../store/authStore';

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('dark');
  useAuthStore.getState().logout();
});

it('renders one portal lockup and follows the document Park theme', async () => {
  useAuthStore.getState().login({ id: 'customer', name: 'Customer', email: 'customer@example.test' });
  render(<MemoryRouter initialEntries={['/tickets']}><Routes>
    <Route element={<Layout />}><Route path="/tickets" element={<p>Tickets</p>} /></Route>
  </Routes></MemoryRouter>);

  const brand = screen.getByRole('link', { name: 'Tocyn Portal' });
  expect(brand).toHaveClass('link', 'link--variant_plain');
  expect(brand).toHaveAttribute('href', '/tickets');
  expect(brand.querySelectorAll('img')).toHaveLength(1);
  expect(screen.getByRole('img', { name: 'Tocyn' })).toHaveAttribute('src', PRODUCT_BRAND.lockup.light);

  act(() => document.documentElement.classList.add('dark'));
  await waitFor(() => expect(screen.getByRole('img', { name: 'Tocyn' })).toHaveAttribute('src', PRODUCT_BRAND.lockup.dark));
  expect(brand.querySelectorAll('img')).toHaveLength(1);
});

it('uses the Park Link recipe while retaining client-side portal navigation', async () => {
  useAuthStore.getState().login({ id: 'customer', name: 'Customer', email: 'customer@example.test' });
  render(<MemoryRouter initialEntries={['/tickets/else']}><Routes>
    <Route element={<Layout />}>
      <Route path="/tickets" element={<p>Tickets destination</p>} />
      <Route path="/tickets/else" element={<p>Another portal route</p>} />
    </Route>
  </Routes></MemoryRouter>);
  const brand = screen.getByRole('link', { name: 'Tocyn Portal' });
  expect(brand).toHaveClass('link', 'link--variant_plain');
  await userEvent.click(brand);
  expect(screen.getByText('Tickets destination')).toBeInTheDocument();
});
