import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { createListCollection } from '@ark-ui/react';
import { ParkButton, ParkGlobalSearch, ParkInput, ParkSelect, ParkVisuallyHidden } from '@luminatick/ui/park';
import { Link as ParkLink } from '@luminatick/ui/components';
import { dashboardApi } from '../../api/client';
import { assignmentIdentity } from '../../hooks/useTicketAssignment';
import { useAuthStore } from '../../store/authStore';
import { MagnifyingGlassIcon, X } from '../icons';
import { css } from '@luminatick/ui/styled-system/css';

const visuallyHidden = css({ position: 'absolute', width: '1px', height: '1px', padding: '0', margin: '-1px', overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: '0' });

type Result = { id: string; title: string; status: string; category_id: string | null; kind: 'ticket' | 'knowledge' | 'customer'; customer_email?: string };
const validText = (value: unknown, maximum: number): value is string => typeof value === 'string' && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value);
const searchScopeOptions = createListCollection({ items: [
  { label: 'All', value: 'all' },
  { label: 'Tickets', value: 'tickets' },
  { label: 'Customers', value: 'customers' },
  { label: 'Wiki', value: 'knowledge' },
] });
function metadata(value: unknown): Result[] {
  if (!Array.isArray(value) || value.length > 1000) throw new Error('Unavailable');
  const ids = new Set<string>();
  return value.map(row => {
    if (!row || !validText(row.id, 256) || !row.id || ids.has(row.id) || !validText(row.title, 1024)
      || !validText(row.status, 64) || !(row.category_id === null || validText(row.category_id, 256))) throw new Error('Unavailable');
    ids.add(row.id);
    return { id: row.id, title: row.title, status: row.status, category_id: row.category_id, kind: 'knowledge' };
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
  const rows: Result[] = page.data.map((row): Result => {
    if (!row || !validText(row.id, 128) || !row.id || ids.has(row.id) || !validText(row.subject, 1024)
      || !['open', 'pending', 'resolved', 'closed'].includes(row.status)
      || !validText(row.customer_email, 254)) throw new Error('Unavailable');
    ids.add(row.id); return { id: row.id, title: row.subject, status: row.status, category_id: null, kind: 'ticket', customer_email: row.customer_email };
  });
  return { rows, total: total as number };
}

export function GlobalSearch({ shortcutsEnabled }: { shortcutsEnabled: boolean }) {
  const identity = useAuthStore(state => JSON.stringify([state.token, state.sessionGeneration, state.user?.tenant_id, state.user?.id, state.user?.role]));
  return <SearchSession key={identity} shortcutsEnabled={shortcutsEnabled} />;
}

function SearchSession({ shortcutsEnabled }: { shortcutsEnabled: boolean }) {
  const styles = ParkGlobalSearch();
  const identity = assignmentIdentity();
  const location = useLocation();
  const token = useAuthStore(state => state.token), generation = useAuthStore(state => state.sessionGeneration);
  const input = useRef<HTMLInputElement>(null), request = useRef<AbortController | null>(null), epoch = useRef(0);
  const previewOpener = useRef<HTMLButtonElement | null>(null), previewHeading = useRef<HTMLHeadingElement>(null);
  const [type, setType] = useState('all'), [query, setQuery] = useState('');
  const [scopeOpen, setScopeOpen] = useState(false);
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
    const currentEpoch = epoch.current, controller = new AbortController(); request.current = controller; setBusy(true);
    const current = () => currentEpoch === epoch.current && !controller.signal.aborted && useAuthStore.getState().token === token && useAuthStore.getState().sessionGeneration === generation && assignmentIdentity() === identity;
    try {
      const response = await dashboardApi.boundedBlob(type === 'knowledge' ? '/knowledge/articles' : `/tickets?search=${encodeURIComponent(text)}&limit=20&page=1`, 1048576, ['application/json'], { signal: controller.signal });
      if (!current()) return;
      if (response.blob.size > 1048576) throw new Error('Unavailable');
      const raw = await response.blob.text(); if (!current()) return;
      const decoded: unknown = JSON.parse(raw);
      if (type === 'all' || type === 'tickets') {
        const page = ticketPage(decoded);
        setResults(page.rows); setMessage(`${page.total} matching authorised tickets. Showing ${page.rows.length}.`);
        return;
      }
      if (type === 'customers') {
        const page = ticketPage(decoded);
        const customers = new Map<string, Result>();
        for (const row of page.rows) {
          const email = row.customer_email?.toLowerCase();
          if (email && !customers.has(email)) customers.set(email, { id: `customer:${email}`, title: email, status: 'Customer', category_id: null, kind: 'customer', customer_email: email });
        }
        const matches = [...customers.values()].filter(row => row.title.includes(text.toLowerCase())).slice(0, 20);
        setResults(matches); setMessage(`${matches.length} matching authorised customers. Showing ${matches.length}.`);
        return;
      }
      const rows = metadata(decoded);
      const matches = rows.filter(row => row.title.toLowerCase().includes(text.toLowerCase())).sort((a, b) => a.title < b.title ? -1 : a.title > b.title ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      setResults(matches.slice(0, 20)); setMessage(`${matches.length} matching knowledge titles. Showing ${Math.min(matches.length, 20)}.`);
    } catch { if (current()) setMessage(type === 'all' || type === 'tickets' ? 'Ticket search is unavailable. No partial results are shown.' : type === 'customers' ? 'Customer search is unavailable. No partial results are shown.' : 'Knowledge search is unavailable. The complete authorised list could not be loaded within its limits.'); }
    finally { if (current()) setBusy(false); }
  };
  return <div className={styles.root} onKeyDown={event => { if (event.key === 'Escape' && event.target !== input.current) { event.preventDefault(); invalidate(); input.current?.focus(); } }}>
    <div className={styles.inputShell}><MagnifyingGlassIcon aria-hidden="true" className={styles.icon} /><ParkInput ref={input} type="text" maxLength={256} value={query} aria-label={type === 'all' || type === 'tickets' ? 'Search all tickets (global shell)' : `Search authorised ${type} (global shell)`} aria-describedby="global-ticket-search-scope" aria-keyshortcuts={shortcutsEnabled ? 'Control+K Meta+K' : undefined} placeholder={type === 'all' || type === 'tickets' ? 'Search...' : type === 'knowledge' ? 'Search authorised knowledge titles...' : 'Search authorised customers...'} onFocus={() => setScopeOpen(false)} onChange={event => { invalidate(); setQuery(event.target.value); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void search(); } if (event.key === 'Escape') { event.preventDefault(); clear(); } }} className={styles.input} />
    {query && <ParkButton type="button" variant="plain" aria-label="Clear global ticket search" onClick={clear} className={styles.clear}><X aria-hidden="true" /></ParkButton>}
    {shortcutsEnabled && <span data-tocyn-focus-decoration="" aria-hidden="true" className={styles.shortcut}>⌘K</span>}</div>
    <span className={styles.divider} aria-hidden="true" />
    <div className={styles.scope}><ParkVisuallyHidden id="global-search-scope-label">Search scope filter</ParkVisuallyHidden><ParkSelect.Root collection={searchScopeOptions as never} value={[type]} open={scopeOpen} onOpenChange={({ open }) => setScopeOpen(open)} onValueChange={({ value }) => { const next = value[0]; if (!next) return; setScopeOpen(false); invalidate(); setType(next); }} positioning={{ placement: 'bottom-end' }}>
      <ParkSelect.Label className={visuallyHidden}>Search scope filter</ParkSelect.Label>
      <ParkSelect.Control><ParkSelect.Trigger aria-labelledby="global-search-scope-label"><ParkSelect.ValueText placeholder="All" /></ParkSelect.Trigger><ParkSelect.IndicatorGroup><ParkSelect.Indicator aria-hidden="true" /></ParkSelect.IndicatorGroup></ParkSelect.Control>
      <ParkSelect.HiddenSelect />
      <ParkSelect.Positioner><ParkSelect.Content><ParkSelect.List>{searchScopeOptions.items.map(item => { const option = item as { label: string; value: string }; return <ParkSelect.Item key={option.value} item={option}><ParkSelect.ItemText>{option.label}</ParkSelect.ItemText><ParkSelect.ItemIndicator /></ParkSelect.Item>; })}</ParkSelect.List></ParkSelect.Content></ParkSelect.Positioner>
    </ParkSelect.Root></div>
    <ParkVisuallyHidden id="global-ticket-search-scope">{type === 'all' || type === 'tickets' ? 'Searches all tickets you are authorised to access.' : type === 'knowledge' ? 'Searches titles in the complete authorised knowledge list.' : 'Searches customer identities attached to tickets you are authorised to access.'} {shortcutsEnabled ? 'Press Command or Control K to focus this search.' : ''} Filter this view is available in the Inbox.</ParkVisuallyHidden>
    {(type === 'customers' || busy || message || selected) && <div className={styles.popover}>
    {(busy || message) && <p role="status" className={styles.status}>{busy ? 'Searching authorised results…' : message}</p>}
    {results.length > 0 && <ul aria-label={type === 'all' || type === 'tickets' ? 'Ticket search results' : type === 'knowledge' ? 'Knowledge search results' : 'Customer search results'} className={styles.results}>{results.map(row => <li key={row.id}>{type === 'all' || type === 'tickets' ? <ParkLink asChild variant="plain"><Link to={`/inbox/all/${encodeURIComponent(row.id)}`} className={`${styles.result} ${css({ minW: 0, maxW: 'full', whiteSpace: 'normal', overflowWrap: 'anywhere' })}`}>Open in All tickets: {row.title || 'Untitled ticket'}</Link></ParkLink> : <ParkButton type="button" onClick={event => { previewOpener.current = event.currentTarget; setSelected(row); }} className={styles.result}>{row.title || (type === 'customers' ? 'Unnamed customer' : 'Untitled knowledge')}</ParkButton>}</li>)}</ul>}
    {selected && <section aria-label="Knowledge result preview" className={styles.preview}><h2 ref={previewHeading} tabIndex={-1}>{selected.title}</h2><p>Status: {selected.status}</p><p>Category reference: {selected.category_id ?? 'Uncategorised'}</p><ParkButton type="button" onClick={() => { setSelected(null); if (previewOpener.current?.isConnected) previewOpener.current.focus(); }}>Close preview</ParkButton></section>}
    </div>}
  </div>;
}
