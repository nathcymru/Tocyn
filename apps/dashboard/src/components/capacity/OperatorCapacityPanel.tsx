import React,{useEffect,useState} from 'react';
import { TocynButton,TocynInput } from '@luminatick/ui/primitives';
import { ParkSelect } from '@luminatick/ui/park';
import { useOperatorCapacity,type CapacityInput } from '../../hooks/useOperatorCapacity';

export function OperatorCapacityPanel({userId,editable=false}:{userId:string;editable?:boolean}){
  const capacity=useOperatorCapacity(userId);
  return <CapacityContent key={capacity.identity} capacity={capacity} editable={editable&&capacity.canWrite}/>;
}
function CapacityContent({capacity,editable}:{capacity:ReturnType<typeof useOperatorCapacity>;editable:boolean}){
  const [availability,setAvailability]=useState<CapacityInput['availability']>('available');
  const [ceiling,setCeiling]=useState('');const [dirty,setDirty]=useState(false);
  const id=React.useId();const {data,phase,message,needsReload}=capacity;
  useEffect(()=>{if(data&&!dirty){setAvailability(data.availability??'available');setCeiling(data.assignmentCeiling===null?'':String(data.assignmentCeiling));}},[data,dirty]);
  useEffect(()=>{if(phase==='saved')setDirty(false);},[phase]);
  const busy=phase==='loading'||phase==='saving';
  const value=ceiling.trim()===''?NaN:Number(ceiling);
  const valid=Number.isSafeInteger(value)&&value>=0&&value<=1000;
  const submit=async(event:React.FormEvent)=>{event.preventDefault();if(valid)await capacity.save({availability,assignmentCeiling:value});};
  return <div className="tocyn-capacity-panel">
    <p className="tocyn-capacity-description">Current work includes assigned open and pending conversations, including waiting and snoozed work.</p>
    {data&&<>
      <dl className="tocyn-capacity-summary">
        <dt>{phase==='ready'||phase==='saved'?'Current work':'Last confirmed work'}</dt><dd>{data.currentWork===null?'Unavailable — above the count limit':data.currentWork}</dd>
        <dt>Availability</dt><dd>{data.availability===null?'Not configured':data.availability==='available'?'Available':'Unavailable'}</dd>
        <dt>Assignment limit</dt><dd>{data.assignmentCeiling===null?'Not configured':data.assignmentCeiling}</dd>
      </dl>
      {data.revision===0&&<p className="tocyn-capacity-copy">No capacity policy is configured. Existing manual assignment behavior applies.</p>}
      {data.status==='unavailable'&&<p className="tocyn-capacity-copy">The exact count is unavailable. No partial total is shown.</p>}
      {data.currentWork!==null&&data.assignmentCeiling!==null&&data.currentWork>data.assignmentCeiling&&<p className="tocyn-capacity-copy">Existing work remains assigned above the limit. Further normal assignments are blocked.</p>}
      <p className="tocyn-capacity-confirmed">Confirmed at <time dateTime={data.asOf}>{new Date(data.asOf).toLocaleString()}</time>.</p>
    </>}
    <p role={phase==='error'||phase==='conflict'?'alert':'status'} aria-live="polite" className="tocyn-capacity-copy">
      {message??(phase==='loading'?'Loading current work…':phase==='idle'?'Current work is unavailable for this session.':'')}
    </p>
    <TocynButton type="button" disabled={busy} onClick={()=>void capacity.reload()} className="tocyn-capacity-refresh">
      {phase==='error'?'Retry':needsReload&&data?'Reload current policy':'Refresh current work'}
    </TocynButton>
    {editable&&<form onSubmit={submit} className="tocyn-capacity-form">
      <p className="tocyn-capacity-copy">Changes apply to new assignments. Existing work stays assigned.</p>
      <label htmlFor={`${id}-availability`} className="tocyn-capacity-label">Availability for assignments</label>
      <ParkSelect id={`${id}-availability`} value={availability} disabled={phase==='saving'} onChange={event=>{setAvailability(event.target.value as CapacityInput['availability']);setDirty(true);}}
        className="tocyn-form-control">
        <option value="available">Available</option><option value="unavailable">Unavailable</option>
      </ParkSelect>
      <label htmlFor={`${id}-ceiling`} className="tocyn-capacity-label">Assignment limit (0–1000)</label>
      <TocynInput id={`${id}-ceiling`} type="number" min={0} max={1000} step={1} value={ceiling} disabled={phase==='saving'}
        onChange={event=>{setCeiling(event.target.value);setDirty(true);}} className="tocyn-capacity-input"/>
      {data&&dirty&&<p className="tocyn-capacity-copy">Current saved policy: {data.availability??'not configured'}, limit {data.assignmentCeiling??'not configured'}. Your entered values are separate until saved.</p>}
      <TocynButton type="submit" disabled={busy||needsReload||!data||!valid||data.revision>=Number.MAX_SAFE_INTEGER} className="tocyn-capacity-save">Save capacity</TocynButton>
    </form>}
  </div>;
}
