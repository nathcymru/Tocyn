import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { KnowledgePage } from '../pages/KnowledgePage';
const api=vi.hoisted(()=>({get:vi.fn(),delete:vi.fn()}));
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
 fail = false;
 fireEvent.click(screen.getByRole('button',{name:'Retry knowledge'}));
 expect(screen.getByRole('status',{name:'Loading knowledge articles'})).toBeInTheDocument();
 expect(await screen.findByText('No articles found')).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Create article'})).toBeInTheDocument();
});

it('uses a named Park button to open an article from the table', async () => {
 render(<MemoryRouter><KnowledgePage/></MemoryRouter>);
 const edit = await screen.findByRole('button',{name:'Edit Synthetic article'});
 expect(edit).toBeInTheDocument();
});
