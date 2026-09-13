import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { expect, it } from 'vitest';
import { TableColumnsControl } from '../components/theme/OperatorThemeProvider';
import type { OperatorTableColumn } from '../hooks/useOperatorPreferences';

function Harness() {
  const [tableColumns, setColumns] = useState<readonly OperatorTableColumn[]>(['reference', 'updated']);
  return <TableColumnsControl preferences={{ tableColumns, update: changes => {
    if (changes.tableColumns) setColumns(changes.tableColumns);
  } }} />;
}

it('retains focus on the moved column at both boundaries and announces its position', () => {
  render(<Harness />);
  const up = screen.getByRole('button', { name: 'Move updated table column up' });
  up.focus();
  fireEvent.click(up);
  const down = screen.getByRole('button', { name: 'Move updated table column down' });
  expect(up).toBeDisabled();
  expect(down).toHaveFocus();
  expect(screen.getByRole('status')).toHaveTextContent('updated moved to column 1 of 2.');
  fireEvent.keyDown(down, { key: 'ArrowDown' });
  expect(down).toBeDisabled();
  expect(up).toHaveFocus();
  expect(screen.getByRole('status')).toHaveTextContent('updated moved to column 2 of 2.');
  expect(screen.getByRole('checkbox', { name: 'reference', exact: true })).toBeDisabled();
});
