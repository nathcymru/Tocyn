import {useLayoutEffect} from 'react';
import { act,cleanup,render,screen,waitFor,within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { UsersPage } from '../pages/UsersPage';
import { dashboardApi } from '../api/client';
import { useAuthStore } from '../store/authStore';
vi.mock('../hooks/useUsers',()=>({useUsers:()=>({data:[
 {id:'first',full_name:'First Operator',email:'first@example.test',role:'agent',created_at:'2026-09-01'},
 {id:'second',full_name:'Second Operator',email:'second@example.test',role:'agent',created_at:'2026-09-01'},
 {id:'customer',full_name:'Customer',email:'customer@example.test',role:'customer',created_at:'2026-09-01'},
],isLoading:false,error:null})}));
vi.mock('../api/client',async()=>({...await vi.importActual<typeof import('../api/client')>('../api/client'),dashboardApi:{get:vi.fn(),put:vi.fn()}}));
const auth=(role='admin',tenant='a')=>useAuthStore.getState().setAuth(`synthetic-${tenant}`,{id:'admin',tenant_id:tenant,email:'admin@example.test',full_name:'Admin',role,mfa_enabled:true});
beforeEach(()=>{
 vi.resetAllMocks();auth();
 vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}});
 // JSDOM 29's mixed comma selectors group inputs/selects before buttons rather than DOM order.
 // Minimal native reproduction is recorded in the evidence receipt. Restore only ordering,
 // as browsers guarantee, so Ark's actual focus trap can be exercised in this simulator.
 const query=Element.prototype.querySelectorAll;
 vi.spyOn(Element.prototype,'querySelectorAll').mockImplementation(function(this:Element,selector:string){
   const result=query.call(this,selector);
   if(!selector.includes(','))return result;
   return Array.from(result).sort((a,b)=>a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING?-1:1) as unknown as NodeListOf<Element>;
 });
 vi.spyOn(HTMLElement.prototype,'getClientRects').mockImplementation(function(this:HTMLElement){return(this.isConnected&&!this.closest('[hidden]')?[new DOMRect(0,0,100,44)]:[])as unknown as DOMRectList;});
 vi.mocked(dashboardApi.get).mockImplementation(async(path:string)=>({userId:path.split('/')[2],revision:1,availability:'available',assignmentCeiling:3,currentWork:2,status:'available',definitionVersion:'2026-09-11.3',asOf:'2026-09-13T13:00:00Z'}));
});
afterEach(()=>{cleanup();useAuthStore.getState().logout();vi.restoreAllMocks();vi.unstubAllGlobals();});
it('loads only the selected operator and contains focus with Escape return to that card',async()=>{
 render(<UsersPage/>);expect(dashboardApi.get).not.toHaveBeenCalled();
 const openers=screen.getAllByRole('button',{name:'Capacity'});expect(openers).toHaveLength(2);
 openers[1].focus();await userEvent.keyboard('{Enter}');
 const dialog=await screen.findByRole('dialog',{name:'Operator capacity'});
 await waitFor(()=>expect(within(dialog).getByRole('spinbutton',{name:'Assignment limit (0–1000)'})).toHaveValue('3'));
 expect(dashboardApi.get).toHaveBeenCalledExactlyOnceWith('/operators/second/capacity');
 const close=within(dialog).getByRole('button',{name:'Close user details'});
 await waitFor(()=>expect(close).toHaveFocus());
 // Ark installs its focus trap on the next animation frame after initial focus.
 await act(async()=>{await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));});
 await userEvent.tab({shift:true});await waitFor(()=>expect(within(dialog).getByRole('button',{name:'Close'})).toHaveFocus());
 await userEvent.tab();expect(close).toHaveFocus();
 await userEvent.tab();expect(within(dialog).getByRole('button',{name:'Refresh current work'})).toHaveFocus();
 await userEvent.keyboard('{Escape}');await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
 await waitFor(()=>expect(openers[1]).toHaveFocus());
});
it('does not expose admin capacity controls to an agent and clears an open selection after an auth switch',async()=>{
 render(<UsersPage/>);await userEvent.click(screen.getAllByRole('button',{name:'Capacity'})[0]);
 await screen.findByRole('dialog',{name:'Operator capacity'});
 act(()=>auth('agent','b'));
 await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
 expect(screen.queryByRole('button',{name:'Capacity'})).not.toBeInTheDocument();
 expect(dashboardApi.put).not.toHaveBeenCalled();
});

it.each(['tenant','actor'])('clears same-ID selected details on direct %s identity change without a generation increment',async(kind)=>{
 let renderedDialog:string|null=null;
 function Observe(){const actor=useAuthStore(state=>state.user);useLayoutEffect(()=>{renderedDialog=document.querySelector('[role=dialog]')?.textContent??null;},[actor]);return <UsersPage/>;}
 render(<Observe/>);await userEvent.click(screen.getAllByRole('button',{name:'Capacity'})[0]);
 const dialog=await screen.findByRole('dialog',{name:'Operator capacity'});expect(dialog).toHaveTextContent('First Operator');
 const generation=useAuthStore.getState().sessionGeneration;
 await act(async()=>useAuthStore.setState(state=>({user:{...state.user!,...(kind==='tenant'?{tenant_id:'b'}:{id:'another-admin'})}})));
 expect(useAuthStore.getState().sessionGeneration).toBe(generation);
 // Ark may retain an empty shell until its exit effect; no prior identity content survives the render.
 expect(renderedDialog??'').toBe('');
 await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});
