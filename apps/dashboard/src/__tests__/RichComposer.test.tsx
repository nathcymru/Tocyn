import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { acceptedComposerImages, COMPOSER_MAX_IMAGE_BYTES, insertMarkdownAtCursor, RichComposer, SafeMarkdown } from '../components/RichComposer';

it('inserts bounded composer content at the selected range', () => {
  expect(insertMarkdownAtCursor('Hello customer', 'team ', 6, 6)).toBe('Hello team customer');
  expect(insertMarkdownAtCursor('Hello customer', 'operator', 6, 14)).toBe('Hello operator');
});

it('accepts only the image types and size accepted by the authenticated upload route', () => {
  const accepted = { type: 'image/png', size: COMPOSER_MAX_IMAGE_BYTES } as File;
  const oversized = { type: 'image/png', size: COMPOSER_MAX_IMAGE_BYTES + 1 } as File;
  const unsupported = { type: 'image/svg+xml', size: 10 } as File;
  expect(acceptedComposerImages([accepted, oversized, unsupported])).toEqual([accepted]);
});

it('renders Markdown without executing HTML, unsafe links, or remote images', () => {
  render(<SafeMarkdown children={'<img src="https://tracker.invalid/pixel" onerror="alert(1)" />\n\n[unsafe](javascript:alert(1))\n\n![remote](https://tracker.invalid/pixel)\n\n```ts\nconst safe = true;\n```'} />);

  expect(document.querySelector('img')).not.toBeInTheDocument();
  expect(document.querySelector('[onerror]')).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'unsafe' })).not.toBeInTheDocument();
  expect(screen.getByText('[Image omitted: remote]')).toBeInTheDocument();
  expect(document.querySelector('pre code')).toHaveTextContent('const safe = true;');
});

it('highlights supported fenced code after sanitization and leaves code HTML as text', () => {
  const { container } = render(<SafeMarkdown>{'```ts\nconst safe = true;\n```\n\n```not-a-language\n<img src="https://tracker.invalid/pixel" onerror="alert(1)">\n```'}</SafeMarkdown>);
  const highlighted = container.querySelector('code.language-ts');
  expect(highlighted).toHaveClass('code-highlight', 'tocyn-markdown-code-block');
  expect(highlighted?.querySelector('.token.keyword')).toHaveTextContent('const');
  const fallback = container.querySelector('code.language-not-a-language');
  expect(fallback).toHaveTextContent('<img src="https://tracker.invalid/pixel" onerror="alert(1)">');
  expect(fallback?.querySelector('.token')).toBeNull();
  expect(container.querySelector('img')).toBeNull();
  expect(container.querySelector('[onerror]')).toBeNull();
});

it('keeps approved HTTP links readable and isolated from the opener', () => {
  render(<SafeMarkdown children={'[Tocyn](https://example.invalid/help)'} />);
  const link = screen.getByRole('link', { name: 'Tocyn' });
  expect(link).toHaveAttribute('href', 'https://example.invalid/help');
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
});

it('autocompletes bounded slash commands and emoji with keyboard controls', () => {
  function ControlledComposer() {
    const [value, setValue] = useState('');
    return <RichComposer id="rich-composer-test" value={value} onChange={setValue} onImageFiles={() => undefined} onRejectedImageFiles={() => undefined} readOnly={false} mode="public" />;
  }
  render(<ControlledComposer />);
  const textarea = screen.getByRole('textbox', { name: 'Reply message' }) as HTMLTextAreaElement;
  fireEvent.change(textarea, { target: { value: '/g', selectionStart: 2, selectionEnd: 2 } });
  expect(screen.getByRole('listbox', { name: 'Slash command suggestions' })).toBeInTheDocument();
  expect(textarea).toHaveAttribute('aria-activedescendant');
  fireEvent.keyDown(textarea, { key: 'Enter' });
  expect(textarea).toHaveValue('Hello,\n\n');
  fireEvent.change(textarea, { target: { value: ':ch', selectionStart: 3, selectionEnd: 3 } });
  expect(screen.getByRole('listbox', { name: 'Emoji suggestions' })).toBeInTheDocument();
  fireEvent.keyDown(textarea, { key: 'Enter' });
  expect(textarea).toHaveValue('✅');
});

it('moves an autocomplete suggestion with arrows and closes it with Escape without losing focus', async () => {
  function ControlledComposer() {
    const [value, setValue] = useState('');
    return <RichComposer id="escape-test" value={value} onChange={setValue} onImageFiles={() => undefined} onRejectedImageFiles={() => undefined} readOnly={false} mode="public" />;
  }
  render(<ControlledComposer />);
  const textarea = screen.getByRole('textbox', { name: 'Reply message' }) as HTMLTextAreaElement;
  textarea.focus();
  fireEvent.change(textarea, { target: { value: '/', selectionStart: 1, selectionEnd: 1 } });
  await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2));
  const firstId = textarea.getAttribute('aria-activedescendant');
  fireEvent.keyDown(textarea, { key: 'ArrowDown' });
  expect(textarea.getAttribute('aria-activedescendant')).not.toBe(firstId);
  fireEvent.keyDown(textarea, { key: 'Escape' });
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  expect(textarea).toHaveFocus();
});

it('inserts caller-supplied knowledge and saved-response entries and reports their typed callbacks', () => {
  const onKnowledgeInserted = vi.fn();
  const onSavedResponseInserted = vi.fn();
  const knowledge = { id: 'kb-reset', label: 'Reset password', markdown: 'Use the reset link.' };
  const savedResponse = { id: 'saved-hours', label: 'Support hours', markdown: 'We are available Monday to Friday.' };
  function ControlledComposer() {
    const [value, setValue] = useState('');
    return <RichComposer id="insertion-hooks" value={value} onChange={setValue} onImageFiles={() => undefined} onRejectedImageFiles={() => undefined} readOnly={false} mode="public"
      knowledge={[knowledge]} savedResponses={[savedResponse]} onKnowledgeInserted={onKnowledgeInserted} onSavedResponseInserted={onSavedResponseInserted} />;
  }
  render(<ControlledComposer />);
  const textarea = screen.getByRole('textbox', { name: 'Reply message' }) as HTMLTextAreaElement;
  fireEvent.change(textarea, { target: { value: '/reset', selectionStart: 6, selectionEnd: 6 } });
  fireEvent.keyDown(textarea, { key: 'Enter' });
  expect(textarea).toHaveValue('Use the reset link.');
  expect(onKnowledgeInserted).toHaveBeenCalledWith(knowledge);
  fireEvent.change(textarea, { target: { value: '/hours', selectionStart: 6, selectionEnd: 6 } });
  fireEvent.keyDown(textarea, { key: 'Enter' });
  expect(textarea).toHaveValue('We are available Monday to Friday.');
  expect(onSavedResponseInserted).toHaveBeenCalledWith(savedResponse);
});

it('fences editor and already-open insert controls when composition becomes read-only', () => {
  const onChange = vi.fn();
  function ControlledReadOnlyComposer() {
    const [readOnly, setReadOnly] = useState(false);
    return <><button type="button" onClick={() => setReadOnly(true)}>Lock composer</button><RichComposer id="readonly-test" value="draft" onChange={onChange} onImageFiles={() => undefined} onRejectedImageFiles={() => undefined} readOnly={readOnly} mode="public" /></>;
  }
  render(<ControlledReadOnlyComposer />);
  const textarea = screen.getByRole('textbox', { name: 'Reply message' });
  fireEvent.change(textarea, { target: { value: '/', selectionStart: 1, selectionEnd: 1 } });
  expect(screen.getByRole('listbox')).toBeInTheDocument();
  onChange.mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'Lock composer' }));
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Add bold text (ctrl + b)' }));
  expect(textarea).toHaveValue('draft');
  fireEvent.change(textarea, { target: { value: 'changed after lock' } });
  expect(onChange).not.toHaveBeenCalled();
});

it('keeps cursor insertion scoped to its own composer instance', () => {
  function TwoComposers() {
    const [first, setFirst] = useState('first'); const [second, setSecond] = useState('second');
    return <><RichComposer id="first-composer" value={first} onChange={setFirst} onImageFiles={() => undefined} onRejectedImageFiles={() => undefined} readOnly={false} mode="public" /><RichComposer id="second-composer" value={second} onChange={setSecond} onImageFiles={() => undefined} onRejectedImageFiles={() => undefined} readOnly={false} mode="public" /></>;
  }
  render(<TwoComposers />);
  const first = screen.getAllByRole('textbox', { name: 'Reply message' })[0] as HTMLTextAreaElement;
  fireEvent.change(first, { target: { value: ':chfirst', selectionStart: 3, selectionEnd: 3 } });
  fireEvent.keyDown(first, { key: 'Enter' });
  expect(first).toHaveValue('✅first');
  expect(screen.getAllByRole('textbox', { name: 'Reply message' })[1]).toHaveValue('second');
});
