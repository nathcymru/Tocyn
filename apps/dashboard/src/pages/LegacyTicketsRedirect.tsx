import { TocynButton } from '@luminatick/ui/primitives';
import { useEffect,useRef,useState } from 'react';
import { useNavigate,useParams,useSearchParams } from 'react-router-dom';
import { OperatorWorkspaceProvider,useOperatorWorkspaceState } from '../hooks/useOperatorWorkspaceState';

export function LegacyTicketsRedirect(){return <OperatorWorkspaceProvider><Redirect /></OperatorWorkspaceProvider>;}

function Redirect(){
  const {id}=useParams<{id?:string}>();
  const [params]=useSearchParams();
  const navigate=useNavigate();
  const workspace=useOperatorWorkspaceState();
  const started=useRef(false);
  const [failed,setFailed]=useState(false);
  const run=async()=>{
    if(started.current||workspace.status==='loading')return;
    started.current=true;setFailed(false);
    if(id){navigate(`/inbox/all/${id}`,{replace:true});return;}
    const search=params.get('search')?.trim();
    if(search&&search!==workspace.listQuery){
      workspace.update({view:'all',filters:{...workspace.filters,filterId:null},listQuery:search,listAnchor:'page:1'});
      if(!await workspace.flushBeforeNavigation()){started.current=false;setFailed(true);return;}
    }
    navigate('/inbox/all',{replace:true});
  };
  useEffect(()=>{void run();},[workspace.status]);
  return <section aria-labelledby="opening-inbox" className="mx-auto max-w-lg p-8 text-center">
    <h1 id="opening-inbox" tabIndex={-1} className="text-xl font-bold text-slate-900">Opening Inbox</h1>
    <p role={failed?'alert':'status'} className="mt-2 text-slate-600">{failed?'Your saved list could not be confirmed. Retry without losing the filter.':'Restoring your conversation view…'}</p>
    {failed&&<TocynButton type="button" onClick={()=>void run()} className="mt-4 rounded border border-slate-300 px-4 py-2 font-semibold">Retry Inbox</TocynButton>}
  </section>;
}
