import { useLayoutEffect, useRef, useState } from 'react';
import { TocynButton, TocynInput } from '@luminatick/ui/primitives';
import { dashboardApi } from '../api/client';
import { assignmentIdentity } from '../hooks/useTicketAssignment';
import type { KnowledgeDoc } from '../types';

export function KnowledgeBrowser({ articles, disabled, insertingId, onInsert }: {
  articles: KnowledgeDoc[]; disabled: boolean; insertingId?: string | null; onInsert: (article: KnowledgeDoc) => void;
}) {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState(false);
  const [preview, setPreview] = useState<{ article: KnowledgeDoc; status: 'loading' | 'ready' | 'error'; text?: string; truncated?: boolean } | null>(null);
  const generation = useRef(0);
  const active = useRef(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => { active.current = true; return () => { active.current = false; generation.current++; }; }, []);
  useLayoutEffect(() => { if (preview) heading.current?.focus(); }, [preview?.article.id]);
  const inserting = articles.find(article => article.id === insertingId);
  const visible = articles.filter(article => article.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const load = async (article: KnowledgeDoc) => {
    const attempt = ++generation.current;
    const identity = assignmentIdentity();
    const current = () => active.current && generation.current === attempt && assignmentIdentity() === identity;
    setPreview({ article, status: 'loading' });
    try {
      const source = await dashboardApi.get<{ content: string }>(`/knowledge/articles/${encodeURIComponent(article.id)}/content`);
      if (!current()) return;
      if (typeof source.content !== 'string') throw new Error('Invalid knowledge content');
      setPreview({ article, status: 'ready', text: source.content.slice(0, 4000), truncated: source.content.length > 4000 });
    } catch { if (current()) setPreview({ article, status: 'error' }); }
  };
  const close = () => { generation.current++; setPreview(null); if (trigger.current?.isConnected) trigger.current.focus(); };
  return <div className="space-y-3">
    {inserting && <p role="status">Loading {inserting.title} for insertion…</p>}
    <form onSubmit={event => { event.preventDefault(); setQuery(input.trim()); setSearched(true); }} className="space-y-2">
      <label className="block text-sm">Search knowledge titles<TocynInput value={input} onChange={event => setInput(event.target.value)} className="mt-1 w-full rounded border p-2" /></label>
      <p className="text-xs text-slate-600">Searches titles of the available internal knowledge articles.</p>
      <TocynButton type="submit">Search titles</TocynButton>{searched && <TocynButton type="button" onClick={() => { setInput(''); setQuery(''); setSearched(true); }}>Clear knowledge search</TocynButton>}
    </form>
    {searched && <p role="status">{visible.length} matching knowledge article{visible.length === 1 ? '' : 's'}.</p>}
    {visible.length === 0 && <p>No knowledge titles match this search.</p>}
    <ul className="space-y-2">{visible.map(article => <li key={article.id} className="space-x-2">
      <TocynButton type="button" onClick={event => { trigger.current = event.currentTarget; void load(article); }} aria-label={`Preview ${article.title}`}>Preview {article.title}</TocynButton>
      <TocynButton type="button" disabled={disabled} onClick={() => onInsert(article)} aria-label={`Insert ${article.title} into reply`}>Insert {article.title}</TocynButton>
    </li>)}</ul>
    {preview && <section aria-label="Knowledge preview" className="space-y-2 rounded border border-slate-300 p-3">
      <h4 ref={heading} tabIndex={-1} className="font-semibold">Preview: {preview.article.title}</h4>
      {preview.status === 'loading' && <p role="status">Loading knowledge preview…</p>}
      {preview.status === 'error' && <><p role="alert">Knowledge preview could not be loaded. Your draft is unchanged.</p><TocynButton type="button" onClick={() => void load(preview.article)}>Retry preview</TocynButton></>}
      {preview.status === 'ready' && <><p className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words">{preview.text || 'This article has no preview content.'}</p>{preview.truncated && <p>Preview shows the first 4,000 characters. Insertion requests the article again.</p>}</>}
      <TocynButton type="button" onClick={close}>Close preview</TocynButton>
    </section>}
  </div>;
}
