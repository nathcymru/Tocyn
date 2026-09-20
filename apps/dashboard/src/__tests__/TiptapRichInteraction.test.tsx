import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, it } from 'vitest';
import { RichComposer, TiptapMarkdownField } from '../components/RichComposer';

it('disables knowledge formatting actions while the editor is read-only', () => {
  render(<TiptapMarkdownField id="knowledge-readonly" value="**Saved**" onChange={() => undefined} readOnly />);
  expect(screen.getByRole('textbox', { name: 'Content (Markdown)' })).toHaveAttribute('contenteditable', 'false');
  for (const name of ['Add bold text (ctrl + b)', 'Add italic text (ctrl + i)', 'Add heading', 'Add bullet list', 'Add code block']) {
    expect(screen.getByRole('button', { name })).toBeDisabled();
  }
});

it('disables reply formatting actions while the composer is read-only', () => {
  render(<RichComposer id="reply-readonly" value="**Saved**" onChange={() => undefined}
    onImageFiles={() => undefined} onRejectedImageFiles={() => undefined} readOnly mode="public" />);
  expect(screen.getByRole('textbox', { name: 'Reply message' })).toHaveAttribute('contenteditable', 'false');
  for (const name of ['Add bold text (ctrl + b)', 'Add italic text (ctrl + i)', 'Add heading',
    'Add bullet list', 'Add numbered list', 'Add code block', 'Add inline code', 'Add link']) {
    expect(screen.getByRole('button', { name })).toBeDisabled();
  }
});

it('preserves an existing bold mark after a user applies italic formatting', async () => {
  function ControlledComposer() {
    const [value, setValue] = useState('**Bold text**');
    return <RichComposer id="rich-mark-edit" value={value} onChange={setValue}
      onImageFiles={() => undefined} onRejectedImageFiles={() => undefined} readOnly={false} mode="public" />;
  }
  render(<ControlledComposer />);
  const editor = screen.getByRole('textbox', { name: 'Reply message' });
  const bold = editor.querySelector('strong');
  expect(bold).toHaveTextContent('Bold text');
  expect(screen.getByRole('button', { name: 'Add italic text (ctrl + i)' })).toHaveClass('button--variant_plain');
  editor.focus();
  const range = document.createRange();
  range.selectNodeContents(bold!);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  fireEvent(document, new Event('selectionchange'));
  await userEvent.click(screen.getByRole('button', { name: 'Add italic text (ctrl + i)' }));
  await waitFor(() => expect(editor.querySelector('strong em, em strong')).toHaveTextContent('Bold text'));
  expect(screen.getByRole('button', { name: 'Add italic text (ctrl + i)' })).toHaveClass('button--variant_solid');
  // A browser input notification must not convert the marked Tiptap document
  // back into unformatted text merely because its textContent is unchanged.
  fireEvent.input(editor);
  expect(editor.querySelector('strong em, em strong')).toHaveTextContent('Bold text');
});

it('stores one autocomplete insertion without removing earlier rich marks', async () => {
  function ControlledComposer() {
    const [value, setValue] = useState('**Bold** ');
    return <><output data-testid="stored-markdown">{value}</output><RichComposer id="marked-autocomplete" value={value} onChange={setValue}
      onImageFiles={() => undefined} onRejectedImageFiles={() => undefined} readOnly={false} mode="public" /></>;
  }
  render(<ControlledComposer />);
  const editor = screen.getByRole('textbox', { name: 'Reply message' });
  const paragraph = editor.querySelector('p')!;
  const end = paragraph.lastChild!;
  editor.focus();
  const range = document.createRange();
  range.selectNodeContents(end);
  range.collapse(false);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  fireEvent(document, new Event('selectionchange'));
  await userEvent.type(editor, '/g', { skipClick: true });
  expect(screen.getByRole('listbox', { name: 'Slash command suggestions' })).toBeInTheDocument();
  fireEvent.keyDown(editor, { key: 'Enter' });
  await waitFor(() => expect(screen.getByTestId('stored-markdown')).toHaveTextContent('Hello,'));
  const stored = screen.getByTestId('stored-markdown').textContent ?? '';
  expect(stored).toContain('**Bold**');
  expect(stored.match(/Hello,/g)).toHaveLength(1);
  expect(editor.querySelector('strong')).toHaveTextContent('Bold');
});

it('keeps the caret in place while controlled knowledge content updates', async () => {
  function ControlledKnowledge() {
    const [value, setValue] = useState('abc');
    return <><output data-testid="knowledge-markdown">{value}</output><TiptapMarkdownField id="knowledge-caret" value={value} onChange={setValue} readOnly={false} /></>;
  }
  render(<ControlledKnowledge />);
  const editor = screen.getByRole('textbox', { name: 'Content (Markdown)' });
  const text = editor.querySelector('p')?.firstChild;
  expect(text).not.toBeNull();
  editor.focus();
  const range = document.createRange();
  range.setStart(text!, 1);
  range.collapse(true);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  fireEvent(document, new Event('selectionchange'));
  await userEvent.type(editor, 'XY', { skipClick: true });
  expect(screen.getByTestId('knowledge-markdown').textContent).toBe('aXYbc');
});
