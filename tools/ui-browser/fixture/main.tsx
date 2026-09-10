import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { TocynButton, TocynInput, TocynSelect, TocynTextarea } from '../../../packages/ui/src/primitives';
import { WorkspaceShell } from '../../../packages/ui/src/workspace';
import { composeEventHandlers } from '../../../packages/ui/src/types';
import { TocynConfirmDialog } from '../../../packages/ui/src/dialog';
import { Tabs, Listbox, Popover, Combobox, Splitter, createListCollection } from '../../../packages/ui/src/ark';

const mode=new URLSearchParams(location.search).get('style');
if(mode==='none')document.querySelector('#tocyn-style')?.remove();
if(mode==='radical'){const link=document.createElement('link');link.rel='stylesheet';link.href='/radical.css';document.head.append(link);}
const collection=createListCollection({items:['Mine','Needs Action']});
const panels=[{id:'navigation',minSize:20},{id:'conversation',minSize:20}];
const initialSizes=[40,60];
function Fixture(){
 const [choice,setChoice]=React.useState('');const [sizes,setSizes]=React.useState<number[]>([]);
 const [form,setForm]=React.useState('');const [selected,setSelected]=React.useState('');const [tab,setTab]=React.useState('first');
 const [open,setOpen]=React.useState(false);const [busy,setBusy]=React.useState(false);const [error,setError]=React.useState('');
 const [calls,setCalls]=React.useState(0);const [cancelled,setCancelled]=React.useState(0);const pending=React.useRef(false);const opener=React.useRef<HTMLButtonElement>(null);
 return <WorkspaceShell><h1>Primitive interaction fixture</h1><span data-motion-probe style={{transitionDuration:"5s",animationDuration:"5s"}}>Motion probe</span>
  <form aria-label="Native controls" onSubmit={event=>{event.preventDefault();setForm(JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))));}}>
   <label htmlFor="subject">Subject</label><TocynInput id="subject" name="subject" required />
   <label htmlFor="priority">Priority</label><TocynSelect id="priority" name="priority" defaultValue="normal"><option value="normal">Normal</option><option value="high">High</option></TocynSelect>
   <label htmlFor="body">Details</label><TocynTextarea id="body" name="body" required />
   <TocynButton type="submit">Save form</TocynButton>
  </form><output aria-label="Form result">{form}</output>
  <TocynButton onClick={composeEventHandlers(event=>event.preventDefault(),()=>setCancelled(count=>count+1))}>Cancel internal action</TocynButton>
  <output aria-label="Internal calls">{cancelled}</output><TocynButton aria-label="Busy action" state="loading">Busy</TocynButton>
  <TocynButton ref={opener} onClick={()=>{setError('');setOpen(true);}}>Open confirmation</TocynButton>
  <TocynConfirmDialog open={open} onOpenChange={setOpen} busy={busy} title="Confirm synthetic action" description="Only a local failed action will be simulated." confirmLabel="Confirm action" error={error} finalFocusEl={()=>opener.current} onConfirm={()=>{
   if(pending.current)return;pending.current=true;setBusy(true);setCalls(count=>count+1);
   setTimeout(()=>{setError('Synthetic failure. The draft is retained.');pending.current=false;setBusy(false);},300);
  }}/><output aria-label="Confirmation calls">{calls}</output>
  <Tabs.Root value={tab} onValueChange={details=>setTab(details.value)} activationMode="manual">
   <Tabs.List aria-label="Work panes"><Tabs.Trigger value="first">First pane</Tabs.Trigger><Tabs.Trigger value="second">Second pane</Tabs.Trigger></Tabs.List>
   <Tabs.Content value="first">First content</Tabs.Content><Tabs.Content value="second">Second content</Tabs.Content>
  </Tabs.Root>
  <Listbox.Root collection={collection} onValueChange={details=>setSelected(details.value.join(','))}>
   <Listbox.Label>Views</Listbox.Label><Listbox.Content>{collection.items.map(item=><Listbox.Item key={item} item={item}><Listbox.ItemText>{item}</Listbox.ItemText></Listbox.Item>)}</Listbox.Content>
  </Listbox.Root><output aria-label="Selected view">{selected}</output>
  <Combobox.Root collection={collection} onValueChange={details=>setChoice(details.value.join(','))}>
   <Combobox.Label>Find view</Combobox.Label><Combobox.Control><Combobox.Input asChild><TocynInput /></Combobox.Input><Combobox.Trigger asChild aria-label="Show views"><TocynButton>Show views</TocynButton></Combobox.Trigger></Combobox.Control>
   <Combobox.Positioner><Combobox.Content>{collection.items.map(item=><Combobox.Item item={item} key={item}><Combobox.ItemText>{item}</Combobox.ItemText></Combobox.Item>)}</Combobox.Content></Combobox.Positioner>
  </Combobox.Root><output aria-label="Chosen view">{choice}</output>
  <Splitter.Root keyboardResizeBy={10} panels={panels} defaultSize={initialSizes} onResize={details=>setSizes(details.size)} style={{width:600,height:120}}>
   <Splitter.Panel id="navigation">Navigation content</Splitter.Panel><Splitter.ResizeTrigger id="navigation:conversation" aria-label="Resize navigation" /><Splitter.Panel id="conversation">Conversation content</Splitter.Panel>
  </Splitter.Root><output aria-label="Panel sizes">{JSON.stringify(sizes)}</output>
  <Popover.Root><Popover.Trigger asChild><TocynButton>Open details</TocynButton></Popover.Trigger><Popover.Positioner><Popover.Content aria-label="Details"><Popover.Title>Details</Popover.Title><Popover.CloseTrigger asChild aria-label="Close details"><TocynButton>Close details</TocynButton></Popover.CloseTrigger></Popover.Content></Popover.Positioner></Popover.Root>
 </WorkspaceShell>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
