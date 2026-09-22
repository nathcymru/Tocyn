import { useId, useLayoutEffect, useRef, useState } from 'react';
import { Field } from '@luminatick/ui/components';
import { ParkAlert, ParkButton, ParkEmptyState, ParkInput, ParkSkeleton } from '@luminatick/ui/park';
import { css } from '@luminatick/ui/styled-system/css';
import { dashboardApi } from '../api/client';
import { assignmentIdentity } from '../hooks/useTicketAssignment';
import type { KnowledgeDoc } from '../types';

const styles = {
  root: css({ display: 'grid', gap: '1rem', minWidth: '0', color: 'text.primary' }),
  search: css({ display: 'flex', flexWrap: 'wrap', alignItems: 'end', gap: '0.75rem' }),
  field: css({ flex: '1 1 15rem', minW: '0' }),
  input: css({ width: 'full' }),
  results: css({ display: 'grid', gap: '0.5rem', margin: '0', padding: '0', listStyle: 'none' }),
  result: css({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem', border: '1px solid', borderColor: 'border.input', borderRadius: 'l2', background: 'bg.surface', padding: '0.75rem' }),
  preview: css({ display: 'grid', gap: '0.75rem', border: '1px solid', borderColor: 'border.input', borderRadius: 'l2', background: 'bg.surface', padding: '1rem' }),
  previewTitle: css({ margin: '0', fontSize: 'lg', fontWeight: 'semibold' }),
  previewBody: css({ margin: '0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }),
};

export function KnowledgeBrowser({ articles, disabled, insertingId, onInsert }: {
  articles: KnowledgeDoc[]; disabled: boolean; insertingId?: string | null; onInsert: (article: KnowledgeDoc) => void;
}) {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState(false);
  const searchId = useId();
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
  return <div className={styles.root}>
    {inserting && <p role="status">Loading {inserting.title} for insertion…</p>}
    <form onSubmit={event => { event.preventDefault(); setQuery(input.trim()); setSearched(true); }} className={styles.search}>
      <Field.Root className={styles.field}>
        <Field.Label htmlFor={searchId}>Search knowledge titles</Field.Label>
        <ParkInput id={searchId} aria-describedby={`${searchId}-help`} value={input} onChange={event => setInput(event.target.value)} className={styles.input} />
        <Field.HelperText id={`${searchId}-help`}>Searches titles of the available internal knowledge articles.</Field.HelperText>
      </Field.Root>
      <ParkButton type="submit">Search titles</ParkButton>{searched && <ParkButton type="button" onClick={() => { setInput(''); setQuery(''); setSearched(true); }}>Clear knowledge search</ParkButton>}
    </form>
    {searched && <p role="status">{visible.length} matching knowledge article{visible.length === 1 ? '' : 's'}.</p>}
    {visible.length === 0 && <ParkEmptyState headingLevel={false} title={searched ? 'No knowledge titles match this search.' : 'No knowledge articles are available.'} action={searched ? <ParkButton type="button" variant="outline" onClick={() => { setInput(''); setQuery(''); }}>Clear search</ParkButton> : undefined} />}
    <ul className={styles.results}>{visible.map(article => <li key={article.id} className={styles.result}>
      <ParkButton type="button" onClick={event => { trigger.current = event.currentTarget; void load(article); }} aria-label={`Preview ${article.title}`}>Preview {article.title}</ParkButton>
      <ParkButton type="button" disabled={disabled} onClick={() => onInsert(article)} aria-label={`Insert ${article.title} into reply`}>Insert {article.title}</ParkButton>
    </li>)}</ul>
    {preview && <section aria-label="Knowledge preview" className={styles.preview}>
      <h4 ref={heading} tabIndex={-1} className={styles.previewTitle}>Preview: {preview.article.title}</h4>
      {preview.status === 'loading' && <div role="status" aria-busy="true" aria-label="Loading knowledge preview" className={css({ display: 'grid', gap: '2' })}>
        <span className={css({ srOnly: true })}>Loading knowledge preview…</span>
        <ParkSkeleton aria-hidden="true" className={css({ h: '4', w: 'full' })} />
        <ParkSkeleton aria-hidden="true" className={css({ h: '4', w: '4/5' })} />
        <ParkSkeleton aria-hidden="true" className={css({ h: '4', w: '3/5' })} />
      </div>}
      {preview.status === 'error' && <ParkAlert.Root role="alert" status="error"><ParkAlert.Content>
        <ParkAlert.Description>Knowledge preview could not be loaded. Your draft is unchanged.</ParkAlert.Description>
        <ParkButton type="button" variant="outline" onClick={() => void load(preview.article)}>Retry preview</ParkButton>
      </ParkAlert.Content></ParkAlert.Root>}
      {preview.status === 'ready' && <><p className={styles.previewBody}>{preview.text || 'This article has no preview content.'}</p>{preview.truncated && <p>Preview shows the first 4,000 characters. Insertion requests the article again.</p>}</>}
      <ParkButton type="button" onClick={close}>Close preview</ParkButton>
    </section>}
  </div>;
}
