import type { ArticleBodyFormat } from '@luminatick/shared';
import { ParkButton, ParkTextarea } from '@luminatick/ui/park';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { TextB, Code, CodeBlock, TextItalic, ListBullets, ListNumbers, TextH, Link as LinkIcon } from '@phosphor-icons/react';
import ReactMarkdown from 'react-markdown';
import rehypePrism from 'rehype-prism-plus';
import rehypeSanitize from 'rehype-sanitize';
import { useEffect, useId, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';

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
type Autocomplete = Readonly<{ kind: 'slash' | 'emoji'; options: readonly AutocompleteOption[] }>;

export function insertMarkdownAtCursor(value: string, insertion: string, start = value.length, end = start) {
  return `${value.slice(0, start)}${insertion}${value.slice(end)}`;
}
export function acceptedComposerImages(files: Iterable<Pick<File, 'type' | 'size'>>): File[] {
  return Array.from(files).filter((file): file is File => COMPOSER_IMAGE_MIME_TYPES.includes(file.type as typeof COMPOSER_IMAGE_MIME_TYPES[number]) && file.size <= COMPOSER_MAX_IMAGE_BYTES);
}
function slashOptions(hooks: ComposerInsertionHooks): AutocompleteOption[] {
  return [
    ...COMPOSER_SLASH_COMMANDS.map(command => ({ ...command, id: `command-${command.label}`, kind: 'command' as const, displayLabel: `/${command.label}` })),
    ...(hooks.knowledge ?? []).map(option => ({ ...option, kind: 'knowledge' as const, displayLabel: `Knowledge: ${option.label}` })),
    ...(hooks.savedResponses ?? []).map(option => ({ ...option, kind: 'saved-response' as const, displayLabel: `Saved response: ${option.label}` })),
  ];
}
/** Finds a short trigger at the caret; it intentionally never scans beyond one line. */
export function findComposerAutocomplete(value: string, cursor: number, hooks: ComposerInsertionHooks = {}): Autocomplete & { start: number; end: number } | null {
  const prefix = value.slice(Math.max(0, cursor - 25), cursor);
  const slash = prefix.match(/(?:^|\s)\/([a-z-]{0,24})$/i);
  const emoji = prefix.match(/(?:^|\s):([a-z-]{1,24})$/i);
  const match = slash ?? emoji;
  if (!match) return null;
  const kind = slash ? 'slash' : 'emoji';
  const query = match[1].toLocaleLowerCase();
  const candidates = kind === 'slash' ? slashOptions(hooks) : COMPOSER_EMOJI.map(option => ({ ...option, id: `emoji-${option.label}`, kind: 'emoji' as const, displayLabel: `:${option.label}: ${option.markdown}` }));
  const options = candidates.filter(option => option.displayLabel.toLocaleLowerCase().includes(query)).slice(0, AUTOCOMPLETE_LIMIT);
  if (!options.length) return null;
  return { kind, start: cursor - match[0].length + (match[0].startsWith(' ') ? 1 : 0), end: cursor, options };
}
function safeLink(url: string) {
  try { const parsed = new URL(url, window.location.origin); return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : undefined; } catch { return undefined; }
}
/** Render untrusted Markdown without executing HTML or remote image requests. */
export function SafeMarkdown({ children, className = '' }: { children: string; className?: string }) {
  return <div className={className}><ReactMarkdown skipHtml rehypePlugins={[rehypeSanitize, [rehypePrism, { ignoreMissing: true }]]} urlTransform={(url, key) => key === 'href' ? safeLink(url) : undefined} components={{
    a: ({ href, children: linkChildren }) => href ? <a href={href} target="_blank" rel="noreferrer noopener" className="tocyn-u-underline tocyn-u-wrap">{linkChildren}</a> : <span>{linkChildren}</span>,
    img: ({ alt }) => <span role="note" className="italic">[Image omitted{alt ? `: ${alt}` : ''}]</span>,
    p: ({ children: paragraphChildren }) => <div className="mb-3">{paragraphChildren}</div>,
    code: ({ className: codeClassName, children: codeChildren, ...props }) => codeClassName ? <code {...props} className={`${codeClassName} tocyn-markdown-code-block`}>{codeChildren}</code> : <code {...props} className="tocyn-markdown-code-inline">{codeChildren}</code>,
  }}>{children}</ReactMarkdown></div>;
}

const ToolbarButton = ({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) => (
  <ParkButton type="button" aria-label={label} aria-pressed={active} className={`tocyn-composer-toolbar-button${active ? ' tocyn-composer-toolbar-button-active' : ''}`} onMouseDown={event => event.preventDefault()} onClick={onClick}>{children}</ParkButton>
);

/** A standalone Markdown-backed Tiptap field used by knowledge editing. */
export function TiptapMarkdownField({ id, value, onChange, readOnly, ariaDescribedBy }: { id: string; value: string; onChange: (value: string) => void; readOnly: boolean; ariaDescribedBy?: string }) {
  const editor = useEditor({
    extensions: [StarterKit, Markdown],
    content: value, contentType: 'markdown', editable: !readOnly,
    onUpdate: ({ editor: instance }) => { if (!readOnly) onChange(instance.getMarkdown()); },
  });
  useEffect(() => { editor?.setEditable(!readOnly); }, [editor, readOnly]);
  useEffect(() => { if (editor && editor.getMarkdown() !== value) editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false }); }, [editor, value]);
  if (!editor) return <div id={id} className="tocyn-knowledge-editor-tiptap" aria-busy="true" aria-label="Content (Markdown)" />;
  return <div className="tocyn-knowledge-editor-tiptap" aria-disabled={readOnly}>
    <div className="tocyn-composer-toolbar" role="toolbar" aria-label="Formatting controls">
      <ToolbarButton label="Add bold text (ctrl + b)" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><TextB weight="duotone" aria-hidden="true" /></ToolbarButton>
      <ToolbarButton label="Add italic text (ctrl + i)" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><TextItalic weight="duotone" aria-hidden="true" /></ToolbarButton>
      <ToolbarButton label="Add heading" active={editor.isActive('heading')} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><TextH weight="duotone" aria-hidden="true" /></ToolbarButton>
      <ToolbarButton label="Add bullet list" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}><ListBullets weight="duotone" aria-hidden="true" /></ToolbarButton>
      <ToolbarButton label="Add code block" active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()}><CodeBlock weight="duotone" aria-hidden="true" /></ToolbarButton>
    </div>
    <EditorContent editor={editor} id={id} aria-label="Content (Markdown)" aria-describedby={ariaDescribedBy} onKeyDown={event => { if (readOnly) event.preventDefault(); }} />
  </div>;
}

export function RichComposer({ id, value, onChange, onImageFiles, onRejectedImageFiles, readOnly, mode, format = 'markdown-v1', knowledge, savedResponses, onKnowledgeInserted, onSavedResponseInserted }: {
  id: string; value: string; onChange: (value: string) => void; onImageFiles: (files: readonly File[]) => void; onRejectedImageFiles: (count: number) => void; readOnly: boolean; mode: 'public' | 'internal'; format?: ArticleBodyFormat;
} & ComposerInsertionHooks) {
  const hooks = { knowledge, savedResponses, onKnowledgeInserted, onSavedResponseInserted };
  const [autocomplete, setAutocomplete] = useState<(Autocomplete & { start: number; end: number }) | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLElement | null>(null);
  const listboxId = useId();
  const editor = useEditor({
    extensions: [StarterKit, Markdown],
    content: value,
    contentType: 'markdown',
    editable: !readOnly,
    editorProps: { attributes: { id, 'aria-label': 'Reply message', 'aria-autocomplete': 'list' } },
    onUpdate: ({ editor: instance }) => {
      if (readOnly) return;
      const next = instance.getMarkdown();
      onChange(next);
      const cursor = instance.state.selection.from - 1;
      setAutocomplete(format === 'plain' ? null : findComposerAutocomplete(instance.state.doc.textBetween(0, instance.state.selection.from, '\n'), cursor, hooks));
      setActiveIndex(0);
    },
  });
  useEffect(() => { editor?.setEditable(!readOnly); if (readOnly || format === 'plain') setAutocomplete(null); }, [editor, readOnly, format]);
  useEffect(() => {
    if (!editor || editor.getMarkdown() === value) return;
    editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false });
  }, [editor, value]);
  const insert = (markdown: string) => {
    if (!editor || readOnly || !autocomplete) return;
    const { from, to } = editor.state.selection;
    const length = autocomplete.end - autocomplete.start;
    editor.chain().focus().deleteRange({ from: Math.max(1, from - length), to }).insertContent(markdown, { contentType: 'markdown' }).run();
    setAutocomplete(null);
  };
  const chooseAutocomplete = (option: AutocompleteOption) => {
    insert(option.markdown);
    const inserted = { id: option.id, label: option.label, markdown: option.markdown };
    if (option.kind === 'knowledge') onKnowledgeInserted?.(inserted);
    if (option.kind === 'saved-response') onSavedResponseInserted?.(inserted);
  };
  const handleEditorKeyDown = (event: React.KeyboardEvent) => {
    if (!autocomplete) return;
    if (event.key === 'Escape') { event.preventDefault(); setAutocomplete(null); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex(index => (index + (event.key === 'ArrowDown' ? 1 : autocomplete.options.length - 1)) % autocomplete.options.length); return; }
    if (event.key === 'Enter') { event.preventDefault(); chooseAutocomplete(autocomplete.options[activeIndex]); }
  };
  const receiveImages = (files: FileList | readonly File[]) => { if (readOnly) return; const received = Array.from(files); const accepted = acceptedComposerImages(received); if (accepted.length) onImageFiles(accepted); if (accepted.length !== received.length) onRejectedImageFiles(received.length - accepted.length); };
  const receiveDrop = (event: DragEvent<HTMLElement>) => { const files = event.dataTransfer.files; if (!files.length) return; event.preventDefault(); receiveImages(files); };
  const receivePaste = (event: ClipboardEvent<HTMLElement>) => { const files = event.clipboardData.files; if (!files.length) return; event.preventDefault(); receiveImages(files); };
  const editorToolbar = editor && format !== 'plain' && <div className="tocyn-composer-toolbar" role="toolbar" aria-label="Formatting controls">
    <ToolbarButton label="Add bold text (ctrl + b)" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><TextB weight="duotone" aria-hidden="true" /></ToolbarButton>
    <ToolbarButton label="Add italic text (ctrl + i)" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><TextItalic weight="duotone" aria-hidden="true" /></ToolbarButton>
    <ToolbarButton label="Add heading" active={editor.isActive('heading')} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><TextH weight="duotone" aria-hidden="true" /></ToolbarButton>
    <ToolbarButton label="Add bullet list" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}><ListBullets weight="duotone" aria-hidden="true" /></ToolbarButton>
    <ToolbarButton label="Add numbered list" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListNumbers weight="duotone" aria-hidden="true" /></ToolbarButton>
    <ToolbarButton label="Add code block" active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()}><CodeBlock weight="duotone" aria-hidden="true" /></ToolbarButton>
    <ToolbarButton label="Add inline code" active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()}><Code weight="duotone" aria-hidden="true" /></ToolbarButton>
    <ToolbarButton label="Add link" active={editor.isActive('link')} onClick={() => { const url = window.prompt('Link URL'); if (url && safeLink(url)) editor.chain().focus().setLink({ href: safeLink(url)! }).run(); }}><LinkIcon weight="duotone" aria-hidden="true" /></ToolbarButton>
  </div>;
  return <section ref={rootRef} aria-label="Rich message composer" onDragOver={event => { if (!readOnly && event.dataTransfer.types.includes('Files')) event.preventDefault(); }} onDrop={receiveDrop} onPaste={receivePaste} className={`tocyn-composer-shell ${mode === 'internal' ? 'tocyn-composer-shell--internal' : 'tocyn-composer-shell--public'}`}>
    {format === 'markdown-v1' && <p className="tocyn-composer-format-help">Type <kbd>/</kbd> for commands or <kbd>:</kbd> followed by an emoji name. Formatting controls use accessible rich text editing.</p>}
    <div onClickCapture={event => { if (readOnly) event.stopPropagation(); }} onKeyDownCapture={event => { if (readOnly) event.stopPropagation(); }}>
      {format === 'plain' ? (
        <ParkTextarea id={id} aria-label="Reply message" value={value} readOnly={readOnly} onChange={event => { if (!readOnly) onChange(event.target.value); }} className="tocyn-composer-input" />
      ) : (
        <div className="tocyn-composer-markdown-editor" aria-busy={readOnly}>
          {editorToolbar}
          <EditorContent editor={editor} id={id} aria-label="Reply message" aria-autocomplete="list" aria-controls={autocomplete ? listboxId : undefined} aria-activedescendant={autocomplete ? `${listboxId}-option-${activeIndex}` : undefined} onKeyDown={handleEditorKeyDown} />
        </div>
      )}
    </div>
    {autocomplete && <div id={listboxId} role="listbox" aria-label={autocomplete.kind === 'slash' ? 'Slash command suggestions' : 'Emoji suggestions'} className="tocyn-composer-autocomplete">{autocomplete.options.map((option, index) => <ParkButton id={`${listboxId}-option-${index}`} key={`${option.kind}-${option.id}`} type="button" role="option" aria-selected={activeIndex === index} onMouseDown={event => event.preventDefault()} onClick={() => chooseAutocomplete(option)} className={`tocyn-composer-autocomplete-option ${activeIndex === index ? 'tocyn-composer-autocomplete-option-active' : ''}`}>{option.displayLabel}</ParkButton>)}</div>}
    <p className="tocyn-composer-drop-help">Drop or paste a JPEG, PNG, GIF, or WebP image to attach it (10 MB each).</p>
    <details className="tocyn-composer-preview"><summary className="tocyn-composer-preview-summary">Safe preview</summary>{format === 'plain' ? <div className="tocyn-composer-preview-body">{value}</div> : <SafeMarkdown className="tocyn-composer-preview-body">{value}</SafeMarkdown>}</details>
  </section>;
}
