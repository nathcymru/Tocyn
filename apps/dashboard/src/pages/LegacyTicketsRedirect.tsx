import { ParkButton, ParkEmptyState } from '@luminatick/ui/park';
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
  return <ParkEmptyState title="Opening Inbox" description={failed?'Your saved list could not be confirmed. Retry without losing the filter.':'Restoring your conversation view…'} headingLevel={1} className="tocyn-redirect-state" role={failed?'alert':'status'} action={failed&&<ParkButton type="button" onClick={()=>void run()} className="tocyn-redirect-retry">Retry Inbox</ParkButton>} />;
}
