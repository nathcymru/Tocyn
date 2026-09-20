import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { KnowledgePage } from '../pages/KnowledgePage';
const api=vi.hoisted(()=>({get:vi.fn(),post:vi.fn(),delete:vi.fn()}));
vi.mock('../api/client',()=>({dashboardApi:api}));
beforeEach(()=>{
 api.get.mockImplementation(async(path:string)=>path.endsWith('categories')?[{id:'category-a',name:'Synthetic category',parent_id:null}]:[{id:'article-a',title:'Synthetic article',category_id:'category-a',created_at:'2026-09-10',is_public:false}]);
 vi.spyOn(HTMLElement.prototype,'getClientRects').mockImplementation(function(this:HTMLElement){return (this.isConnected&&!this.closest('[hidden]')?[new DOMRect(0,0,100,44)]:[]) as unknown as DOMRectList;});
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.resetAllMocks();});
async function openDelete(category:boolean){
 render(<MemoryRouter><KnowledgePage/></MemoryRouter>);
 const opener=await screen.findByRole('button',{name:category?'Delete category Synthetic category':'Delete'});opener.focus();fireEvent.click(opener);
 const dialog=await screen.findByRole('dialog',{name:'Confirm Deletion'});
 await waitFor(()=>expect(within(dialog).getByRole('button',{name:'Cancel'})).toHaveFocus());return{opener,dialog};
}
it('exposes named category actions and cancels back to the category opener without deleting',async()=>{
 const {opener,dialog}=await openDelete(true);expect(dialog).toHaveTextContent('Synthetic category');
 expect(dialog).toHaveClass('dialog__content');
 expect(dialog).toHaveAccessibleDescription('Are you sure you want to delete the category "Synthetic category"?');
 expect(document.querySelector('.dialog__backdrop')).toBeInTheDocument();
 expect(dialog.querySelector('.dialog__header .dialog__title')).toHaveTextContent('Confirm Deletion');
 expect(dialog.querySelector('.dialog__body .dialog__description')).toHaveTextContent('Synthetic category');
 expect(dialog.querySelector('.dialog__footer')).toContainElement(within(dialog).getByRole('button',{name:'Cancel'}));
 fireEvent.pointerDown(document.body);fireEvent.click(document.body);expect(dialog).toBeInTheDocument();
 fireEvent.keyDown(document.activeElement!,{key:'Escape'});await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
 await waitFor(()=>expect(opener).toHaveFocus());expect(api.delete).not.toHaveBeenCalled();
 expect(screen.getByRole('button',{name:'Add subcategory to Synthetic category'}).parentElement).not.toHaveClass('hidden');
});
it('locks duplicate article deletion and dismissal, then retains the target on failure for retry',async()=>{
 let reject!:(error:Error)=>void;api.delete.mockImplementationOnce(()=>new Promise((_resolve,r)=>{reject=r;})).mockResolvedValueOnce({});
 const {dialog}=await openDelete(false);expect(dialog).toHaveTextContent('Synthetic article');
 const remove=within(dialog).getByRole('button',{name:'Delete'});fireEvent.click(remove);fireEvent.click(remove);expect(api.delete).toHaveBeenCalledTimes(1);
 expect(within(dialog).getByRole('button',{name:'Cancel'})).toBeDisabled();fireEvent.keyDown(document.activeElement!,{key:'Escape'});expect(screen.getByRole('dialog')).toBeInTheDocument();
 await act(async()=>reject(new Error('synthetic failure')));
 const alert=await within(dialog).findByRole('alert');
 expect(alert).toHaveClass('alert__root');
 expect(alert.querySelector('.alert__description')).toHaveTextContent('Deletion failed');
 expect(dialog).toHaveTextContent('Synthetic article');
 fireEvent.click(remove);await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
 expect(api.delete).toHaveBeenLastCalledWith('/knowledge/articles/article-a');expect(screen.getByRole('status')).toHaveTextContent('Deletion completed.');
 await waitFor(()=>expect(screen.getByRole('heading',{name:'Knowledge Base'})).toHaveFocus());
});
it('uses the category endpoint only after explicit confirmation',async()=>{
 api.delete.mockResolvedValue({});const {dialog}=await openDelete(true);expect(api.delete).not.toHaveBeenCalled();
 fireEvent.click(within(dialog).getByRole('button',{name:'Delete'}));await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
 expect(api.delete).toHaveBeenCalledExactlyOnceWith('/knowledge/categories/category-a');
});

it('exposes category selection as named pressed-state buttons',async()=>{
 render(<MemoryRouter><KnowledgePage/></MemoryRouter>);const category=await screen.findByRole('button',{name:'Synthetic category'});
 expect(category).toHaveAttribute('aria-pressed','false');const all=screen.getByRole('button',{name:'All Articles'});expect(all).toHaveAttribute('aria-pressed','true');
 fireEvent.click(category);expect(category).toHaveAttribute('aria-pressed','true');expect(all).toHaveAttribute('aria-pressed','false');
 fireEvent.click(all);expect(category).toHaveAttribute('aria-pressed','false');expect(all).toHaveAttribute('aria-pressed','true');
});

it('uses installed Park badges for article status and tier', async () => {
 api.get.mockImplementation(async (path: string) => path.endsWith('categories') ? [] : [
   { id: 'active', title: 'Active answer', category_id: null, created_at: '2026-09-10', status: 'active', tier: 'answer' },
   { id: 'processing', title: 'Processing SOP', category_id: null, created_at: '2026-09-10', status: 'processing', tier: 'sop' },
   { id: 'error', title: 'Failed answer', category_id: null, created_at: '2026-09-10', status: 'error', tier: 'answer' },
 ]);
 render(<MemoryRouter><KnowledgePage/></MemoryRouter>);
 const table = await screen.findByRole('table');
 for (const status of ['active', 'processing', 'error']) {
   expect(table.querySelector(`[data-status="${status}"]`)).toHaveClass('badge', 'badge--variant_subtle');
 }
 expect(table.querySelector('[data-tier="sop"]')).toHaveClass('badge', 'badge--variant_subtle');
 expect(table.querySelector('.page__knowledgeStatusBadge')).not.toBeInTheDocument();
});

it('wraps long category names while keeping selection and actions keyboard discoverable', async () => {
 const name = 'A long synthetic knowledge category name that requires accessible wrapping';
 api.get.mockImplementation(async (path: string) => path.endsWith('categories') ? [{ id: 'category-a', name, parent_id: null }] : []);
 render(<MemoryRouter><KnowledgePage/></MemoryRouter>);
 const category = await screen.findByRole('button',{name});
 expect(category).toHaveClass('white-space_normal','ov-wrap_anywhere','h_auto');
 expect(category.querySelector('span')).toHaveClass('white-space_normal','ov-wrap_anywhere');
 expect(category.closest('.page__knowledgeCategoryRow')).toHaveClass('d_grid','w_full');
 expect(screen.getByRole('button',{name:`Add subcategory to ${name}`})).toBeInTheDocument();
 expect(screen.getByRole('button',{name:`Delete category ${name}`})).toBeInTheDocument();
 category.focus();expect(category).toHaveFocus();
 fireEvent.click(category);expect(category).toHaveAttribute('aria-pressed','true');
});


it.each([
 ['Add Root Category','New root category name'],
 ['Add subcategory to Synthetic category','New subcategory name for Synthetic category'],
])('names the category input opened by %s',async(openerName,inputName)=>{
 render(<MemoryRouter><KnowledgePage/></MemoryRouter>);
 fireEvent.click(await screen.findByRole('button',{name:openerName}));
 const input=await screen.findByRole('textbox',{name:inputName});
 expect(input).toHaveFocus();
 fireEvent.keyDown(input,{key:'Escape'});
 await waitFor(()=>expect(screen.queryByRole('textbox',{name:inputName})).not.toBeInTheDocument());
});

it('shows Park loading and a retryable failure before the article table is empty', async () => {
 let fail = true;
 api.get.mockImplementation(async (path: string) => {
   if (fail) throw new Error('Synthetic knowledge outage');
   return path.endsWith('categories') ? [] : [];
 });
 render(<MemoryRouter><KnowledgePage/></MemoryRouter>);
 const outage = await screen.findByRole('alert');
 expect(outage).toHaveTextContent('Synthetic knowledge outage');
 expect(screen.queryByText('No articles found')).not.toBeInTheDocument();
 expect(outage).toHaveClass('emptyState__root');
 expect(screen.queryByRole('table')).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Add Root Category'})).not.toBeInTheDocument();
 fail = false;
 fireEvent.click(screen.getByRole('button',{name:'Retry knowledge'}));
 expect(screen.getByRole('status',{name:'Loading knowledge articles'})).toBeInTheDocument();
 expect(await screen.findByText('No articles found')).toBeInTheDocument();
 expect(screen.queryByRole('table')).not.toBeInTheDocument();
 expect(screen.getByText('No articles found').closest('.emptyState__root')).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Create article'})).toBeInTheDocument();
});

it('keeps confirmed categories and articles visible when a refresh fails, then recovers', async () => {
 let failRefresh = false;
 api.get.mockImplementation(async (path: string) => {
   if (failRefresh) throw new Error('Synthetic refresh outage');
   return path.endsWith('categories') ? [{id:'category-a',name:'Synthetic category',parent_id:null}] :
     [{id:'article-a',title:'Synthetic article',category_id:'category-a',created_at:'2026-09-10',is_public:false}];
 });
 api.post.mockResolvedValue({});
 render(<MemoryRouter><KnowledgePage/></MemoryRouter>);
 await screen.findByRole('link',{name:'Edit Synthetic article'});
 failRefresh = true;
 fireEvent.click(screen.getByRole('button',{name:'Add Root Category'}));
 const input = screen.getByRole('textbox',{name:'New root category name'});
 fireEvent.change(input,{target:{value:'Another category'}});
 fireEvent.keyDown(input,{key:'Enter'});
 const warning = await screen.findByRole('alert');
 expect(warning).toHaveTextContent('Knowledge could not be refreshed');
 expect(warning).toHaveTextContent('Showing the last loaded categories and articles');
 expect(screen.getByRole('link',{name:'Edit Synthetic article'})).toBeInTheDocument();
 expect(screen.getByRole('table')).toBeInTheDocument();
 expect(screen.queryByRole('status',{name:'Loading knowledge articles'})).not.toBeInTheDocument();
 failRefresh = false;
 fireEvent.click(screen.getByRole('button',{name:'Retry knowledge'}));
 await waitFor(()=>expect(screen.queryByRole('alert')).not.toBeInTheDocument());
 expect(screen.getByRole('link',{name:'Edit Synthetic article'})).toBeInTheDocument();
});

it('uses a named Park link to open an article from the table', async () => {
 render(<MemoryRouter><KnowledgePage/></MemoryRouter>);
 const edit = await screen.findByRole('link',{name:'Edit Synthetic article'});
 expect(edit).toHaveClass('link');
 expect(edit).toHaveAttribute('href','/knowledge/edit/article-a');
 expect(screen.getByRole('table')).toBeInTheDocument();
});

it('keeps long article titles readable in a keyboard-scrollable Park table region', async () => {
 const title = 'An exceptionally long synthetic knowledge title that should remain readable on a narrow screen without disappearing into a tiny table cell';
 api.get.mockImplementation(async (path: string) => path.endsWith('categories') ? [] : [{ id: 'article-a', title, category_id: null, created_at: '2026-09-10', status: 'active', tier: 'answer' }]);
 render(<MemoryRouter><KnowledgePage/></MemoryRouter>);
 const link = await screen.findByRole('link',{name:`Edit ${title}`});
 const region = screen.getByRole('region',{name:'Knowledge articles'});
 expect(region).toHaveAttribute('tabindex','0');
 expect(region).toHaveClass('ov-x_auto');
 expect(region.querySelector('table')).toHaveClass('table__root','min-w_44rem');
 expect(link).toHaveClass('link','white-space_normal','ov-wrap_anywhere','max-w_full');
 region.focus();
 expect(region).toHaveFocus();
 expect(link).toHaveAttribute('href','/knowledge/edit/article-a');
});
