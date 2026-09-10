"""Reproduce the approved conservative forecast without GitHub or network access.

Run python3 schedule.py; --check compares output without writing.
"""
import json
import sys
from pathlib import Path
from datetime import date, timedelta
R=Path(__file__).resolve().parent
inputs=json.loads((R/'planning-input.json').read_text())
nodes={v['number']:v for v in inputs['nodes']}
pv={v['number']:v for v in json.loads((R/'baseline-snapshot.json').read_text())['items']}
vis=set();active=set();order=[]
def visit(n):
 if n in active:raise ValueError('Dependency cycle '+str(n))
 if n in vis:return
 active.add(n)
 for d in nodes[n]['dependencies']:visit(d)
 active.remove(n);vis.add(n);order.append(n)
for n in nodes:visit(n)
# Reference forecasting: 2 lanes, 8h implementation days, shared4h review; lane held through integration.
anchor=date.fromisoformat(inputs["anchor"]) # first planning day after approved10Sep alignment; revised if alignment acceptance slips
calendar=[];d=anchor
while len(calendar)<1600:
 if d.weekday()!=6:calendar.append(d)
 d+=timedelta(days=1)
review=[0.0]*len(calendar);lane=[0,0]
# Accepted work unlocks successors only after its evidenced completion date.
scheduled={n:max((i for i,d in enumerate(calendar) if v.get('actualCompletion') and str(d)<=v['actualCompletion']),default=-1) for n,v in nodes.items() if v['done']}
gate=140;gateanc=set()
def ancestors(n):
 if n in gateanc:return
 gateanc.add(n)
 for d in nodes[n]['dependencies']:ancestors(d)
ancestors(gate)
remaining={n for n,v in nodes.items() if not v['done']}
while remaining:
 ready=[n for n in remaining if all(d in scheduled for d in nodes[n]['dependencies'])]
 def rank(n):
  earliest=max([scheduled[d]+1 for d in nodes[n]['dependencies']]+[0]);priority=0 if n in [50,127] else 1 if n in gateanc else 2 if n in [159,160,91,51,87,88] else 3
  return(max(min(lane),earliest),priority,n)
 n=min(ready,key=rank);v=nodes[n];l=min(range(2),key=lambda i:lane[i]);start=max(lane[l],max([scheduled[d]+1 for d in v['dependencies']]+[0]));impl=v['effort']*2.5;rv=v['effort']*.5
 days=max(1,int((impl+7.999999)//8));end=start+days-1;ri=end+1
 while rv>1e-9:
  use=min(4-review[ri],rv);review[ri]+=use;rv-=use
  if rv>1e-9:ri+=1
 end=ri if v['effort'] else end;scheduled[n]=end;lane[l]=end+1;v.update(forecastStart=str(calendar[start]),forecastTarget=str(calendar[end]),workstream=f'W{l+1}',remainingPlanningHours=v['effort']*3)
 if v['new']:
  if not v.get('baselineStart'):v['baselineStart']=v['forecastStart']
  if not v.get('baselineTarget'):v['baselineTarget']=v['forecastTarget']
 remaining.remove(n)
# CPM ignoring resource contention, distinct from calendar forecast.
finish={};duration={n:(0 if v['done'] else v['effort']*3) for n,v in nodes.items()}
for n in order:finish[n]=max([finish[d] for d in nodes[n]['dependencies']]+[0])+duration[n]
succ={n:[] for n in nodes}
for n,v in nodes.items():
 for d in v['dependencies']:succ[d].append(n)
terminal=max(finish.values());latest={}
for n in reversed(order):latest[n]=min([latest[s]-duration[s] for s in succ[n]]+[terminal])
for n,v in nodes.items():
 v['floatHours']=latest[n]-finish[n];v['criticalPath']='Critical' if v['floatHours']==0 else 'Near-critical' if v['floatHours']<=48 else 'Supporting'
 if v['done']:
  v['forecastStart']=v.get('forecastStart') or pv.get(n,{}).get('forecast start')
  v['forecastTarget']=v.get('forecastTarget') or pv.get(n,{}).get('forecast target')
  v['remainingPlanningHours']=0
 def variance(a,b):
  if not a or not b:return None
  a=date.fromisoformat(a);b=date.fromisoformat(b);sign=1 if b>=a else -1;lo,hi=sorted([a,b]);return sign*sum((lo+timedelta(days=i)).weekday()!=6 for i in range(1,(hi-lo).days+1))
 v['variance']=variance(v['baselineTarget'],v['actualCompletion'] if v['done'] else v['forecastTarget'])
forecast={'anchor':str(anchor),'assumptions':{'lanes':2,'implementationHoursPerDay':8,'sharedReviewHoursPerDay':4,'workingDays':'Monday–Saturday','effortMultiplier':3,'implementationMultiplier':2.5,'reviewMultiplier':.5,'alignmentHold':'Recalculate forecast only if alignment acceptance passes anchor; preserve new approved baseline dates.','externalWaits':'Not estimated; separately authorised provider/sandbox availability can delay acceptance.'},'dependencyOnlyHours':terminal,'beta2Forecast':nodes[gate]['forecastTarget'],'expandedForecast':max(v['forecastTarget'] or '' for v in nodes.values() if not v['done']),'nodes':list(nodes.values())}
output=json.dumps(forecast,indent=2)+'\n'
if '--check' in sys.argv:
    assert (R/'forecast.json').read_text()==output, 'Forecast differs from calculated output'
    print('Forecast reproducibility: PASS')
else:
    (R/'forecast.json').write_text(output)
