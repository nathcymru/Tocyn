import { useLayoutEffect, useRef, useState } from 'react';
import { ParkButton, ParkInput } from '@luminatick/ui/park';
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
  return <div className="tocyn-knowledge-browser">
    {inserting && <p role="status">Loading {inserting.title} for insertion…</p>}
    <form onSubmit={event => { event.preventDefault(); setQuery(input.trim()); setSearched(true); }} className="tocyn-knowledge-search-form">
      <label className="tocyn-knowledge-search-label">Search knowledge titles<ParkInput value={input} onChange={event => setInput(event.target.value)} className="tocyn-knowledge-search-input" /></label>
      <p className="tocyn-knowledge-search-help">Searches titles of the available internal knowledge articles.</p>
      <ParkButton type="submit">Search titles</ParkButton>{searched && <ParkButton type="button" onClick={() => { setInput(''); setQuery(''); setSearched(true); }}>Clear knowledge search</ParkButton>}
    </form>
    {searched && <p role="status">{visible.length} matching knowledge article{visible.length === 1 ? '' : 's'}.</p>}
    {visible.length === 0 && <p>No knowledge titles match this search.</p>}
    <ul className="tocyn-knowledge-search-form">{visible.map(article => <li key={article.id} className="tocyn-knowledge-result">
      <ParkButton type="button" onClick={event => { trigger.current = event.currentTarget; void load(article); }} aria-label={`Preview ${article.title}`}>Preview {article.title}</ParkButton>
      <ParkButton type="button" disabled={disabled} onClick={() => onInsert(article)} aria-label={`Insert ${article.title} into reply`}>Insert {article.title}</ParkButton>
    </li>)}</ul>
    {preview && <section aria-label="Knowledge preview" className="tocyn-knowledge-search-form tocyn-knowledge-preview">
      <h4 ref={heading} tabIndex={-1} className="tocyn-knowledge-preview-title">Preview: {preview.article.title}</h4>
      {preview.status === 'loading' && <p role="status">Loading knowledge preview…</p>}
      {preview.status === 'error' && <><p role="alert">Knowledge preview could not be loaded. Your draft is unchanged.</p><ParkButton type="button" onClick={() => void load(preview.article)}>Retry preview</ParkButton></>}
      {preview.status === 'ready' && <><p className="tocyn-knowledge-preview-body">{preview.text || 'This article has no preview content.'}</p>{preview.truncated && <p>Preview shows the first 4,000 characters. Insertion requests the article again.</p>}</>}
      <ParkButton type="button" onClick={close}>Close preview</ParkButton>
    </section>}
  </div>;
}
