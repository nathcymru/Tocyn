import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { TocynButton, TocynInput } from '@luminatick/ui/primitives';
import { ParkSelect } from '@luminatick/ui/park';
import { dashboardApi } from '../../api/client';
import { assignmentIdentity } from '../../hooks/useTicketAssignment';
import { useAuthStore } from '../../store/authStore';

type Result = { id: string; title: string; status: string; category_id: string | null };
const validText = (value: unknown, maximum: number): value is string => typeof value === 'string' && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value);
function metadata(value: unknown): Result[] {
  if (!Array.isArray(value) || value.length > 1000) throw new Error('Unavailable');
  const ids = new Set<string>();
  return value.map(row => {
    if (!row || !validText(row.id, 256) || !row.id || ids.has(row.id) || !validText(row.title, 1024)
      || !validText(row.status, 64) || !(row.category_id === null || validText(row.category_id, 256))) throw new Error('Unavailable');
    ids.add(row.id);
    return { id: row.id, title: row.title, status: row.status, category_id: row.category_id };
  });
}

function ticketPage(value: unknown): { rows: Result[]; total: number } {
  if (!value || typeof value !== 'object') throw new Error('Unavailable');
  const page = value as { data?: unknown; meta?: { total?: unknown; page?: unknown; limit?: unknown; total_pages?: unknown } };
  const total = page.meta?.total;
  if (!Number.isSafeInteger(total) || (total as number) < 0 || page.meta?.page !== 1 || page.meta.limit !== 20
    || page.meta.total_pages !== Math.ceil((total as number) / 20) || !Array.isArray(page.data)
    || page.data.length !== Math.min(total as number, 20)) throw new Error('Unavailable');
  const ids = new Set<string>();
  const rows = page.data.map(row => {
    if (!row || !validText(row.id, 128) || !row.id || ids.has(row.id) || !validText(row.subject, 1024)
      || !['open', 'pending', 'resolved', 'closed'].includes(row.status)) throw new Error('Unavailable');
    ids.add(row.id); return { id: row.id, title: row.subject, status: row.status, category_id: null };
  });
  return { rows, total: total as number };
}

export function GlobalSearch({ shortcutsEnabled }: { shortcutsEnabled: boolean }) {
  const identity = useAuthStore(state => JSON.stringify([state.token, state.sessionGeneration, state.user?.tenant_id, state.user?.id, state.user?.role]));
  return <SearchSession key={identity} shortcutsEnabled={shortcutsEnabled} />;
}

function SearchSession({ shortcutsEnabled }: { shortcutsEnabled: boolean }) {
  const identity = assignmentIdentity();
  const location = useLocation();
  const token = useAuthStore(state => state.token), generation = useAuthStore(state => state.sessionGeneration);
  const input = useRef<HTMLInputElement>(null), request = useRef<AbortController | null>(null), epoch = useRef(0);
  const previewOpener = useRef<HTMLButtonElement | null>(null), previewHeading = useRef<HTMLHeadingElement>(null);
  const [type, setType] = useState('tickets'), [query, setQuery] = useState('');
  const [results, setResults] = useState<Result[]>([]), [selected, setSelected] = useState<Result | null>(null);
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { if (selected) previewHeading.current?.focus(); }, [selected]);
  const invalidate = () => { epoch.current++; request.current?.abort(); request.current = null; setResults([]); setSelected(null); setMessage(''); setBusy(false); };
  useEffect(() => { invalidate(); setQuery(''); return () => { epoch.current++; request.current?.abort(); }; }, [token, generation]);
  useEffect(() => {
    invalidate();
    setQuery('');
  }, [location.pathname, location.search]);
  useEffect(() => {
    const focus = (event: KeyboardEvent) => { if (shortcutsEnabled && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); input.current?.focus(); input.current?.select(); } };
    window.addEventListener('keydown', focus); return () => window.removeEventListener('keydown', focus);
  }, [shortcutsEnabled]);
  const clear = () => {
    invalidate(); setQuery(''); input.current?.focus();
  };
  const search = async () => {
    invalidate(); const text = query.trim();
    if (!validText(text, 256)) { setMessage('Use at most 256 characters without control characters.'); return; }
    if (!text) { clear(); return; }
    if (type === 'customers') return;
    const currentEpoch = epoch.current, controller = new AbortController(); request.current = controller; setBusy(true);
    const current = () => currentEpoch === epoch.current && !controller.signal.aborted && useAuthStore.getState().token === token && useAuthStore.getState().sessionGeneration === generation && assignmentIdentity() === identity;
    try {
      const response = await dashboardApi.boundedBlob(type === 'tickets' ? `/tickets?search=${encodeURIComponent(text)}&limit=20&page=1` : '/knowledge/articles', 1048576, ['application/json'], { signal: controller.signal });
      if (!current()) return;
      if (response.blob.size > 1048576) throw new Error('Unavailable');
      const raw = await response.blob.text(); if (!current()) return;
      const decoded: unknown = JSON.parse(raw);
      if (type === 'tickets') {
        const page = ticketPage(decoded);
        setResults(page.rows); setMessage(`${page.total} matching authorised tickets. Showing ${page.rows.length}.`);
        return;
      }
      const rows = metadata(decoded);
      const matches = rows.filter(row => row.title.toLowerCase().includes(text.toLowerCase())).sort((a, b) => a.title < b.title ? -1 : a.title > b.title ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      setResults(matches.slice(0, 20)); setMessage(`${matches.length} matching knowledge titles. Showing ${Math.min(matches.length, 20)}.`);
    } catch { if (current()) setMessage(type === 'tickets' ? 'Ticket search is unavailable. No partial results are shown.' : 'Knowledge search is unavailable. The complete authorised list could not be loaded within its limits.'); }
    finally { if (current()) setBusy(false); }
  };
  return <div className="tocyn-global-search-shell" onKeyDown={event => { if (event.key === 'Escape' && event.target !== input.current) { event.preventDefault(); invalidate(); input.current?.focus(); } }}>
    <label className="tocyn-global-search-type-label">Search result type <ParkSelect aria-label="Search result type" value={type} onChange={event => { invalidate(); setType(event.target.value); }} className="tocyn-form-control"><option value="tickets">Tickets</option><option value="knowledge">Knowledge</option><option value="customers">Customers</option></ParkSelect></label>
    <div className="tocyn-global-search-input-shell"><TocynInput ref={input} type="text" maxLength={256} value={query} aria-label={type === 'tickets' ? 'Search all tickets (global shell)' : `Search ${type} (global shell)`} aria-describedby="global-ticket-search-scope" aria-keyshortcuts={shortcutsEnabled ? 'Control+K Meta+K' : undefined} placeholder={type === 'tickets' ? 'Search all authorised tickets...' : type === 'knowledge' ? 'Search authorised knowledge titles...' : 'Customer search unavailable'} onChange={event => { invalidate(); setQuery(event.target.value); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void search(); } if (event.key === 'Escape') { event.preventDefault(); clear(); } }} className="tocyn-global-search" />
    <TocynButton type="button" aria-label={type === 'tickets' ? 'Clear global ticket search' : 'Clear global search'} disabled={!query && !message} onClick={clear} className="tocyn-search-clear">Clear</TocynButton>
    {shortcutsEnabled && <span data-tocyn-focus-decoration="" aria-hidden="true" className="tocyn-search-shortcut">⌘/Ctrl K</span>}</div>
    <p id="global-ticket-search-scope" className="tocyn-visually-hidden">{type === 'tickets' ? 'Searches all tickets you are authorised to access.' : type === 'knowledge' ? 'Searches titles in the complete authorised knowledge list.' : 'Customer search is unavailable.'} {shortcutsEnabled ? 'Press Command or Control K to focus this search.' : ''} Filter this view is available in the Inbox.</p>
    {(type === 'customers' || busy || message || selected) && <div className="tocyn-global-search-popover">
    {type === 'customers' ? <p role="status" className="tocyn-global-search-status">Customer search is not available in this workspace.</p> : (busy || message) ? <p role="status" className="tocyn-global-search-status">{busy ? 'Searching authorised results…' : message}</p> : null}
    {results.length > 0 && <ul aria-label={type === 'tickets' ? 'Ticket search results' : 'Knowledge search results'} className="tocyn-global-search-results">{results.map(row => <li key={row.id}>{type === 'tickets' ? <Link to={`/inbox/all/${encodeURIComponent(row.id)}`} className="tocyn-global-search-result-link">Open in All tickets: {row.title || 'Untitled ticket'}</Link> : <TocynButton type="button" onClick={event => { previewOpener.current = event.currentTarget; setSelected(row); }} className="tocyn-global-search-result-button">{row.title || 'Untitled knowledge'}</TocynButton>}</li>)}</ul>}
    {selected && <section aria-label="Knowledge result preview" className="tocyn-global-search-preview"><h2 ref={previewHeading} tabIndex={-1} className="tocyn-global-search-preview-title">{selected.title}</h2><p>Status: {selected.status}</p><p>Category reference: {selected.category_id ?? 'Uncategorised'}</p><TocynButton type="button" onClick={() => { setSelected(null); if (previewOpener.current?.isConnected) previewOpener.current.focus(); }}>Close preview</TocynButton></section>}
    </div>}
  </div>;
}
