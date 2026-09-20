import type { ArticleBodyFormat } from '@luminatick/shared';
import { ParkAlert, ParkButton, ParkComposer, ParkDialog, ParkInput, ParkTextarea } from '@luminatick/ui/park';
import { Collapsible as ParkCollapsible, Link as ParkLink } from '@luminatick/ui/components';
import { css } from '@luminatick/ui/styled-system/css';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { TextB, Code, CodeBlock, TextItalic, ListBullets, ListNumbers, TextH, Link as LinkIcon, LinkBreak } from '@phosphor-icons/react';
import ReactMarkdown from 'react-markdown';
import rehypePrism from 'rehype-prism-plus';
import rehypeSanitize from 'rehype-sanitize';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent } from 'react';
import { createPortal } from 'react-dom';

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
/** The deliberately bounded markdown-v1 surface; see docs/architecture/tiptap-markdown-contract.md. */
export const TIPTAP_MARKDOWN_CONTRACT = Object.freeze({
  nodes: ['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem', 'codeBlock', 'horizontalRule', 'hardBreak', 'image'] as const,
  marks: ['bold', 'italic', 'strike', 'code', 'link'] as const,
  unsafe: ['rawHtml', 'unsafeUrl', 'remoteImage', 'unsafeAttribute'] as const,
  imageMimeTypes: COMPOSER_IMAGE_MIME_TYPES,
  maxImageBytes: COMPOSER_MAX_IMAGE_BYTES,
});
const composerStyles = ParkComposer();
const narrativeLink = css({ display: 'inline', overflowWrap: 'anywhere' });
const codeBlock = css({ display: 'block', maxWidth: 'full', overflowX: 'auto', padding: '0.75rem', fontFamily: 'tabular', fontFeatureSettings: '"tnum" 1, "cv01" 1', fontVariantNumeric: 'tabular-nums' });
const inlineCode = css({ paddingInline: '0.25rem', fontFamily: 'tabular' });
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
    a: ({ href, children: linkChildren }) => href ? <ParkLink href={href} target="_blank" rel="noreferrer noopener" className={narrativeLink}>{linkChildren}</ParkLink> : <span>{linkChildren}</span>,
    img: ({ alt }) => <span role="note" className={css({ fontStyle: 'italic' })}>[Image omitted{alt ? `: ${alt}` : ''}]</span>,
    p: ({ children: paragraphChildren }) => <div className={css({ mb: '3' })}>{paragraphChildren}</div>,
    code: ({ className: codeClassName, children: codeChildren, ...props }) => codeClassName ? <code {...props} className={`${codeClassName} ${codeBlock}`}>{codeChildren}</code> : <code {...props} className={inlineCode}>{codeChildren}</code>,
  }}>{children}</ReactMarkdown></div>;
}

const ToolbarButton = ({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) => (
  <ParkButton type="button" aria-label={label} aria-pressed={active} className={[composerStyles.toolbarButton, active ? composerStyles.toolbarButtonActive : ''].filter(Boolean).join(' ')} onMouseDown={event => event.preventDefault()} onClick={onClick}>{children}</ParkButton>
);

/** A standalone Markdown-backed Tiptap field used by knowledge editing. */
export function TiptapMarkdownField({ id, value, onChange, readOnly, ariaDescribedBy }: { id: string; value: string; onChange: (value: string) => void; readOnly: boolean; ariaDescribedBy?: string }) {
  const legacyValueRef = useRef(value);
  const editor = useEditor({
    extensions: [StarterKit, Markdown],
    content: value, contentType: 'markdown', editable: !readOnly,
    editorProps: { attributes: { id, role: 'textbox', 'aria-label': 'Content (Markdown)' } },
    onUpdate: ({ editor: instance }) => { legacyValueRef.current = instance.getMarkdown(); if (!readOnly) onChange(legacyValueRef.current); },
  });
  useEffect(() => { editor?.setEditable(!readOnly); }, [editor, readOnly]);
  useLayoutEffect(() => { if (editor) { const dom = editor.view.dom as HTMLElement & { value?: string }; dom.id = id; dom.setAttribute('aria-label', 'Content (Markdown)'); if (ariaDescribedBy) dom.setAttribute('aria-describedby', ariaDescribedBy); else dom.removeAttribute('aria-describedby'); Object.defineProperty(dom, 'value', { configurable: true, get: () => legacyValueRef.current, set: (next: string) => { legacyValueRef.current = next; editor.commands.setContent(next, { contentType: 'markdown' }); editor.commands.focus('end'); } }); } }, [editor, id, ariaDescribedBy]);
  useEffect(() => { legacyValueRef.current = value; if (editor) editor.commands.setContent(value || '', { contentType: 'markdown', emitUpdate: false }); }, [editor, value]);
  if (!editor) return <div id={id} className={composerStyles.editor} aria-busy="true" aria-label="Content (Markdown)" aria-describedby={ariaDescribedBy} />;
  return <div className={composerStyles.editor} aria-disabled={readOnly}>
    <div className={composerStyles.toolbar} role="toolbar" aria-label="Formatting controls">
      <ToolbarButton label="Add bold text (ctrl + b)" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><TextB weight="duotone" aria-hidden="true" /></ToolbarButton>
      <ToolbarButton label="Add italic text (ctrl + i)" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><TextItalic weight="duotone" aria-hidden="true" /></ToolbarButton>
      <ToolbarButton label="Add heading" active={editor.isActive('heading')} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><TextH weight="duotone" aria-hidden="true" /></ToolbarButton>
      <ToolbarButton label="Add bullet list" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}><ListBullets weight="duotone" aria-hidden="true" /></ToolbarButton>
      <ToolbarButton label="Add code block" active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()}><CodeBlock weight="duotone" aria-hidden="true" /></ToolbarButton>
    </div>
    <EditorContent editor={editor} className={composerStyles.editor} aria-label="Content (Markdown)" aria-describedby={ariaDescribedBy} onChange={event => { if (!readOnly) onChange((event.target as HTMLElement & { value?: string }).value ?? editor.getMarkdown()); }} onKeyDown={event => { if (readOnly) event.preventDefault(); }} />
  </div>;
}

export function RichComposer({ id, value, onChange, onImageFiles, onRejectedImageFiles, readOnly, mode, format = 'markdown-v1', knowledge, savedResponses, onKnowledgeInserted, onSavedResponseInserted }: {
  id: string; value: string; onChange: (value: string) => void; onImageFiles: (files: readonly File[]) => void; onRejectedImageFiles: (count: number) => void; readOnly: boolean; mode: 'public' | 'internal'; format?: ArticleBodyFormat;
} & ComposerInsertionHooks) {
  const legacyValueRef = useRef(value);
  const hooks = { knowledge, savedResponses, onKnowledgeInserted, onSavedResponseInserted };
  const [autocomplete, setAutocomplete] = useState<(Autocomplete & { start: number; end: number }) | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkError, setLinkError] = useState('');
  const rootRef = useRef<HTMLElement | null>(null);
  const listboxId = useId();
  const linkTitleId = useId();
  const linkInputId = useId();
  const linkErrorId = useId();
  const linkButtonRef = useRef<HTMLButtonElement>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const linkSelectionRef = useRef<{ from: number; to: number } | null>(null);
  const focusEditorAfterLinkRef = useRef(false);
  const editor = useEditor({
    extensions: [StarterKit, Markdown],
    content: value,
    contentType: 'markdown',
    editable: !readOnly,
    editorProps: { attributes: { id, role: 'textbox', 'aria-label': 'Reply message', 'aria-autocomplete': 'list' } },
    onUpdate: ({ editor: instance }) => {
      if (readOnly) return;
      const next = instance.getMarkdown(); legacyValueRef.current = next;
      onChange(next);
      const cursor = instance.state.selection.from - 1;
      setAutocomplete(format === 'plain' ? null : findComposerAutocomplete(instance.state.doc.textBetween(0, instance.state.selection.from, '\n'), cursor, hooks));
      setActiveIndex(0);
    },
  });
  useEffect(() => { editor?.setEditable(!readOnly); if (readOnly || format === 'plain') { setAutocomplete(null); setLinkOpen(false); } }, [editor, readOnly, format]);
  useEffect(() => {
    if (!editor) return;
    // Keep the compatibility attribute used by existing integrations while
    // Tiptap owns the actual contenteditable state. `setEditable(false)` also
    // updates contenteditable, and this explicit marker makes the read-only
    // state discoverable to DOM consumers and assistive technology.
    const dom = editor.view.dom;
    if (readOnly) {
      dom.setAttribute('readonly', '');
      dom.setAttribute('aria-readonly', 'true');
    } else {
      dom.removeAttribute('readonly');
      dom.removeAttribute('aria-readonly');
    }
  }, [editor, readOnly]);
  useLayoutEffect(() => { if (editor) { const dom = editor.view.dom as HTMLElement & { value?: string }; dom.id = id; dom.setAttribute('aria-label', 'Reply message'); dom.setAttribute('aria-autocomplete', 'list'); Object.defineProperty(dom, 'value', { configurable: true, get: () => legacyValueRef.current, set: (next: string) => { if (readOnly) return; legacyValueRef.current = next; editor.commands.setContent(next, { contentType: 'markdown' }); editor.commands.focus('end'); } }); const onLegacyChange = () => { if (readOnly) return; const next = legacyValueRef.current; onChange(next); setAutocomplete(findComposerAutocomplete(next, next.length, hooks)); setActiveIndex(0); }; dom.addEventListener('change', onLegacyChange); return () => dom.removeEventListener('change', onLegacyChange); } }, [editor, id, readOnly, onChange, hooks]);
  useEffect(() => {
    if (!editor || editor.getMarkdown() === value) return;
    if (readOnly) legacyValueRef.current = value;
    legacyValueRef.current = value; editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false });
  }, [editor, value, readOnly]);
  const insert = (markdown: string, match = autocomplete) => {
    if (!editor || readOnly || !match) return;
    const { from, to } = editor.state.selection;
    const length = match.end - match.start;
    editor.chain().focus().deleteRange({ from: Math.max(1, from - length), to }).insertContent(markdown, { contentType: 'markdown' }).run();
    legacyValueRef.current = insertMarkdownAtCursor(legacyValueRef.current, markdown, match.start, match.end);
    onChange(legacyValueRef.current);
    Object.defineProperty(editor.view.dom, 'value', { configurable: true, get: () => legacyValueRef.current, set: (next: string) => { legacyValueRef.current = next; editor.commands.setContent(next, { contentType: 'markdown' }); } });
    setAutocomplete(null);
  };
  const chooseAutocomplete = (option: AutocompleteOption, match = autocomplete) => {
    insert(option.markdown, match);
    const inserted = { id: option.id, label: option.label, markdown: option.markdown };
    if (option.kind === 'knowledge') onKnowledgeInserted?.(inserted);
    if (option.kind === 'saved-response') onSavedResponseInserted?.(inserted);
  };
  const handleEditorKeyDown = (event: React.KeyboardEvent) => {
    if (event.defaultPrevented) return;
    const targetValue = (event.target as HTMLElement).getAttribute?.('contenteditable') !== null ? (event.target as HTMLElement).textContent ?? '' : '';
    const currentValue = targetValue || legacyValueRef.current;
    if (targetValue && targetValue !== legacyValueRef.current) legacyValueRef.current = targetValue;
    const currentAutocomplete = autocomplete ?? (format === 'plain' ? null : findComposerAutocomplete(currentValue, currentValue.length, hooks));
    if (!currentAutocomplete) return;
    if (event.key === 'Escape') { event.preventDefault(); setAutocomplete(null); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex(index => (index + (event.key === 'ArrowDown' ? 1 : currentAutocomplete.options.length - 1)) % currentAutocomplete.options.length); return; }
    if (event.key === 'Enter') { event.preventDefault(); chooseAutocomplete(currentAutocomplete.options[activeIndex] ?? currentAutocomplete.options[0], currentAutocomplete); }
  };
  const handleLegacyInput = (event: React.FormEvent<HTMLElement>) => {
    if (readOnly) return;
    const target = event.currentTarget;
    const next = target.textContent ?? '';
    if (next === legacyValueRef.current) return;
    legacyValueRef.current = next;
    if (editor.getMarkdown() !== next) editor.commands.setContent(next, { contentType: 'markdown', emitUpdate: false });
    onChange(next);
    setAutocomplete(format === 'plain' ? null : findComposerAutocomplete(next, next.length, hooks));
    setActiveIndex(0);
  };
  useLayoutEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    if (autocomplete) dom.setAttribute('aria-activedescendant', `${listboxId}-option-${activeIndex}`);
    else dom.removeAttribute('aria-activedescendant');
    const onKeyDown = (event: KeyboardEvent) => handleEditorKeyDown(event as unknown as React.KeyboardEvent);
    dom.addEventListener('keydown', onKeyDown, true);
    return () => dom.removeEventListener('keydown', onKeyDown, true);
  }, [editor, autocomplete, activeIndex, listboxId]);
  const receiveImages = (files: FileList | readonly File[]) => { if (readOnly) return; const received = Array.from(files); const accepted = acceptedComposerImages(received); if (accepted.length) onImageFiles(accepted); if (accepted.length !== received.length) onRejectedImageFiles(received.length - accepted.length); };
  const receiveDrop = (event: DragEvent<HTMLElement>) => { const files = event.dataTransfer.files; if (!files.length) return; event.preventDefault(); receiveImages(files); };
  const receivePaste = (event: ClipboardEvent<HTMLElement>) => { const files = event.clipboardData.files; if (!files.length) return; event.preventDefault(); receiveImages(files); };
  const openLinkEditor = () => {
    if (!editor || readOnly) return;
    const { from, to } = editor.state.selection;
    linkSelectionRef.current = { from, to };
    focusEditorAfterLinkRef.current = false;
    setLinkUrl(editor.getAttributes('link').href ?? '');
    setLinkError('');
    setLinkOpen(true);
  };
  const closeLinkEditor = () => { setLinkOpen(false); setLinkError(''); };
  const applyLink = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editor || readOnly) return;
    const href = safeLink(linkUrl.trim());
    if (!href) { setLinkError('Enter a valid HTTP or HTTPS link.'); linkInputRef.current?.focus(); return; }
    const selection = linkSelectionRef.current;
    if (!selection) return;
    focusEditorAfterLinkRef.current = true;
    editor.chain().focus().setTextSelection(selection).setLink({ href }).run();
    closeLinkEditor();
  };
  const removeLink = () => {
    if (!editor || readOnly || !linkSelectionRef.current) return;
    focusEditorAfterLinkRef.current = true;
    editor.chain().focus().setTextSelection(linkSelectionRef.current).unsetLink().run();
    closeLinkEditor();
  };
  const editorToolbar = editor && format !== 'plain' && <div className={composerStyles.toolbar} role="toolbar" aria-label="Formatting controls">
    <ToolbarButton label="Add bold text (ctrl + b)" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><TextB weight="duotone" aria-hidden="true" /></ToolbarButton>
    <ToolbarButton label="Add italic text (ctrl + i)" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><TextItalic weight="duotone" aria-hidden="true" /></ToolbarButton>
    <ToolbarButton label="Add heading" active={editor.isActive('heading')} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><TextH weight="duotone" aria-hidden="true" /></ToolbarButton>
    <ToolbarButton label="Add bullet list" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}><ListBullets weight="duotone" aria-hidden="true" /></ToolbarButton>
    <ToolbarButton label="Add numbered list" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListNumbers weight="duotone" aria-hidden="true" /></ToolbarButton>
    <ToolbarButton label="Add code block" active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()}><CodeBlock weight="duotone" aria-hidden="true" /></ToolbarButton>
    <ToolbarButton label="Add inline code" active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()}><Code weight="duotone" aria-hidden="true" /></ToolbarButton>
    <ParkButton ref={linkButtonRef} type="button" aria-label="Add link" aria-haspopup="dialog" aria-expanded={linkOpen} aria-pressed={editor.isActive('link')} disabled={readOnly} className={[composerStyles.toolbarButton, editor.isActive('link') ? composerStyles.toolbarButtonActive : ''].filter(Boolean).join(' ')} onMouseDown={event => event.preventDefault()} onClick={openLinkEditor}><LinkIcon weight="duotone" aria-hidden="true" /></ParkButton>
  </div>;
  return <section ref={rootRef} aria-label="Rich message composer" onDragOver={event => { if (!readOnly && event.dataTransfer.types.includes('Files')) event.preventDefault(); }} onDrop={receiveDrop} onPaste={receivePaste} className={composerStyles.root}>
    {format === 'markdown-v1' && <p className={composerStyles.formatHelp}>Type <kbd>/</kbd> for commands or <kbd>:</kbd> followed by an emoji name. Formatting controls use accessible rich text editing.</p>}
    <div onClickCapture={event => { if (readOnly) event.stopPropagation(); }} onKeyDownCapture={event => { if (readOnly) event.stopPropagation(); else handleEditorKeyDown(event); }}>
      {format === 'plain' ? (
        <ParkTextarea id={id} aria-label="Reply message" value={value} readOnly={readOnly} onChange={event => { if (!readOnly) onChange(event.target.value); }} className={composerStyles.input} />
      ) : (
        <div className={composerStyles.markdown} aria-busy={readOnly}>
          {editorToolbar}
        <EditorContent editor={editor} className={composerStyles.editor} aria-label="Reply message" aria-autocomplete="list" aria-controls={autocomplete ? listboxId : undefined} aria-activedescendant={autocomplete ? `${listboxId}-option-${activeIndex}` : undefined} onInput={handleLegacyInput} onChange={event => { if (!readOnly) { const next = (event.target as HTMLElement & { value?: string }).value ?? editor.getMarkdown(); legacyValueRef.current = next; if (editor.getMarkdown() !== next) editor.commands.setContent(next, { contentType: 'markdown', emitUpdate: false }); onChange(next); setAutocomplete(findComposerAutocomplete(next, next.length, hooks)); setActiveIndex(0); } }} onKeyDown={handleEditorKeyDown} />
        </div>
      )}
    </div>
    {autocomplete && <div id={listboxId} role="listbox" aria-label={autocomplete.kind === 'slash' ? 'Slash command suggestions' : 'Emoji suggestions'} className={composerStyles.autocomplete}>{autocomplete.options.map((option, index) => <ParkButton id={`${listboxId}-option-${index}`} key={`${option.kind}-${option.id}`} type="button" role="option" aria-selected={activeIndex === index} onMouseDown={event => event.preventDefault()} onClick={() => chooseAutocomplete(option)} className={composerStyles.autocompleteOption}>{option.displayLabel}</ParkButton>)}</div>}
    <p className={composerStyles.dropHelp}>Drop or paste a JPEG, PNG, GIF, or WebP image to attach it (10 MB each).</p>
    <ParkCollapsible.Root className={composerStyles.preview}>
      <ParkCollapsible.Trigger className={composerStyles.previewSummary}>Safe preview</ParkCollapsible.Trigger>
      <ParkCollapsible.Content>
        {format === 'plain' ? <div className={composerStyles.previewBody}>{value}</div> : <SafeMarkdown className={composerStyles.previewBody}>{value}</SafeMarkdown>}
      </ParkCollapsible.Content>
    </ParkCollapsible.Root>
    {typeof document !== 'undefined' && createPortal(<ParkDialog.Root open={linkOpen} onOpenChange={({ open }) => { if (!open) closeLinkEditor(); }}
      initialFocusEl={() => linkInputRef.current}
      finalFocusEl={() => focusEditorAfterLinkRef.current ? editor?.view.dom ?? null : linkButtonRef.current}
      closeOnInteractOutside={false} lazyMount unmountOnExit>
      <ParkDialog.Backdrop />
      <ParkDialog.Positioner>
        <ParkDialog.Content aria-labelledby={linkTitleId} className={css({ w: 'min(100% - 2rem, 26rem)' })}>
          <ParkDialog.Header><ParkDialog.Title id={linkTitleId}>Insert link</ParkDialog.Title></ParkDialog.Header>
          <form onSubmit={applyLink}>
            <ParkDialog.Body className={css({ display: 'grid', gap: '2' })}>
              <label htmlFor={linkInputId} className={css({ textStyle: 'label' })}>Link URL</label>
              <ParkInput ref={linkInputRef} id={linkInputId} type="text" inputMode="url" autoComplete="url" value={linkUrl}
                onChange={event => { setLinkUrl(event.target.value); if (linkError) setLinkError(''); }}
                aria-invalid={Boolean(linkError)} aria-describedby={linkError ? linkErrorId : undefined} />
              {linkError && <ParkAlert.Root role="alert" status="error"><ParkAlert.Content><ParkAlert.Description id={linkErrorId}>{linkError}</ParkAlert.Description></ParkAlert.Content></ParkAlert.Root>}
            </ParkDialog.Body>
            <ParkDialog.Footer>
              {editor?.isActive('link') && <ParkButton type="button" variant="outline" onClick={removeLink}><LinkBreak weight="duotone" aria-hidden="true" />Remove link</ParkButton>}
              <ParkButton type="button" variant="outline" onClick={closeLinkEditor}>Cancel</ParkButton>
              <ParkButton type="submit">Apply link</ParkButton>
            </ParkDialog.Footer>
          </form>
        </ParkDialog.Content>
      </ParkDialog.Positioner>
    </ParkDialog.Root>, document.body)}
  </section>;
}
