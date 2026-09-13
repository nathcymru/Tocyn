import { expect, it, vi } from 'vitest';
import { DEFAULT_SLA_CALENDAR, SlaEvaluationMeter, SlaEvaluationExhaustedError, parseMeteredSlaCalendarJson, parseSlaCalendar } from '../sla-clock';
import { projectSlaClock } from '../../repositories/sla-clock.repository';
import type { TicketSlaClock, SlaPolicy } from '../../types/sla';

const now = new Date('2026-11-01T12:00:00Z');
const policy: SlaPolicy = { calendar: DEFAULT_SLA_CALENDAR, responseTargetMs: 3600000, resolutionTargetMs: 7200000, reopenPolicy: { response:'continue',resolution:'continue' },revision:2 };
const clock: TicketSlaClock = { ticketId:'synthetic',responseStartedAt:'2026-11-01T00:00:00Z',responseCompletedAt:null,resolutionStartedAt:'2026-11-01T00:00:00Z',resolutionCompletedAt:null,pausedAt:null,pauseReason:null,supportStateRevision:0,revision:1,policyRevision:1,policyCalendarJson:JSON.stringify(DEFAULT_SLA_CALENDAR),policyResponseTargetMs:3600000,policyResolutionTargetMs:7200000,policyResponseReopenPolicy:'continue',policyResolutionReopenPolicy:'continue' };
const project = (value: TicketSlaClock, meter?: SlaEvaluationMeter) => projectSlaClock(value,policy,[],null,now,meter);

it.each([
  { label:'running', value:clock },
  { label:'completed', value:{...clock,responseCompletedAt:'2026-11-01T00:30:00Z',resolutionCompletedAt:'2026-11-01T01:30:00Z'} },
  { label:'paused', value:{...clock,pausedAt:'2026-11-01T00:15:00Z',pauseReason:'waiting' as const} },
  { label:'unavailable', value:{...clock,policyResponseTargetMs:null,policyResolutionTargetMs:null} },
  { label:'legacy live policy', value:{...clock,policyCalendarJson:null} },
])('preserves $label projection exactly when sufficiently funded',({value})=>{
  const expected=project(value);const meter=new SlaEvaluationMeter(10000000);
  expect(project(value,meter)).toEqual(expected);expect(meter.consumed).toBeGreaterThan(0);
});

it('preserves frozen calendar DST folds and overlapping pause semantics',()=>{
  const calendar=parseSlaCalendar({timeZone:'America/New_York',weekly:{sunday:[{startMinute:60,endMinute:180}]},exceptions:[],dst:{ambiguousLocalTime:'both',nonexistentLocalTime:'next-valid'}});
  const value={...clock,policyCalendarJson:JSON.stringify(calendar),responseStartedAt:'2026-11-01T04:00:00Z',resolutionStartedAt:'2026-11-01T04:00:00Z'};
  const pauses=[{startsAt:new Date('2026-11-01T05:15:00Z'),endsAt:new Date('2026-11-01T05:45:00Z')},{startsAt:new Date('2026-11-01T05:30:00Z'),endsAt:new Date('2026-11-01T06:00:00Z')}];
  expect(projectSlaClock(value,policy,pauses,null,now,new SlaEvaluationMeter(100000000))).toEqual(projectSlaClock(value,policy,pauses,null,now));
});

it('shares deterministic charges across both targets and consecutive projections',()=>{
  const first=new SlaEvaluationMeter(10000000);project(clock,first);
  const repeat=new SlaEvaluationMeter(10000000);project(clock,repeat);
  expect(repeat.consumed).toBe(first.consumed); // Cache warmth does not buy extra allowance.
  const exact=new SlaEvaluationMeter(first.consumed);expect(project(clock,exact)).toEqual(project(clock));
  expect(()=>project(clock,exact)).toThrow(SlaEvaluationExhaustedError);
  const short=new SlaEvaluationMeter(first.consumed-1);expect(()=>project(clock,short)).toThrow(SlaEvaluationExhaustedError);
  expect(()=>short.charge(0)).toThrow(SlaEvaluationExhaustedError);
});

it('fails before Intl work when no allowance remains',()=>{
  const intl=vi.spyOn(Intl,'DateTimeFormat');
  try {expect(()=>project(clock,new SlaEvaluationMeter(0))).toThrow(SlaEvaluationExhaustedError);expect(intl).not.toHaveBeenCalled();}
  finally {intl.mockRestore();}
});

it('bounds frozen UTF-8 JSON before parsing and leaves ordinary unmetered semantics intact',()=>{
  const parse=vi.spyOn(JSON,'parse');
  try {
    for(const raw of [' '.repeat(65537),'é'.repeat(40000)]){
      const meter=new SlaEvaluationMeter(10000000);
      expect(()=>parseMeteredSlaCalendarJson(raw,meter)).toThrow(SlaEvaluationExhaustedError);
      expect(()=>meter.charge(0)).toThrow(SlaEvaluationExhaustedError);
      expect(()=>project(clock,meter)).toThrow(SlaEvaluationExhaustedError);
    }
    expect(parse).not.toHaveBeenCalled();
  }finally{parse.mockRestore();}
});

it('rejects invalid allowances and cannot resume an exhausted meter',()=>{
  for(const n of [-1,NaN,Infinity,0.5])expect(()=>new SlaEvaluationMeter(n)).toThrow(RangeError);
  const meter=new SlaEvaluationMeter(3);meter.charge(2);expect(()=>meter.charge(2)).toThrow(SlaEvaluationExhaustedError);
  expect(meter.consumed).toBe(2);expect(()=>meter.charge(1)).toThrow(SlaEvaluationExhaustedError);
});
