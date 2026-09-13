import { useEffect,useMemo,useSyncExternalStore } from 'react';
import { ApiError,dashboardApi } from '../api/client';
import { useAuthStore } from '../store/authStore';
export type CapacityInput={availability:'available'|'unavailable';assignmentCeiling:number};
export type Capacity={userId:string;revision:number;availability:CapacityInput['availability']|null;assignmentCeiling:number|null;
  currentWork:number|null;status:'available'|'unconfigured'|'unavailable';definitionVersion:'2026-09-11.3';asOf:string};
export function validCapacity(value:unknown,targetId:string):value is Capacity{
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const v=value as Capacity,integer=(n:unknown,max:number)=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0&&n<=max;
  if(v.userId!==targetId||!integer(v.revision,Number.MAX_SAFE_INTEGER)||v.definitionVersion!=='2026-09-11.3'
    ||typeof v.asOf!=='string'||!Number.isFinite(Date.parse(v.asOf)))return false;
  const configured=v.revision>0&&(v.availability==='available'||v.availability==='unavailable')&&integer(v.assignmentCeiling,1000);
  const unconfigured=v.revision===0&&v.availability===null&&v.assignmentCeiling===null;
  return (configured||unconfigured)&&((v.status==='unavailable'&&v.currentWork===null)
    ||(integer(v.currentWork,1000)&&v.status===(configured?'available':'unconfigured')));
}
type State={data:Capacity|null;phase:'idle'|'loading'|'ready'|'saving'|'saved'|'error'|'conflict';message:string|null;needsReload:boolean};
function controller(targetId:string|null,canWrite:boolean){
  let state:State={data:null,phase:targetId?'loading':'idle',message:null,needsReload:true};
  let active=false,epoch=0;const listeners=new Set<()=>void>();
  const set=(next:State)=>{state=next;listeners.forEach(fn=>fn());};
  const current=(e:number)=>active&&epoch===e;
  const reload=async()=>{
    if(!active||!targetId||state.phase==='saving')return;
    const e=++epoch,afterConflict=state.needsReload&&state.data!==null;
    set({...state,phase:'loading',message:afterConflict?'Reloading current policy; your entered values are retained.':null,needsReload:true});
    try{
      const data=await dashboardApi.get<unknown>(`/operators/${encodeURIComponent(targetId)}/capacity`);
      if(!current(e))return;
      if(!validCapacity(data,targetId))throw new Error('Invalid capacity response');
      set({data,phase:'ready',message:afterConflict?'Current policy reloaded. Review your entered values before saving again.':null,needsReload:false});
    }catch{if(current(e))set({...state,phase:'error',message:'Current work could not be loaded. Retry to reload the current policy.',needsReload:true});}
  };
  const save=async(input:CapacityInput)=>{
    if(!active||!targetId||!canWrite||!state.data||state.needsReload||state.phase==='saving'||state.phase==='loading'
      ||!Number.isSafeInteger(input.assignmentCeiling)||input.assignmentCeiling<0||input.assignmentCeiling>1000
      ||!['available','unavailable'].includes(input.availability)||state.data.revision>=Number.MAX_SAFE_INTEGER)return;
    const e=++epoch,expectedRevision=state.data.revision;
    set({...state,phase:'saving',message:'Saving capacity…'});
    try{
      const data=await dashboardApi.put<unknown>(`/operators/${encodeURIComponent(targetId)}/capacity`,{...input,expectedRevision});
      if(!current(e))return;
      if(!validCapacity(data,targetId)||data.revision!==expectedRevision+1||data.availability!==input.availability||data.assignmentCeiling!==input.assignmentCeiling)
        throw new Error('Invalid capacity save response');
      set({data,phase:'saved',message:'Capacity saved.',needsReload:false});
    }catch(error){if(current(e))set({...state,phase:error instanceof ApiError&&error.status===409?'conflict':'error',needsReload:true,
      message:error instanceof ApiError&&error.status===409?'Capacity changed elsewhere. Your entered values are retained. Reload current policy before saving again.'
        :'The save could not be confirmed. Your entered values are retained. Reload current policy before trying again.'});}
  };
  return {subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>listeners.delete(fn);},getSnapshot:()=>state,reload,save,
    start:()=>{active=true;void reload();return()=>{active=false;epoch++;};}};
}
export function useOperatorCapacity(targetId:string|null){
  const user=useAuthStore(s=>s.user),generation=useAuthStore(s=>s.sessionGeneration);
  const tenantId=user?.tenant_id,actorId=user?.id,role=user?.role;
  const authorized=!!tenantId&&!!actorId&&(role==='admin'||(role==='agent'&&targetId===actorId));
  const store=useMemo(()=>controller(authorized?targetId:null,role==='admin'),[authorized,targetId,tenantId,actorId,role,generation]);
  const state=useSyncExternalStore(store.subscribe,store.getSnapshot,store.getSnapshot);
  useEffect(store.start,[store]);
  return {...state,reload:store.reload,save:store.save,canWrite:authorized&&role==='admin',identity:JSON.stringify([generation,tenantId,actorId,targetId,role])};
}
