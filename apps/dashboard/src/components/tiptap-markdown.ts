import { Node } from '@tiptap/core';
import { Image } from '@tiptap/extension-image';
import { Link } from '@tiptap/extension-link';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return false;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function isSafeClipboardImageSource(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) return false;
  if (value.startsWith('//') || value.startsWith('\\')) return false;
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) return isHttpUrl(value);
  return true;
}

/** Preserve legacy Markdown text, but only explicit web URLs become clickable. */
const SafeHttpLink = Link.extend({
  renderHTML({ HTMLAttributes }) {
    const href = HTMLAttributes.href;
    if (!isHttpUrl(href)) return ['span', { 'data-tocyn-inert-link': '' }, 0];
    return ['a', {
      href,
      target: '_blank',
      rel: 'noopener noreferrer nofollow',
      ...(typeof HTMLAttributes.title === 'string' ? { title: HTMLAttributes.title } : {}),
    }, 0];
  },
}).configure({ isAllowedUri: uri => isHttpUrl(uri) });

/** Keep Markdown image references round-trippable without creating a fetching img element. */
const SafeInlineImage = Image.extend({
  parseHTML() {
    return [{
      tag: 'span[data-tocyn-image="placeholder"][data-tocyn-image-src]',
      getAttrs: element => {
        const src = element.getAttribute('data-tocyn-image-src');
        const alt = element.getAttribute('data-tocyn-image-alt') ?? '';
        if (!isSafeClipboardImageSource(src) || element.getAttribute('role') !== 'note'
          || element.textContent !== `[Image omitted${alt ? `: ${alt}` : ''}]`) return false;
        return { src, alt, title: element.getAttribute('data-tocyn-image-title') };
      },
    }];
  },
  renderHTML({ node }) {
    const alt = typeof node.attrs.alt === 'string' ? node.attrs.alt : '';
    const attrs: Record<string, string> = { 'data-tocyn-image': 'placeholder', 'data-tocyn-image-alt': alt, role: 'note' };
    if (isSafeClipboardImageSource(node.attrs.src)) attrs['data-tocyn-image-src'] = node.attrs.src;
    if (typeof node.attrs.title === 'string') attrs['data-tocyn-image-title'] = node.attrs.title;
    return ['span', attrs, `[Image omitted${alt ? `: ${alt}` : ''}]`];
  },
}).configure({ inline: true, allowBase64: false });

/** Unsupported GFM tables remain visible literal text instead of disappearing on parse. */
const LiteralTable = Node.create({
  name: 'literalTable',
  group: 'block',
  content: 'text*',
  code: true,
  parseHTML() {
    return [{ tag: 'pre[data-literal-table]' }];
  },
  renderHTML() {
    return ['pre', { 'data-literal-table': '', role: 'note' }, 0];
  },
  markdownTokenName: 'table',
  parseMarkdown(token, helpers) {
    return helpers.createNode('literalTable', {}, [helpers.createTextNode((token.raw ?? '').trimEnd())]);
  },
  renderMarkdown(node) {
    return (node.content ?? []).map(child => child.text ?? '').join('');
  },
});

/** Shared by the reply composer and knowledge editor to prevent Markdown drift. */
export const tocynMarkdownExtensions = [StarterKit.configure({ link: false }), SafeHttpLink, TaskList, TaskItem, SafeInlineImage, LiteralTable, Markdown];
