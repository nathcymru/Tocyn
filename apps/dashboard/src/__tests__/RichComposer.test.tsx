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
  expect(screen.getByText('const safe = true;')).toBeInTheDocument();
});

it('keeps approved HTTP links readable and isolated from the opener', () => {
  render(<SafeMarkdown children={'[Tocyn](https://example.invalid/help)'} />);
  const link = screen.getByRole('link', { name: 'Tocyn' });
  expect(link).toHaveAttribute('href', 'https://example.invalid/help');
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
});

it('inserts a bounded slash command and emoji through keyboard-addressable controls', () => {
  function ControlledComposer() {
    const [value, setValue] = useState('Hello ');
    return <RichComposer id="rich-composer-test" value={value} onChange={setValue} onImageFiles={() => undefined} onRejectedImageFiles={() => undefined} readOnly={false} mode="public" />;
  }
  render(<ControlledComposer />);
  const textarea = screen.getByRole('textbox', { name: 'Reply message' }) as HTMLTextAreaElement;
  textarea.focus(); textarea.setSelectionRange(6, 6);
  fireEvent.select(textarea);
  fireEvent.click(screen.getByRole('button', { name: 'Insert command' }));
  fireEvent.click(screen.getByRole('button', { name: '/Greeting' }));
  expect(textarea).toHaveValue('Hello Hello,\n\n');
  fireEvent.click(screen.getByRole('button', { name: 'Insert emoji' }));
  fireEvent.click(screen.getByRole('button', { name: 'Insert ✅' }));
  expect(textarea).toHaveValue('Hello Hello,\n\n✅');
});

it('closes an ordinary disclosure with Escape and returns focus to its trigger', async () => {
  render(<RichComposer id="escape-test" value="" onChange={() => undefined} onImageFiles={() => undefined} onRejectedImageFiles={() => undefined} readOnly={false} mode="public" />);
  const trigger = screen.getByRole('button', { name: 'Insert command' });
  fireEvent.click(trigger);
  const choice = screen.getByRole('button', { name: '/Greeting' });
  choice.focus(); fireEvent.keyDown(choice, { key: 'Escape' });
  expect(screen.queryByRole('button', { name: '/Greeting' })).not.toBeInTheDocument();
  await waitFor(() => expect(trigger).toHaveFocus());
});

it('fences editor and already-open insert controls when composition becomes read-only', () => {
  const onChange = vi.fn();
  function ControlledReadOnlyComposer() {
    const [readOnly, setReadOnly] = useState(false);
    return <><button type="button" onClick={() => setReadOnly(true)}>Lock composer</button><RichComposer id="readonly-test" value="draft" onChange={onChange} onImageFiles={() => undefined} onRejectedImageFiles={() => undefined} readOnly={readOnly} mode="public" /></>;
  }
  render(<ControlledReadOnlyComposer />);
  fireEvent.click(screen.getByRole('button', { name: 'Insert command' }));
  const choice = screen.getByRole('button', { name: '/Greeting' });
  fireEvent.click(screen.getByRole('button', { name: 'Lock composer' }));
  expect(choice).toBeDisabled();
  fireEvent.click(choice);
  fireEvent.click(screen.getByRole('button', { name: 'Add bold text (ctrl + b)' }));
  expect(screen.getByRole('textbox', { name: 'Reply message' })).toHaveValue('draft');
  fireEvent.change(screen.getByRole('textbox', { name: 'Reply message' }), { target: { value: 'changed after lock' } });
  expect(onChange).not.toHaveBeenCalled();
});

it('keeps cursor insertion scoped to its own composer instance', () => {
  function TwoComposers() {
    const [first, setFirst] = useState('first'); const [second, setSecond] = useState('second');
    return <><RichComposer id="first-composer" value={first} onChange={setFirst} onImageFiles={() => undefined} onRejectedImageFiles={() => undefined} readOnly={false} mode="public" /><RichComposer id="second-composer" value={second} onChange={setSecond} onImageFiles={() => undefined} onRejectedImageFiles={() => undefined} readOnly={false} mode="public" /></>;
  }
  render(<TwoComposers />);
  const first = screen.getAllByRole('textbox', { name: 'Reply message' })[0] as HTMLTextAreaElement;
  first.focus(); first.setSelectionRange(0, 0); fireEvent.select(first);
  fireEvent.click(screen.getAllByRole('button', { name: 'Insert emoji' })[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Insert ✅' }));
  expect(first).toHaveValue('✅first');
  expect(screen.getAllByRole('textbox', { name: 'Reply message' })[1]).toHaveValue('second');
});
