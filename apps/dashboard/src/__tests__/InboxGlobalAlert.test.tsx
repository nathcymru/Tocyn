import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { InboxGlobalAlertProvider, useInboxGlobalAlert } from '../components/InboxGlobalAlert';

afterEach(cleanup);

function Trigger() {
  const setAlert = useInboxGlobalAlert();
  return <button type="button" onClick={() => setAlert({ count: 2, scope: 'All tickets' })}>Show inbox alert</button>;
}

it('uses Park Alert anatomy and keeps the assertive notice dismissible in document flow', () => {
  render(<InboxGlobalAlertProvider><Trigger /><p>Workspace remains available</p></InboxGlobalAlertProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Show inbox alert' }));
  const alert = screen.getByRole('alert');
  expect(alert).toHaveClass('alert__root', 'alert__root--status_error', 'alert__root--variant_surface');
  expect(alert).toHaveAttribute('aria-live', 'assertive');
  expect(alert.querySelector('.alert__description')).toHaveTextContent('Action required: 2 overdue unassigned conversations in All tickets.');
  expect(alert.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  expect(screen.getByText('Workspace remains available')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss inbox alert' }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByText('Workspace remains available')).toBeInTheDocument();
});
