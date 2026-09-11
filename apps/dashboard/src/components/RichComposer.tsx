import MDEditor from '@uiw/react-md-editor';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import { useEffect, useId, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';

export const COMPOSER_SLASH_COMMANDS = [
  { label: 'Greeting', markdown: 'Hello,\n\n' },
  { label: 'Code block', markdown: '```text\n\n```\n' },
] as const;

export const COMPOSER_EMOJI = ['🙂', '✅', '👋', '🎉'] as const;
export const COMPOSER_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
export const COMPOSER_MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export function insertMarkdownAtCursor(value: string, insertion: string, start = value.length, end = start) {
  return `${value.slice(0, start)}${insertion}${value.slice(end)}`;
}

export function acceptedComposerImages(files: Iterable<Pick<File, 'type' | 'size'>>): File[] {
  return Array.from(files).filter((file): file is File =>
    COMPOSER_IMAGE_MIME_TYPES.includes(file.type as typeof COMPOSER_IMAGE_MIME_TYPES[number]) && file.size <= COMPOSER_MAX_IMAGE_BYTES,
  );
}

function safeLink(url: string) {
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

/** Render untrusted Markdown without HTML or remote image requests. */
export function SafeMarkdown({ children, className = '' }: { children: string; className?: string }) {
  return <div className={className}><ReactMarkdown
    skipHtml
    rehypePlugins={[rehypeSanitize]}
    urlTransform={(url, key) => key === 'href' ? safeLink(url) : undefined}
    components={{
      a: ({ href, children: linkChildren }) => href
        ? <a href={href} target="_blank" rel="noreferrer noopener" className="underline break-words">{linkChildren}</a>
        : <span>{linkChildren}</span>,
      // Do not create network requests from sender-controlled Markdown. Attachments
      // retain their existing authenticated download path below each article.
      img: ({ alt }) => <span role="note" className="italic">[Image omitted{alt ? `: ${alt}` : ''}]</span>,
      p: ({ children: paragraphChildren }) => <div className="mb-3">{paragraphChildren}</div>,
      code: ({ className: codeClassName, children: codeChildren, ...props }) => codeClassName
        ? <code {...props} className={`${codeClassName} block overflow-x-auto rounded bg-slate-950 p-3 font-mono text-xs text-slate-50`}>{codeChildren}</code>
        : <code {...props} className="rounded bg-slate-200 px-1 font-mono text-[0.9em]">{codeChildren}</code>,
    }}
  >{children}</ReactMarkdown></div>;
}

export function RichComposer({
  id,
  value,
  onChange,
  onImageFiles,
  onRejectedImageFiles,
  readOnly,
  mode,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onImageFiles: (files: readonly File[]) => void;
  onRejectedImageFiles: (count: number) => void;
  readOnly: boolean;
  mode: 'public' | 'internal';
}) {
  const [disclosure, setDisclosure] = useState<'slash' | 'emoji' | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);
  const selectionRef = useRef({ start: value.length, end: value.length });
  const triggers = useRef<Record<'slash' | 'emoji', HTMLButtonElement | null>>({ slash: null, emoji: null });
  const slashId = useId();
  const emojiId = useId();
  useEffect(() => { if (readOnly) setDisclosure(null); }, [readOnly]);
  const captureSelection = (textarea: HTMLTextAreaElement) => {
    selectionRef.current = { start: textarea.selectionStart, end: textarea.selectionEnd };
  };
  const closeDisclosure = (kind: 'slash' | 'emoji', returnFocus = false) => {
    setDisclosure(null);
    if (returnFocus) requestAnimationFrame(() => triggers.current[kind]?.focus());
  };
  const disclosureKeyDown = (event: KeyboardEvent<HTMLElement>, kind: 'slash' | 'emoji') => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closeDisclosure(kind, true);
  };
  const insert = (markdown: string) => {
    if (readOnly) return;
    const { start, end } = selectionRef.current;
    const next = insertMarkdownAtCursor(value, markdown, start, end);
    onChange(next);
    setDisclosure(null);
    const cursor = start + markdown.length;
    selectionRef.current = { start: cursor, end: cursor };
    requestAnimationFrame(() => {
      const textarea = rootRef.current?.querySelector<HTMLTextAreaElement>('textarea');
      if (!textarea || readOnly) return;
      textarea.focus();
      textarea.setSelectionRange(cursor, cursor);
      captureSelection(textarea);
    });
  };
  const receiveImages = (files: FileList | readonly File[]) => {
    if (readOnly) return;
    const received = Array.from(files);
    const accepted = acceptedComposerImages(received);
    if (accepted.length) onImageFiles(accepted);
    if (accepted.length !== received.length) onRejectedImageFiles(received.length - accepted.length);
  };
  const receiveDrop = (event: DragEvent<HTMLElement>) => {
    const files = event.dataTransfer.files;
    if (!files.length) return;
    event.preventDefault();
    receiveImages(files);
  };
  const receivePaste = (event: ClipboardEvent<HTMLElement>) => {
    const files = event.clipboardData.files;
    if (!files.length) return;
    event.preventDefault();
    receiveImages(files);
  };

  return <section ref={rootRef} aria-label="Rich message composer" onDragOver={event => { if (!readOnly && event.dataTransfer.types.includes('Files')) event.preventDefault(); }} onDrop={receiveDrop} onPaste={receivePaste}
    className={`rounded-xl border p-2 ${mode === 'internal' ? 'border-amber-200 bg-amber-50/50' : 'border-slate-200 bg-slate-50/50'}`}>
    <div className="mb-2 flex flex-wrap gap-2" aria-label="Composer insert tools">
      <div className="relative">
        <button ref={node => { triggers.current.slash = node; }} type="button" disabled={readOnly} aria-expanded={disclosure === 'slash'} aria-controls={slashId}
          onClick={() => { if (!readOnly) setDisclosure(disclosure === 'slash' ? null : 'slash'); }}
          className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
          Insert command
        </button>
        {disclosure === 'slash' && <div id={slashId} aria-label="Slash command choices" onKeyDown={event => disclosureKeyDown(event, 'slash')} className="absolute z-10 mt-1 w-40 rounded border border-slate-300 bg-white p-1 shadow">
          {COMPOSER_SLASH_COMMANDS.map(command => <button key={command.label} disabled={readOnly} type="button" onClick={() => insert(command.markdown)} className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-slate-100">/{command.label}</button>)}
        </div>}
      </div>
      <div className="relative">
        <button ref={node => { triggers.current.emoji = node; }} type="button" disabled={readOnly} aria-expanded={disclosure === 'emoji'} aria-controls={emojiId}
          onClick={() => { if (!readOnly) setDisclosure(disclosure === 'emoji' ? null : 'emoji'); }}
          className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
          Insert emoji
        </button>
        {disclosure === 'emoji' && <div id={emojiId} aria-label="Emoji choices" onKeyDown={event => disclosureKeyDown(event, 'emoji')} className="absolute z-10 mt-1 flex rounded border border-slate-300 bg-white p-1 shadow">
          {COMPOSER_EMOJI.map(emoji => <button key={emoji} disabled={readOnly} type="button" aria-label={`Insert ${emoji}`} onClick={() => insert(emoji)} className="rounded p-1 text-lg hover:bg-slate-100">{emoji}</button>)}
        </div>}
      </div>
      <span className="self-center text-xs text-slate-600">Markdown toolbar supports headings, emphasis, links, lists and code.</span>
    </div>
    <div onClickCapture={event => { if (readOnly) event.stopPropagation(); }} onKeyDownCapture={event => { if (readOnly) event.stopPropagation(); }}>
      <MDEditor
        value={value}
        onChange={next => { if (!readOnly) onChange(next ?? ''); }}
        preview="edit"
        visibleDragbar={false}
        height={180}
        commandsFilter={command => command.name === 'preview' || command.name === 'fullscreen' ? false : command}
        textareaProps={{ id, 'aria-label': 'Reply message', readOnly, 'aria-busy': readOnly, onSelect: event => captureSelection(event.currentTarget), onClick: event => captureSelection(event.currentTarget), onKeyUp: event => captureSelection(event.currentTarget) }}
        data-color-mode="light"
        className="overflow-hidden rounded border border-slate-300 bg-white"
      />
    </div>
    <p className="mt-2 text-xs text-slate-600">Drop or paste a JPEG, PNG, GIF, or WebP image to attach it (10 MB each).</p>
    <details className="mt-2 rounded border border-slate-200 bg-white p-2 text-sm">
      <summary className="cursor-pointer font-medium">Safe preview</summary>
      <SafeMarkdown className="mt-2" >{value}</SafeMarkdown>
    </details>
  </section>;
}
