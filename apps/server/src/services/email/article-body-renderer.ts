import {
  articleBodyFormat,
  type ArticleBodyFormat,
} from '@luminatick/shared';
import type { Article } from '../../types';

export type RenderedArticleBody = Readonly<{ html: string; text: string }>;
type RenderedInline = Readonly<{ html: string; text: string }>;

const MAX_MARKDOWN_V1_BODY_BYTES = 16_000;
const MAX_MARKDOWN_V1_BODY_CHARACTERS = 16_000;

const htmlEscape = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const attributeEscape = htmlEscape;

function safeHref(value: string): string | null {
  if (value.length === 0 || value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch { return null; }
}

function formattedText(value: string): RenderedInline {
  const strongAsterisk = /(^|[^A-Za-z0-9*])\*\*([^*\n]{1,1024})\*\*(?![A-Za-z0-9*])/g;
  const strongUnderscore = /(^|[^A-Za-z0-9_])__([^_\n]{1,1024})__(?![A-Za-z0-9_])/g;
  const emphasisAsterisk = /(^|[^A-Za-z0-9*])\*([^*\n]{1,1024})\*(?![A-Za-z0-9*])/g;
  const emphasisUnderscore = /(^|[^A-Za-z0-9_])_([^_\n]{1,1024})_(?![A-Za-z0-9_])/g;
  const escaped = htmlEscape(value);
  return {
    html: escaped
      .replace(strongAsterisk, '$1<strong>$2</strong>')
      .replace(strongUnderscore, '$1<strong>$2</strong>')
      .replace(emphasisAsterisk, '$1<em>$2</em>')
      .replace(emphasisUnderscore, '$1<em>$2</em>'),
    // Text output removes only balanced delimiters accepted by the HTML path.
    text: value
      .replace(strongAsterisk, '$1$2')
      .replace(strongUnderscore, '$1$2')
      .replace(emphasisAsterisk, '$1$2')
      .replace(emphasisUnderscore, '$1$2'),
  };
}

/** Only a deliberately small Markdown v1 inline subset is emitted as HTML. */
function markdownInline(value: string): RenderedInline {
  let html = '';
  let text = '';
  let remainder = value;
  const token = /(!?)\[([^\]\n]{0,512})\]\(([^)\s]{1,2048})\)|`([^`\n]{0,4096})`/;
  while (remainder) {
    const match = token.exec(remainder);
    if (!match) {
      const tail = formattedText(remainder);
      return { html: html + tail.html, text: text + tail.text };
    }
    const before = formattedText(remainder.slice(0, match.index));
    html += before.html;
    text += before.text;
    if (match[4] !== undefined) {
      html += `<code>${htmlEscape(match[4])}</code>`;
      text += match[4];
    } else if (match[1] === '!') {
      // Markdown images intentionally have no email HTML representation.
      const label = formattedText(match[2]);
      html += label.html;
      text += label.text;
    } else {
      const href = safeHref(match[3]);
      if (href) {
        const label = formattedText(match[2]);
        html += `<a href="${attributeEscape(href)}" rel="noreferrer noopener">${label.html}</a>`;
        text += label.text;
      } else {
        const literal = formattedText(`[${match[2]}](${match[3]})`);
        html += literal.html;
        text += literal.text;
      }
    }
    remainder = remainder.slice(match.index + match[0].length);
  }
  return { html, text };
}

function renderMarkdownV1(source: string): RenderedArticleBody {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const html: string[] = [];
  const text: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (/^\s*$/.test(line)) { index++; continue; }
    if (/^```/.test(line)) {
      const code: string[] = [];
      index++;
      while (index < lines.length && !/^```/.test(lines[index])) code.push(lines[index++]);
      if (index < lines.length) index++;
      const value = code.join('\n');
      html.push(`<pre><code>${htmlEscape(value)}</code></pre>`);
      text.push(value);
      continue;
    }
    const unordered = /^\s*[-*+](?:\s+(.*))?$/.exec(line);
    const ordered = /^\s*\d+[.)](?:\s+(.*))?$/.exec(line);
    if (unordered || ordered) {
      const matcher = unordered ? /^\s*[-*+](?:\s+(.*))?$/ : /^\s*\d+[.)](?:\s+(.*))?$/;
      const items: string[] = [];
      const plainItems: string[] = [];
      do {
        const item = matcher.exec(lines[index]);
        if (!item) break;
        const rendered = markdownInline(item[1] ?? '');
        items.push(`<li>${rendered.html}</li>`);
        plainItems.push(rendered.text);
        index++;
      } while (index < lines.length);
      html.push(`<${unordered ? 'ul' : 'ol'}>${items.join('')}</${unordered ? 'ul' : 'ol'}>`);
      text.push(plainItems.map(item => `- ${item}`).join('\n'));
      continue;
    }
    const heading = /^(#{1,3})(?:\s+(.*))?$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const rendered = markdownInline(heading[2] ?? '');
      html.push(`<h${level}>${rendered.html}</h${level}>`);
      text.push(rendered.text);
      index++;
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      const rendered = markdownInline(quote[1]);
      html.push(`<blockquote><p>${rendered.html}</p></blockquote>`);
      text.push(rendered.text);
      index++;
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && !/^\s*$/.test(lines[index]) && !/^```/.test(lines[index])
      && !/^\s*[-*+]\s+/.test(lines[index]) && !/^\s*\d+[.)]\s+/.test(lines[index])
      && !/^#{1,3}\s+/.test(lines[index]) && !/^>\s?/.test(lines[index])) paragraph.push(lines[index++]);
    if (!paragraph.length) {
      // Every block classifier must consume its current line. This fallback is
      // defensive against future parser changes that leave a marker unmatched.
      const rendered = markdownInline(lines[index++] ?? '');
      html.push(`<p>${rendered.html}</p>`);
      text.push(rendered.text);
      continue;
    }
    const rendered = markdownInline(paragraph.join('\n'));
    html.push(`<p>${rendered.html.replaceAll('\n', '<br>')}</p>`);
    text.push(rendered.text);
  }
  return { html: html.join(''), text: text.join('\n\n') };
}

export function renderArticleBodyForEmail(body: string, format: ArticleBodyFormat): RenderedArticleBody {
  if (format === 'markdown-v1') {
    if (body.length > MAX_MARKDOWN_V1_BODY_CHARACTERS || new TextEncoder().encode(body).byteLength > MAX_MARKDOWN_V1_BODY_BYTES) {
      throw new RangeError('Markdown-v1 article body exceeds the 16000-character and byte limit');
    }
    return renderMarkdownV1(body);
  }
  const normalized = body.replace(/\r\n?/g, '\n');
  return { html: `<p>${htmlEscape(normalized).replaceAll('\n', '<br>')}</p>`, text: normalized };
}

/** A public, readable text projection. It never reinterprets legacy text as Markdown. */
export function publicArticleBodyText(article: Pick<Article, 'body' | 'body_format'>): string | undefined {
  const format = articleBodyFormat(article.body_format);
  return format === 'markdown-v1'
    ? renderArticleBodyForEmail(article.body ?? '', format).text
    : undefined;
}

export function renderPublicArticleForEmail(article: Pick<Article, 'body' | 'body_format' | 'is_internal'>): RenderedArticleBody {
  if (article.is_internal) throw new Error('Internal articles cannot be sent as email');
  return renderArticleBodyForEmail(article.body ?? '', articleBodyFormat(article.body_format));
}
