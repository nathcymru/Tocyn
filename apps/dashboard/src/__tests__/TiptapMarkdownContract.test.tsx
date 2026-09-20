import { fireEvent, render, screen } from '@testing-library/react';
import { MarkdownManager } from '@tiptap/markdown';
import { Editor } from '@tiptap/core';
import { expect, it, vi } from 'vitest';
import { RichComposer, TIPTAP_MARKDOWN_CONTRACT } from '../components/RichComposer';
import { tocynMarkdownExtensions } from '../components/tiptap-markdown';

function roundTrip(markdown: string) {
  const manager = new MarkdownManager({ extensions: tocynMarkdownExtensions });
  const document = manager.parse(markdown);
  return { document, markdown: manager.serialize(document) };
}

it('round-trips declared task lists and checked task items', () => {
  expect(TIPTAP_MARKDOWN_CONTRACT.nodes).toContain('taskList');
  expect(TIPTAP_MARKDOWN_CONTRACT.nodes).toContain('taskItem');
  const result = roundTrip('- [x] Done\n- [ ] Pending');
  expect(result.document.content?.[0]?.type).toBe('taskList');
  expect(result.document.content?.[0]?.content?.map(item => item.attrs?.checked)).toEqual([true, false]);
  expect(result.markdown).toContain('[x] Done');
  expect(result.markdown).toContain('[ ] Pending');
});

it('round-trips a local accepted inline-image reference without fetching it', () => {
  expect(TIPTAP_MARKDOWN_CONTRACT.nodes).toContain('image');
  const reference = '/api/attachments/synthetic-image.png';
  const result = roundTrip(`Before ![Synthetic diagram](${reference}) after`);
  expect(result.document.content?.[0]?.content?.[1]?.type).toBe('image');
  expect(result.markdown).toContain(`![Synthetic diagram](${reference})`);
});

it('retains text from unsupported GFM tables rather than silently discarding it', () => {
  const result = roundTrip('| A | B |\n| --- | --- |\n| one | two |');
  expect(result.document.content?.[0]?.type).toBe('literalTable');
  for (const text of ['A', 'B', 'one', 'two']) expect(result.markdown).toContain(text);
  expect(roundTrip(result.markdown).document.content?.[0]?.type).toBe('literalTable');
});

it('keeps supported marks and link title on a second round trip', () => {
  const source = '**bold** *italic* ~~strike~~ `code` [reference](https://example.invalid/help "Help title")';
  const first = roundTrip(source);
  expect(first.markdown).toContain('**bold**');
  expect(first.markdown).toContain('*italic*');
  expect(first.markdown).toContain('~~strike~~');
  expect(first.markdown).toContain('`code`');
  expect(first.markdown).toContain('[reference](https://example.invalid/help "Help title")');
  expect(roundTrip(first.markdown).document).toEqual(first.document);
});

it('round-trips headings, quotes, lists, code, rules and hard breaks', () => {
  const source = '# Heading\n\n> Quote\n\n- Bullet\n\n1. Ordered\n\n```ts\nconst value = 1\n```\n\n---\n\nFirst  \nsecond';
  const first = roundTrip(source);
  expect(first.document.content?.map(node => node.type)).toEqual([
    'heading', 'blockquote', 'bulletList', 'orderedList', 'codeBlock', 'horizontalRule', 'paragraph',
  ]);
  expect(first.document.content?.at(-1)?.content?.some(node => node.type === 'hardBreak')).toBe(true);
  expect(roundTrip(first.markdown).document).toEqual(first.document);
});

it('renders a remote Markdown image as text without a fetching img element', () => {
  const editor = new Editor({
    extensions: tocynMarkdownExtensions,
    content: 'Before ![Synthetic diagram](https://example.invalid/pixel.png) after',
    contentType: 'markdown',
  });
  try {
    expect(editor.getMarkdown()).toContain('![Synthetic diagram](https://example.invalid/pixel.png)');
    expect(editor.view.dom.querySelector('img')).toBeNull();
    expect(editor.view.dom.querySelector('[data-tocyn-image]')).toHaveTextContent('[Image omitted: Synthetic diagram]');
  } finally {
    editor.destroy();
  }
});

it('renders HTTP and HTTPS Markdown links with their destination and title intact', () => {
  const source = '[Secure](https://example.invalid/help "Help title") and [Plain](http://example.invalid/help)';
  const editor = new Editor({ extensions: tocynMarkdownExtensions, content: source, contentType: 'markdown' });
  try {
    expect(editor.getMarkdown()).toContain('[Secure](https://example.invalid/help "Help title")');
    const links = Array.from(editor.view.dom.querySelectorAll('a'));
    expect(links.map(link => link.getAttribute('href'))).toEqual(['https://example.invalid/help', 'http://example.invalid/help']);
    expect(links[0]).toHaveAttribute('title', 'Help title');
    expect(links[0]).toHaveAttribute('rel', expect.stringContaining('noopener'));
  } finally {
    editor.destroy();
  }
});

it.each([
  '[Mail](mailto:person@example.invalid)',
  '[Script](javascript:alert(1))',
  '[Relative](/help)',
  '[Protocol relative](//example.invalid/help)',
  '[Credentials](https://user:password@example.invalid/help)',
])('keeps unsupported link text without an actionable href: %s', source => {
  const editor = new Editor({ extensions: tocynMarkdownExtensions, content: source, contentType: 'markdown' });
  try {
    expect(editor.view.dom.querySelector('a[href]')).toBeNull();
    expect(editor.view.dom.querySelector('[data-tocyn-inert-link]')).not.toBeNull();
    expect(editor.getMarkdown()).toBe(source);
  } finally {
    editor.destroy();
  }
});

it('does not parse raw HTML img markup into an image node', () => {
  const result = roundTrip('<img src="https://example.invalid/pixel.png" alt="remote">');
  expect(result.document.content?.[0]?.type).not.toBe('image');
  expect(result.markdown).not.toContain('![remote]');
});

it('keeps plain mode literal through the rendered textarea and change callback', () => {
  const onChange = vi.fn();
  render(<RichComposer id="plain-contract" value={'**literal**\n| A | B |'} format="plain"
    onChange={onChange} onImageFiles={() => undefined} onRejectedImageFiles={() => undefined}
    readOnly={false} mode="public" />);
  const input = screen.getByRole('textbox', { name: 'Reply message' });
  expect(input).toHaveValue('**literal**\n| A | B |');
  fireEvent.change(input, { target: { value: '~~still literal~~\n| one | two |' } });
  expect(onChange).toHaveBeenCalledWith('~~still literal~~\n| one | two |');
});
