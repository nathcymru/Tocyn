import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { ParkAlert, ParkButton, ParkDialog, ParkInput, ParkSelect, ParkTextarea } from '../../../packages/ui/src/park';
import { Field as ParkField } from '../../../packages/ui/src/components/ui';
import { Tabs, Combobox, Splitter, Popover } from '../../../packages/ui/src/components/ui';
import { Listbox, createListCollection } from '@ark-ui/react';
import { composeEventHandlers } from '../../../packages/ui/src/types';

const mode=new URLSearchParams(location.search).get('style');
if(mode==='none')document.querySelector('#tocyn-style')?.remove();
if(mode==='radical'){const link=document.createElement('link');link.rel='stylesheet';link.href='/radical.css';document.head.append(link);}
const collection=createListCollection({items:['Mine','Needs Action']});
const priorities=createListCollection({items:[{label:'Normal',value:'normal'},{label:'High',value:'high'}]});
const panels=[{id:'navigation',minSize:20},{id:'conversation',minSize:20}];
const initialSizes=[40,60];
function Fixture(){
 const [choice,setChoice]=React.useState('');const [sizes,setSizes]=React.useState<number[]>([]);
 const [form,setForm]=React.useState('');const [selected,setSelected]=React.useState('');const [tab,setTab]=React.useState('first');
 const [open,setOpen]=React.useState(false);const [busy,setBusy]=React.useState(false);const [error,setError]=React.useState('');
 const [calls,setCalls]=React.useState(0);const [cancelled,setCancelled]=React.useState(0);const pending=React.useRef(false);const opener=React.useRef<HTMLButtonElement>(null);const cancel=React.useRef<HTMLButtonElement>(null);
 return <main><h1>Primitive interaction fixture</h1><span data-motion-probe style={{transitionDuration:"5s",animationDuration:"5s"}}>Motion probe</span>
  <form aria-label="Park controls" onSubmit={event=>{event.preventDefault();setForm(JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))));}}>
   <ParkField.Root required><ParkField.Label>Subject</ParkField.Label><ParkInput name="subject" required /></ParkField.Root>
   <ParkSelect.Root collection={priorities} defaultValue={['normal']}>
    <ParkSelect.Label>Priority</ParkSelect.Label>
    <ParkSelect.Control><ParkSelect.Trigger><ParkSelect.ValueText /></ParkSelect.Trigger></ParkSelect.Control>
    <ParkSelect.HiddenSelect name="priority" />
    <ParkSelect.Positioner><ParkSelect.Content><ParkSelect.List>{priorities.items.map(item=><ParkSelect.Item key={item.value} item={item}><ParkSelect.ItemText>{item.label}</ParkSelect.ItemText></ParkSelect.Item>)}</ParkSelect.List></ParkSelect.Content></ParkSelect.Positioner>
   </ParkSelect.Root>
   <ParkField.Root required><ParkField.Label>Details</ParkField.Label><ParkTextarea name="body" required /></ParkField.Root>
   <ParkButton type="submit">Save form</ParkButton>
  </form><output aria-label="Form result">{form}</output>
  <ParkButton onClick={composeEventHandlers(event=>event.preventDefault(),()=>setCancelled(count=>count+1))}>Cancel internal action</ParkButton>
  <output aria-label="Internal calls">{cancelled}</output><ParkButton aria-label="Busy action" loading>Busy</ParkButton>
  <ParkButton ref={opener} onClick={()=>{setError('');setOpen(true);}}>Open confirmation</ParkButton>
  <ParkDialog.Root open={open} onOpenChange={details=>{if(!busy)setOpen(details.open);}} closeOnEscape={!busy} closeOnInteractOutside={false} initialFocusEl={()=>cancel.current} finalFocusEl={()=>opener.current}>
   <ParkDialog.Backdrop />
   <ParkDialog.Positioner><ParkDialog.Content>
    <ParkDialog.Header><ParkDialog.Title>Confirm synthetic action</ParkDialog.Title></ParkDialog.Header>
    <ParkDialog.Body><ParkDialog.Description>Only a local failed action will be simulated.</ParkDialog.Description>
     {error&&<ParkAlert.Root role="alert" status="error" variant="surface"><ParkAlert.Content><ParkAlert.Description>{error}</ParkAlert.Description></ParkAlert.Content></ParkAlert.Root>}
    </ParkDialog.Body>
    <ParkDialog.Footer><ParkButton type="button" ref={cancel} disabled={busy} onClick={()=>setOpen(false)}>Cancel</ParkButton>
    <ParkButton type="button" disabled={busy} onClick={()=>{
   if(pending.current)return;pending.current=true;setBusy(true);setCalls(count=>count+1);
   setTimeout(()=>{setError('Synthetic failure. The draft is retained.');pending.current=false;setBusy(false);},300);
    }}>Confirm action</ParkButton></ParkDialog.Footer>
   </ParkDialog.Content></ParkDialog.Positioner>
  </ParkDialog.Root><output aria-label="Confirmation calls">{calls}</output>
  <Tabs.Root value={tab} onValueChange={details=>setTab(details.value)} activationMode="manual">
   <Tabs.List aria-label="Work panes"><Tabs.Trigger value="first">First pane</Tabs.Trigger><Tabs.Trigger value="second">Second pane</Tabs.Trigger></Tabs.List>
   <Tabs.Content value="first">First content</Tabs.Content><Tabs.Content value="second">Second content</Tabs.Content>
  </Tabs.Root>
  {/* Park does not ship standalone Listbox source; retain its headless Ark keyboard contract. */}
  <Listbox.Root collection={collection} onValueChange={details=>setSelected(details.value.join(','))}>
   <Listbox.Label>Views</Listbox.Label><Listbox.Content>{collection.items.map(item=><Listbox.Item key={item} item={item}><Listbox.ItemText>{item}</Listbox.ItemText></Listbox.Item>)}</Listbox.Content>
  </Listbox.Root><output aria-label="Selected view">{selected}</output>
  <Combobox.Root collection={collection} onValueChange={details=>setChoice(details.value.join(','))}>
   <Combobox.Label>Find view</Combobox.Label><Combobox.Control><Combobox.Input asChild><ParkInput /></Combobox.Input><Combobox.Trigger asChild aria-label="Show views"><ParkButton>Show views</ParkButton></Combobox.Trigger></Combobox.Control>
   <Combobox.Positioner><Combobox.Content>{collection.items.map(item=><Combobox.Item item={item} key={item}><Combobox.ItemText>{item}</Combobox.ItemText></Combobox.Item>)}</Combobox.Content></Combobox.Positioner>
  </Combobox.Root><output aria-label="Chosen view">{choice}</output>
  <Splitter.Root keyboardResizeBy={10} panels={panels} defaultSize={initialSizes} onResize={details=>setSizes(details.size)} style={{width:600,height:120}}>
   <Splitter.Panel id="navigation">Navigation content</Splitter.Panel><Splitter.ResizeTrigger id="navigation:conversation" aria-label="Resize navigation" /><Splitter.Panel id="conversation">Conversation content</Splitter.Panel>
  </Splitter.Root><output aria-label="Panel sizes">{JSON.stringify(sizes)}</output>
  <Popover.Root><Popover.Trigger asChild><ParkButton>Open details</ParkButton></Popover.Trigger><Popover.Positioner><Popover.Content aria-label="Details"><Popover.Title>Details</Popover.Title><Popover.CloseTrigger asChild aria-label="Close details"><ParkButton size="lg">Close details</ParkButton></Popover.CloseTrigger></Popover.Content></Popover.Positioner></Popover.Root>
 </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
