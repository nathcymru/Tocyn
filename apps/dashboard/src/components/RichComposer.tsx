import MDEditor from '@uiw/react-md-editor';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import { useEffect, useId, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';

export const COMPOSER_SLASH_COMMANDS = [
  { label: 'Greeting', markdown: 'Hello,\n\n' },
  { label: 'Code block', markdown: '```text\n\n```\n' },
] as const;

export const COMPOSER_EMOJI = [
  { label: 'smile', markdown: '🙂' },
  { label: 'check', markdown: '✅' },
  { label: 'wave', markdown: '👋' },
  { label: 'party', markdown: '🎉' },
] as const;
export const COMPOSER_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
export const COMPOSER_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const AUTOCOMPLETE_LIMIT = 6;

type InsertionKind = 'command' | 'emoji' | 'knowledge' | 'saved-response';
export type ComposerInsertionOption = Readonly<{ id: string; label: string; markdown: string }>;
export type ComposerInsertionHooks = Readonly<{
  knowledge?: readonly ComposerInsertionOption[];
  savedResponses?: readonly ComposerInsertionOption[];
  onKnowledgeInserted?: (option: ComposerInsertionOption) => void;
  onSavedResponseInserted?: (option: ComposerInsertionOption) => void;
}>;
type AutocompleteOption = ComposerInsertionOption & Readonly<{ kind: InsertionKind; displayLabel: string }>;
type Autocomplete = Readonly<{ kind: 'slash' | 'emoji'; start: number; end: number; options: readonly AutocompleteOption[] }>;

export function insertMarkdownAtCursor(value: string, insertion: string, start = value.length, end = start) {
  return `${value.slice(0, start)}${insertion}${value.slice(end)}`;
}

export function acceptedComposerImages(files: Iterable<Pick<File, 'type' | 'size'>>): File[] {
  return Array.from(files).filter((file): file is File =>
    COMPOSER_IMAGE_MIME_TYPES.includes(file.type as typeof COMPOSER_IMAGE_MIME_TYPES[number]) && file.size <= COMPOSER_MAX_IMAGE_BYTES,
  );
}

function slashOptions(hooks: ComposerInsertionHooks): AutocompleteOption[] {
  return [
    ...COMPOSER_SLASH_COMMANDS.map(command => ({ ...command, id: `command-${command.label}`, kind: 'command' as const, displayLabel: `/${command.label}` })),
    ...(hooks.knowledge ?? []).map(option => ({ ...option, kind: 'knowledge' as const, displayLabel: `Knowledge: ${option.label}` })),
    ...(hooks.savedResponses ?? []).map(option => ({ ...option, kind: 'saved-response' as const, displayLabel: `Saved response: ${option.label}` })),
  ];
}

/** Finds a short trigger at the caret; it intentionally never scans beyond one line. */
export function findComposerAutocomplete(value: string, cursor: number, hooks: ComposerInsertionHooks = {}): Autocomplete | null {
  const prefix = value.slice(Math.max(0, cursor - 25), cursor);
  const slash = prefix.match(/(?:^|\s)\/([a-z-]{0,24})$/i);
  const emoji = prefix.match(/(?:^|\s):([a-z-]{1,24})$/i);
  const match = slash ?? emoji;
  if (!match) return null;
  const kind = slash ? 'slash' : 'emoji';
  const query = match[1].toLocaleLowerCase();
  const candidates = kind === 'slash'
    ? slashOptions(hooks)
    : COMPOSER_EMOJI.map(emojiOption => ({ ...emojiOption, id: `emoji-${emojiOption.label}`, kind: 'emoji' as const, displayLabel: `:${emojiOption.label}: ${emojiOption.markdown}` }));
  const options = candidates.filter(option => option.displayLabel.toLocaleLowerCase().includes(query)).slice(0, AUTOCOMPLETE_LIMIT);
  if (!options.length) return null;
  return { kind, start: cursor - match[0].length + (match[0].startsWith(' ') ? 1 : 0), end: cursor, options };
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
      // Never create a network request from sender-controlled Markdown; attachments
      // use the existing authenticated download path below each conversation article.
      img: ({ alt }) => <span role="note" className="italic">[Image omitted{alt ? `: ${alt}` : ''}]</span>,
      p: ({ children: paragraphChildren }) => <div className="mb-3">{paragraphChildren}</div>,
      code: ({ className: codeClassName, children: codeChildren, ...props }) => codeClassName
        ? <code {...props} className={`${codeClassName} block overflow-x-auto rounded bg-slate-950 p-3 font-mono text-xs text-slate-50`}>{codeChildren}</code>
        : <code {...props} className="rounded bg-slate-200 px-1 font-mono text-[0.9em]">{codeChildren}</code>,
    }}
  >{children}</ReactMarkdown></div>;
}

export function RichComposer({
  id, value, onChange, onImageFiles, onRejectedImageFiles, readOnly, mode,
  knowledge, savedResponses, onKnowledgeInserted, onSavedResponseInserted,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onImageFiles: (files: readonly File[]) => void;
  onRejectedImageFiles: (count: number) => void;
  readOnly: boolean;
  mode: 'public' | 'internal';
} & ComposerInsertionHooks) {
  const hooks = { knowledge, savedResponses, onKnowledgeInserted, onSavedResponseInserted };
  const [autocomplete, setAutocomplete] = useState<Autocomplete | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLElement | null>(null);
  const selectionRef = useRef({ start: value.length, end: value.length });
  const listboxId = useId();
  useEffect(() => { if (readOnly) setAutocomplete(null); }, [readOnly]);
  const captureSelection = (textarea: HTMLTextAreaElement) => {
    selectionRef.current = { start: textarea.selectionStart, end: textarea.selectionEnd };
    const next = readOnly ? null : findComposerAutocomplete(value, textarea.selectionStart, hooks);
    setAutocomplete(next);
    setActiveIndex(0);
  };
  const restoreSelection = (start: number, end: number) => {
    selectionRef.current = { start, end };
    requestAnimationFrame(() => {
      const textarea = rootRef.current?.querySelector<HTMLTextAreaElement>('textarea');
      if (!textarea || readOnly) return;
      textarea.focus();
      textarea.setSelectionRange(start, end);
      selectionRef.current = { start, end };
    });
  };
  const insert = (markdown: string, start = selectionRef.current.start, end = selectionRef.current.end) => {
    if (readOnly) return;
    const next = insertMarkdownAtCursor(value, markdown, start, end);
    onChange(next);
    setAutocomplete(null);
    restoreSelection(start + markdown.length, start + markdown.length);
  };
  const chooseAutocomplete = (option: AutocompleteOption) => {
    if (readOnly || !autocomplete) return;
    const { start, end } = autocomplete;
    insert(option.markdown, start, end);
    const inserted: ComposerInsertionOption = { id: option.id, label: option.label, markdown: option.markdown };
    if (option.kind === 'knowledge') onKnowledgeInserted?.(inserted);
    if (option.kind === 'saved-response') onSavedResponseInserted?.(inserted);
  };
  const updateFromEditor = (next: string, textarea?: HTMLTextAreaElement) => {
    if (readOnly) return;
    const cursor = textarea?.selectionStart ?? selectionRef.current.start;
    selectionRef.current = { start: cursor, end: textarea?.selectionEnd ?? cursor };
    onChange(next);
    const found = findComposerAutocomplete(next, cursor, hooks);
    setAutocomplete(found);
    setActiveIndex(0);
  };
  const autocompleteKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!autocomplete) return;
    if (event.key === 'Escape') {
      event.preventDefault(); setAutocomplete(null); return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(index => (index + (event.key === 'ArrowDown' ? 1 : autocomplete.options.length - 1)) % autocomplete.options.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault(); chooseAutocomplete(autocomplete.options[activeIndex]);
    }
  };
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.target as Element | null)?.tagName !== 'TEXTAREA') return;
      autocompleteKeyDown(event as unknown as KeyboardEvent<HTMLTextAreaElement>);
    };
    root.addEventListener('keydown', handleKeyDown, true);
    return () => root.removeEventListener('keydown', handleKeyDown, true);
  }, [autocomplete, activeIndex, readOnly, value]);

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
    event.preventDefault(); receiveImages(files);
  };
  const receivePaste = (event: ClipboardEvent<HTMLElement>) => {
    const files = event.clipboardData.files;
    if (!files.length) return;
    event.preventDefault(); receiveImages(files);
  };

  return <section ref={rootRef} aria-label="Rich message composer" onDragOver={event => { if (!readOnly && event.dataTransfer.types.includes('Files')) event.preventDefault(); }} onDrop={receiveDrop} onPaste={receivePaste}
    className={`rounded-xl border p-2 ${mode === 'internal' ? 'border-amber-200 bg-amber-50/50' : 'border-slate-200 bg-slate-50/50'}`}>
    <p className="mb-2 text-xs text-slate-600">Type <kbd>/</kbd> for commands or <kbd>:</kbd> followed by an emoji name. Markdown toolbar supports headings, emphasis, links, lists and code.</p>
    <div onClickCapture={event => { if (readOnly) event.stopPropagation(); }} onKeyDownCapture={event => { if (readOnly) event.stopPropagation(); }}>
      <MDEditor
        value={value}
        onChange={(next, event) => updateFromEditor(next ?? '', event?.currentTarget)}
        preview="edit"
        visibleDragbar={false}
        height={180}
        commandsFilter={command => command.name === 'preview' || command.name === 'fullscreen' ? false : command}
        textareaProps={{ id, 'aria-label': 'Reply message', 'aria-autocomplete': 'list', 'aria-controls': autocomplete ? listboxId : undefined, 'aria-activedescendant': autocomplete ? `${listboxId}-option-${activeIndex}` : undefined, 'aria-busy': readOnly, readOnly, onSelect: event => captureSelection(event.currentTarget), onClick: event => captureSelection(event.currentTarget), onKeyUp: event => captureSelection(event.currentTarget) }}
        data-color-mode="light"
        className="overflow-hidden rounded border border-slate-300 bg-white"
      />
    </div>
    {autocomplete && <div id={listboxId} role="listbox" aria-label={autocomplete.kind === 'slash' ? 'Slash command suggestions' : 'Emoji suggestions'} className="mt-1 rounded border border-slate-300 bg-white p-1 shadow">
      {autocomplete.options.map((option, index) => <button id={`${listboxId}-option-${index}`} key={`${option.kind}-${option.id}`} type="button" role="option" aria-selected={activeIndex === index}
        onMouseDown={event => event.preventDefault()} onClick={() => chooseAutocomplete(option)}
        className={`block w-full rounded px-2 py-1 text-left text-sm focus-visible:outline focus-visible:outline-2 ${activeIndex === index ? 'bg-slate-100' : 'hover:bg-slate-50'}`}>
        {option.displayLabel}
      </button>)}
    </div>}
    <p className="mt-2 text-xs text-slate-600">Drop or paste a JPEG, PNG, GIF, or WebP image to attach it (10 MB each).</p>
    <details className="mt-2 rounded border border-slate-200 bg-white p-2 text-sm">
      <summary className="cursor-pointer font-medium">Safe preview</summary>
      <SafeMarkdown className="mt-2">{value}</SafeMarkdown>
    </details>
  </section>;
}
