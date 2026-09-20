import React,{useEffect,useState} from 'react';
import { ParkAlert, ParkButton, ParkEmptyState, ParkInput, ParkSkeleton, ParkVisuallyHidden } from '@luminatick/ui/park';
import { Field } from '@luminatick/ui/components';
import { css } from '@luminatick/ui/styled-system/css';
import { useOperatorCapacity,type CapacityInput } from '../../hooks/useOperatorCapacity';
import { DashboardSelect } from '../DashboardSelect';

const capacityStyles = {
  panel: css({ display: 'grid', gap: '1rem', minWidth: '0' }),
  summary: css({ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.5rem', '& dt': { color: 'text.muted' }, '& dd': { margin: '0', fontFamily: 'tabular', fontVariantNumeric: 'tabular-nums' } }),
  form: css({ display: 'grid', gap: '0.75rem', paddingTop: '1rem' }),
  note: css({ margin: '0', color: 'text.muted', overflowWrap: 'anywhere' }),
};

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
  const statusText=message??(phase==='loading'?'Loading current work…':phase==='idle'?'Current work is unavailable for this session.':'');
  if(!data&&phase==='loading')return <div className={capacityStyles.panel} role="status" aria-live="polite">
    <ParkVisuallyHidden>Loading current work…</ParkVisuallyHidden>
    <ParkSkeleton className={css({ h: '5', w: '70%' })}/>
    <ParkSkeleton className={css({ h: '5', w: '90%' })}/>
    <ParkSkeleton className={css({ h: '5', w: '55%' })}/>
  </div>;
  if(!data)return <ParkEmptyState
    headingLevel={3}
    title={phase==='idle'?'Current work unavailable for this session':'Current work unavailable'}
    description={message??'The current policy could not be confirmed.'}
    action={phase==='error'||phase==='conflict'?<ParkButton type="button" onClick={()=>void capacity.reload()}>Retry</ParkButton>:undefined}
  />;
  return <div className={capacityStyles.panel}>
    <p className={capacityStyles.note}>Current work includes assigned open and pending conversations, including waiting and snoozed work.</p>
    {data&&<>
      <dl className={capacityStyles.summary}>
        <dt>{phase==='ready'||phase==='saved'?'Current work':'Last confirmed work'}</dt><dd>{data.currentWork===null?'Unavailable — above the count limit':data.currentWork}</dd>
        <dt>Availability</dt><dd>{data.availability===null?'Not configured':data.availability==='available'?'Available':'Unavailable'}</dd>
        <dt>Assignment limit</dt><dd>{data.assignmentCeiling===null?'Not configured':data.assignmentCeiling}</dd>
      </dl>
      {data.revision===0&&<p className={capacityStyles.note}>No capacity policy is configured. Existing manual assignment behavior applies.</p>}
      {data.status==='unavailable'&&<p className={capacityStyles.note}>The exact count is unavailable. No partial total is shown.</p>}
      {data.currentWork!==null&&data.assignmentCeiling!==null&&data.currentWork>data.assignmentCeiling&&<p className={capacityStyles.note}>Existing work remains assigned above the limit. Further normal assignments are blocked.</p>}
      <p className={capacityStyles.note}>Confirmed at <time dateTime={data.asOf}>{new Date(data.asOf).toLocaleString()}</time>.</p>
    </>}
    {phase==='error'||phase==='conflict'
      ? <ParkAlert.Root role="alert" status="error"><ParkAlert.Content><ParkAlert.Description>{statusText}</ParkAlert.Description></ParkAlert.Content></ParkAlert.Root>
      : statusText && <p role="status" aria-live="polite" className={capacityStyles.note}>{statusText}</p>}
    <ParkButton type="button" disabled={busy} onClick={()=>void capacity.reload()}>
      {phase==='error'?'Retry':needsReload&&data?'Reload current policy':'Refresh current work'}
    </ParkButton>
    {editable&&<form onSubmit={submit} className={capacityStyles.form}>
      <p className={capacityStyles.note}>Changes apply to new assignments. Existing work stays assigned.</p>
      <DashboardSelect id={`${id}-availability`} label="Availability for assignments" value={availability} disabled={phase==='saving'} onValueChange={value=>{setAvailability(value as CapacityInput['availability']);setDirty(true);}} options={[{value:'available',label:'Available'},{value:'unavailable',label:'Unavailable'}]} />
      <Field.Root>
        <Field.Label htmlFor={`${id}-ceiling`}>Assignment limit (0–1000)</Field.Label>
        <ParkInput id={`${id}-ceiling`} type="number" min={0} max={1000} step={1} value={ceiling} disabled={phase==='saving'}
          onChange={event=>{setCeiling(event.target.value);setDirty(true);}} />
      </Field.Root>
      {data&&dirty&&<p className={capacityStyles.note}>Current saved policy: {data.availability??'not configured'}, limit {data.assignmentCeiling??'not configured'}. Your entered values are separate until saved.</p>}
      <ParkButton type="submit" disabled={busy||needsReload||!data||!valid||data.revision>=Number.MAX_SAFE_INTEGER}>Save capacity</ParkButton>
    </form>}
  </div>;
}
