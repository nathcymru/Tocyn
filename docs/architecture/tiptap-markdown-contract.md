# Tiptap Markdown contract

Tocyn stores editor content as the existing `plain` or `markdown-v1` body format. The
`markdown-v1` format is parsed and serialized by Tiptap; it is not HTML and it never
executes embedded markup.

## Supported content

The supported Markdown nodes are paragraphs, headings (levels 1–6), blockquotes,
bullet lists, ordered lists, list items, task lists and task items, code blocks,
horizontal rules, hard breaks, and inline images accepted by the composer policy.
The supported marks are bold, italic, strike, inline code, links with `http` or
`https` URLs, and the standard link title when supplied.

Plain mode bypasses the Markdown parser and preserves the entered text, including
line breaks and Markdown punctuation. Rich mode serializes the supported nodes and
marks back to `markdown-v1` for drafts and submission.

## Unsupported and unsafe content

Unsupported Markdown constructs are retained as literal text where possible so
stored content is never silently discarded. Raw HTML, scriptable URLs, remote image
requests and unsafe attributes are removed by the existing sanitised preview and
renderer. A malformed or unsupported image is shown as omitted content and does not
trigger an upload.

Images are accepted only for JPEG, PNG, GIF and WebP files no larger than 10 MiB.
Accepted files continue through the existing authorised attachment upload callback;
rejected files remain rejected with the existing count/error feedback.

## Round-trip invariant

For supported Markdown, parse → serialize preserves node/mark meaning, readable
whitespace and link destinations. Serialization may normalize equivalent Markdown
punctuation (for example list marker choice), but it must not change visible text,
formatting, or accepted image references. Plain mode is excluded from this invariant
because it intentionally remains literal text.
