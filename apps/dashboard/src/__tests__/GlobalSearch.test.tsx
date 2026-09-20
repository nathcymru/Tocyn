import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { GlobalSearch } from '../components/layout/GlobalSearch';
import { dashboardApi } from '../api/client';
import { useAuthStore } from '../store/authStore';
vi.mock('../api/client', () => ({ dashboardApi: { boundedBlob: vi.fn() } }));
const row = (id: string) => ({ id, title: `Guide ${id}`, status: 'ready', category_id: null, customer_email: `${id}@example.test` });
const response = (rows: unknown) => ({ blob: new Blob([JSON.stringify(rows)]), contentType: 'application/json' });
function Location() { const location = useLocation(); return <output aria-label="Current route">{location.pathname}{location.search}</output>; }
function mount(path='/inbox/mine?priority=urgent') { render(<MemoryRouter initialEntries={[path]}><GlobalSearch shortcutsEnabled /><Location /></MemoryRouter>); }
async function selectScope(value: 'all' | 'tickets' | 'customers' | 'knowledge') { const label = value === 'knowledge' ? 'Wiki' : value[0].toUpperCase() + value.slice(1); await userEvent.click(screen.getByRole('combobox', { name: 'Search scope filter' })); await userEvent.click(await screen.findByRole('option', { name: label }));
  // Ark Select returns focus to its trigger on the next frame after selection.
  await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
  const scope = screen.getByRole('combobox', { name: 'Search scope filter' });
  expect(scope).toHaveAttribute('aria-expanded', 'false');
  expect(scope).toHaveTextContent(label);
  const input = screen.getByRole('textbox');
  await userEvent.click(input);
  expect(input).toHaveFocus(); }
async function knowledge(query='Guide') { await selectScope('knowledge'); const input=screen.getByRole('textbox'); await userEvent.type(input,query); expect(input).toHaveValue(query); await userEvent.keyboard('{Enter}'); }
beforeEach(()=>{ vi.clearAllMocks(); useAuthStore.setState({token:'synthetic-a',sessionGeneration:1,user:{id:'actor-a',tenant_id:'tenant-a',role:'admin',email:'synthetic@example.test',full_name:'Synthetic',mfa_enabled:true}}); });
afterEach(cleanup);
it('searches complete metadata, shows first20 with exact total, and previews without editor navigation',async()=>{
 vi.mocked(dashboardApi.boundedBlob).mockResolvedValue(response(Array.from({length:25},(_,i)=>row(String(i)))));
 mount(); await knowledge(); expect(await screen.findByText('25 matching knowledge titles. Showing 20.')).toBeVisible();
 expect(screen.getByRole('list')).toBeVisible(); expect(screen.getAllByRole('listitem')).toHaveLength(20);
 await userEvent.click(screen.getByRole('button',{name:'Guide 0'})); expect(screen.getByRole('region',{name:'Knowledge result preview'})).toBeVisible(); expect(screen.getByRole('heading',{name:'Guide 0'})).toHaveFocus();
 await userEvent.click(screen.getByRole('button',{name:'Close preview'})); expect(screen.getByRole('button',{name:'Guide 0'})).toHaveFocus();
 expect(screen.getByLabelText('Current route')).toHaveTextContent('/inbox/mine?priority=urgent');
 expect(dashboardApi.boundedBlob).toHaveBeenCalledWith('/knowledge/articles',1048576,['application/json'],expect.objectContaining({signal:expect.any(AbortSignal)}));
});
it('searches authorised customers from ticket identities and clear/type switching retain current work view and focus',async()=>{
 vi.mocked(dashboardApi.boundedBlob).mockResolvedValue(response({data:[{id:'ticket-1',subject:'Synthetic',status:'open',customer_email:'someone@example.test'}],meta:{total:1,page:1,limit:20,total_pages:1}}));
 mount(); await selectScope('customers');
 await userEvent.type(screen.getByRole('textbox'),'someone{Enter}'); expect(await screen.findByText('1 matching authorised customers. Showing 1.')).toBeVisible();
 expect(screen.getByRole('list',{name:'Customer search results'})).toBeVisible();
 expect(dashboardApi.boundedBlob).toHaveBeenCalledWith('/tickets?search=someone&limit=20&page=1',1048576,['application/json'],expect.anything());
 await userEvent.keyboard('{Escape}'); expect(screen.getByRole('textbox')).toHaveFocus(); expect(screen.getByRole('textbox')).toHaveValue('');
 expect(screen.getByLabelText('Current route')).toHaveTextContent('/inbox/mine?priority=urgent');
});
it('ticket query and keyboard clear never visit legacy route or change the current filter',async()=>{
 const page={data:[{id:'ticket-1',subject:'Synthetic result',status:'open',customer_email:'someone@example.test'}],meta:{total:1,page:1,limit:20,total_pages:1}};
 vi.mocked(dashboardApi.boundedBlob).mockResolvedValue(response(page));
 mount('/inbox/mine?priority=urgent');
  await userEvent.type(screen.getByRole('textbox',{name:'Search all tickets (global shell)'}),'Synthetic{Enter}');
  expect(await screen.findByText('1 matching authorised tickets. Showing 1.')).toBeVisible();
  expect(screen.getByLabelText('Current route')).toHaveTextContent('/inbox/mine?priority=urgent');
  expect(screen.getByRole('link',{name:'Open in All tickets: Synthetic result'})).toHaveAttribute('href','/inbox/all/ticket-1');
  expect(dashboardApi.boundedBlob).toHaveBeenCalledWith('/tickets?search=Synthetic&limit=20&page=1',1048576,['application/json'],expect.anything());
  fireEvent.keyDown(screen.getByRole('textbox',{name:'Search all tickets (global shell)'}),{key:'Escape'});expect(screen.getByRole('textbox')).toHaveValue('');expect(screen.getByLabelText('Current route')).toHaveTextContent('/inbox/mine?priority=urgent');
});
it('uses the Park link for a wrapping ticket result and opens its authorised route from the keyboard',async()=>{
 const title=Array(8).fill('A long conversation subject').join(' ');
 const page={data:[{id:'ticket-1',subject:title,status:'open',customer_email:'someone@example.test'}],meta:{total:1,page:1,limit:20,total_pages:1}};
 vi.mocked(dashboardApi.boundedBlob).mockResolvedValue(response(page));
 mount();
 await userEvent.type(screen.getByRole('textbox',{name:'Search all tickets (global shell)'}),'conversation{Enter}');
 const result=await screen.findByRole('link',{name:`Open in All tickets: ${title}`});
 expect(result).toHaveClass('link','link--variant_plain','globalSearch__result','ov-wrap_anywhere','white-space_normal');
 expect(result).toHaveAttribute('href','/inbox/all/ticket-1');
 result.focus();expect(result).toHaveFocus();
 await userEvent.keyboard('{Enter}');
 expect(screen.getByLabelText('Current route')).toHaveTextContent('/inbox/all/ticket-1');
});
for(const [label,meta] of [['wrong count',{total:2,page:1,limit:20,total_pages:1}],['wrong page',{total:1,page:2,limit:20,total_pages:1}]])it(`ticket ${label} fails without partial results`,async()=>{
 vi.mocked(dashboardApi.boundedBlob).mockResolvedValue(response({data:[{id:'ticket-1',subject:'Synthetic',status:'open'}],meta}));mount();await userEvent.type(screen.getByRole('textbox'),'Synthetic{Enter}');expect(await screen.findByText(/Ticket search is unavailable/)).toBeVisible();expect(screen.queryByRole('link')).not.toBeInTheDocument();
});
for(const variant of ['query','type','identity'] as const)it(`discards delayed metadata after ${variant} changes`,async()=>{
 let release!:(value:ReturnType<typeof response>)=>void;vi.mocked(dashboardApi.boundedBlob).mockReturnValue(new Promise(resolve=>{release=resolve;}));
 mount();await knowledge();await waitFor(()=>expect(dashboardApi.boundedBlob).toHaveBeenCalled());const signal=vi.mocked(dashboardApi.boundedBlob).mock.calls[0][3]!.signal!;
 if(variant==='query')await userEvent.type(screen.getByRole('textbox'),'changed');
 if(variant==='type')await selectScope('customers');
 if(variant==='identity')act(()=>useAuthStore.setState({token:'synthetic-b',sessionGeneration:2}));
 expect(signal.aborted).toBe(true);await act(async()=>release(response([row('late')])));expect(screen.queryByText('Guide late')).not.toBeInTheDocument();
});
for(const [name,value] of [['row overflow',Array.from({length:1001},(_,i)=>row(String(i)))],['invalid shape',[{id:'a',title:'unsafe'}]],['duplicate',[row('a'),row('a')]]] as const)it(`rejects complete list ${name} without partial results`,async()=>{
 vi.mocked(dashboardApi.boundedBlob).mockResolvedValue(response(value));mount();await knowledge();expect(await screen.findByText(/Knowledge search is unavailable/, {}, { timeout: 5000 })).toBeVisible();expect(screen.queryByRole('list')).not.toBeInTheDocument();
});
it('rejects over1MiB body and control characters',async()=>{
 vi.mocked(dashboardApi.boundedBlob).mockResolvedValue({blob:new Blob([' '.repeat(1048577)]),contentType:'application/json'});mount();await knowledge();expect(await screen.findByText(/Knowledge search is unavailable/)).toBeVisible();
 fireEvent.change(screen.getByRole('textbox'),{target:{value:'bad\u0000query'}});await userEvent.keyboard('{Enter}');expect(await screen.findByText(/without control characters/)).toBeVisible();expect(dashboardApi.boundedBlob).toHaveBeenCalledTimes(1);
});
it('fences identity changes during blob decoding and supports keyboard shortcut',async()=>{
 let finish!:(value:string)=>void;const blob={size:20,text:()=>new Promise<string>(resolve=>{finish=resolve;})} as Blob;
 vi.mocked(dashboardApi.boundedBlob).mockResolvedValue({blob,contentType:'application/json'});mount();await userEvent.keyboard('{Control>}k{/Control}');expect(screen.getByRole('textbox')).toHaveFocus();await knowledge();await waitFor(()=>expect(finish).toBeTypeOf('function'));
 act(()=>useAuthStore.setState({sessionGeneration:3}));await act(async()=>finish(JSON.stringify([row('late')])));expect(screen.queryByText('Guide late')).not.toBeInTheDocument();
});

for (const [field,value] of [['tenant_id','tenant-b'],['id','actor-b'],['role','agent']] as const) it(`clears visible results and pending decoding on same-generation ${field} change`, async()=>{
 vi.mocked(dashboardApi.boundedBlob).mockResolvedValue(response([row('visible')]));mount();await knowledge();await screen.findByText('Guide visible');
 const original=useAuthStore.getState().user![field]; act(()=>useAuthStore.getState().updateUser({[field]:value})); expect(screen.queryByText('Guide visible')).not.toBeInTheDocument();
 let finish!:(text:string)=>void;vi.mocked(dashboardApi.boundedBlob).mockResolvedValue({blob:{size:20,text:()=>new Promise<string>(resolve=>{finish=resolve;})} as Blob,contentType:'application/json'});
 await knowledge();await waitFor(()=>expect(finish).toBeTypeOf('function'));
 act(()=>useAuthStore.getState().updateUser({[field]:original}));expect(screen.queryByText('Guide visible')).not.toBeInTheDocument();
 await act(async()=>finish(JSON.stringify([row('late')])));expect(screen.queryByText('Guide late')).not.toBeInTheDocument();expect(screen.getByRole('textbox')).toHaveValue('');
});
