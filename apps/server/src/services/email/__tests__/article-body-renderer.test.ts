import { describe, expect, it } from 'vitest';
import {
  publicArticleBodyText,
  renderArticleBodyForEmail,
  renderPublicArticleForEmail,
} from '../article-body-renderer';

describe('article email body rendering', () => {
  it('escapes every plain-text character that could become HTML', () => {
    const rendered = renderPublicArticleForEmail({
      body: '<script>alert("x")</script> & "quoted"', body_format: 'plain', is_internal: false,
    });
    expect(rendered.html).toBe('<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &quot;quoted&quot;</p>');
    expect(rendered.text).toBe('<script>alert("x")</script> & "quoted"');
  });

  it('emits only the bounded markdown-v1 subset and a readable text alternative', () => {
    const rendered = renderPublicArticleForEmail({
      body: '# Heading\n\n- **bold** [safe](https://example.test/path)\n- `code`\n\n```\nconst x = 1 < 2;\n```',
      body_format: 'markdown-v1', is_internal: false,
    });
    expect(rendered.html).toContain('<h1>Heading</h1>');
    expect(rendered.html).toContain('<ul><li><strong>bold</strong> <a href="https://example.test/path" rel="noreferrer noopener">safe</a></li><li><code>code</code></li></ul>');
    expect(rendered.html).toContain('<pre><code>const x = 1 &lt; 2;</code></pre>');
    expect(rendered.text).toContain('Heading');
    expect(rendered.text).toContain('bold safe');
    expect(rendered.text).toContain('const x = 1 < 2;');
  });

  it('does not allow raw HTML, images, or unsafe link protocols into public output', () => {
    const rendered = renderPublicArticleForEmail({
      body: '<img src=x onerror=alert(1)> ![remote](https://images.example.test/x.png) [bad](javascript:alert(1)) [data](data:text/html,boom)',
      body_format: 'markdown-v1', is_internal: false,
    });
    expect(rendered.html).not.toContain('<img');
    expect(rendered.html).not.toContain('<script');
    expect(rendered.html).not.toContain('href="javascript:');
    expect(rendered.html).not.toContain('href="data:');
    expect(rendered.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(rendered.text).toContain('remote');
  });

  it('preserves code, identifiers, email-like text, URLs, math, and unsupported markup in Markdown text output', () => {
    const rendered = renderPublicArticleForEmail({
      body: '[support_address](https://example.test/path?user_id=42) `user_id` support_address@example.invalid https://example.test/user_id\n2 * 3 = 6; ~~unsupported_markup~~; _emphasis_; **bold**\n\n```\nconst user_id = support_address;\n```',
      body_format: 'markdown-v1', is_internal: false,
    });
    expect(rendered.html).toContain('<a href="https://example.test/path?user_id=42" rel="noreferrer noopener">support_address</a>');
    expect(rendered.html).toContain('<code>user_id</code>');
    expect(rendered.text).toContain('support_address user_id support_address@example.invalid https://example.test/user_id');
    expect(rendered.text).toContain('2 * 3 = 6; ~~unsupported_markup~~; emphasis; bold');
    expect(rendered.text).toContain('const user_id = support_address;');
  });

  it('consumes empty list and heading markers without reclassifying or looping', () => {
    const rendered = renderArticleBodyForEmail('- \n1. \n# \n> \n```\nunterminated_user_id', 'markdown-v1');
    expect(rendered.html).toContain('<ul><li></li></ul>');
    expect(rendered.html).toContain('<ol><li></li></ol>');
    expect(rendered.html).toContain('<h1></h1>');
    expect(rendered.html).toContain('<blockquote><p></p></blockquote>');
    expect(rendered.text).toContain('unterminated_user_id');
  });

  it('bounds only newly declared Markdown before parsing while preserving large legacy plain text', () => {
    expect(() => renderArticleBodyForEmail('😀'.repeat(5_000), 'markdown-v1')).toThrow('16000-character and byte limit');
    const legacyPlain = `legacy_user_id ${'&'.repeat(20_000)}`;
    expect(renderArticleBodyForEmail(legacyPlain, 'plain').text).toBe(legacyPlain);
  });

  it('never renders internal notes for email and only projects markdown for public plain-text consumers', () => {
    expect(() => renderPublicArticleForEmail({ body: 'internal', body_format: 'markdown-v1', is_internal: true }))
      .toThrow('Internal articles cannot be sent as email');
    expect(publicArticleBodyText({ body: '**format only**', body_format: 'markdown-v1' })).toBe('format only');
    expect(publicArticleBodyText({ body: '**historical literal**', body_format: undefined })).toBeUndefined();
  });
});
