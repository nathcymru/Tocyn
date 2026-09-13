import { act,cleanup,renderHook,waitFor } from '@testing-library/react';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { dashboardApi } from '../../api/client';
import { useAuthStore } from '../../store/authStore';
import { useOperatorCapacity,validCapacity,type Capacity } from '../useOperatorCapacity';
vi.mock('../../api/client',async()=>({...await vi.importActual<typeof import('../../api/client')>('../../api/client'),dashboardApi:{get:vi.fn(),put:vi.fn()}}));
const row=(userId='target',revision=1):Capacity=>({userId,revision,availability:'available',assignmentCeiling:3,currentWork:2,status:'available',definitionVersion:'2026-09-11.3',asOf:'2026-09-13T13:00:00Z'});
const auth=(tenant='a')=>useAuthStore.getState().setAuth(`synthetic-${tenant}`,{id:'admin',tenant_id:tenant,email:`admin-${tenant}@example.test`,role:'admin',full_name:'Synthetic Admin',mfa_enabled:true});
beforeEach(()=>{vi.resetAllMocks();auth();});afterEach(()=>{cleanup();useAuthStore.getState().logout();});
it('discards a delayed read from the prior authentication generation',async()=>{
 let finish!:(value:Capacity)=>void;
 vi.mocked(dashboardApi.get).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValue(row('target',2));
 const {result}=renderHook(()=>useOperatorCapacity('target'));
 act(()=>auth('b'));await waitFor(()=>expect(result.current.data?.revision).toBe(2));
 await act(async()=>finish(row('target',1)));expect(result.current.data?.revision).toBe(2);
});
it('discards a delayed read when another operator is selected',async()=>{
 let finish!:(value:Capacity)=>void;
 vi.mocked(dashboardApi.get).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValue(row('second',4));
 const {result,rerender}=renderHook(({id})=>useOperatorCapacity(id),{initialProps:{id:'target'}});
 rerender({id:'second'});await waitFor(()=>expect(result.current.data?.userId).toBe('second'));
 await act(async()=>finish(row()));expect(result.current.data?.userId).toBe('second');
});
it('ignores a successful old-session write and does not label the new session saved',async()=>{
 vi.mocked(dashboardApi.get).mockResolvedValue(row());let finish!:(value:Capacity)=>void;
 vi.mocked(dashboardApi.put).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const {result}=renderHook(()=>useOperatorCapacity('target'));await waitFor(()=>expect(result.current.phase).toBe('ready'));
 let pending!:Promise<void>;act(()=>{pending=result.current.save({availability:'available',assignmentCeiling:4});});
 act(()=>auth('b'));await waitFor(()=>expect(result.current.phase).toBe('ready'));
 await act(async()=>{finish({...row('target',2),assignmentCeiling:4});await pending;});
 expect(result.current.phase).toBe('ready');expect(result.current.data?.assignmentCeiling).toBe(3);
});
it('validates unknown and unconfigured counts without accepting partial or mismatched data',()=>{
 expect(validCapacity({...row(),currentWork:null,status:'unavailable'},'target')).toBe(true);
 expect(validCapacity({...row(),revision:0,availability:null,assignmentCeiling:null,status:'unconfigured'},'target')).toBe(true);
 expect(validCapacity({...row(),revision:0,availability:null,assignmentCeiling:null,currentWork:null,status:'unavailable'},'target')).toBe(true);
 for(const bad of [{...row(),currentWork:1001},{...row(),currentWork:null},{...row(),userId:'other'},{...row(),status:'unconfigured'},{...row(),revision:0}])expect(validCapacity(bad,'target')).toBe(false);
});
