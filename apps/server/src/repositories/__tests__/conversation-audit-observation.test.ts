import {it,expect} from 'vitest';
import type {D1Database} from '@cloudflare/workers-types';
import {createSystemTenantScope} from '../../auth/scope';
import {createRequestCanonicalMutationSli} from '../../observability/request-canonical-mutation-sli';
import {ConversationAuditRepository} from '../conversation-audit.repository';

it('does not report a no-op when the adapter omits committed batch results',async()=>{
 const statement={bind:()=>statement};
 const db={prepare:()=>statement,batch:async()=>[]} as unknown as D1Database;
 const sli=createRequestCanonicalMutationSli();
 const repository=new ConversationAuditRepository(db,createSystemTenantScope('synthetic-tenant','test'),undefined,sli);
 await expect(repository.updateWithEvents('synthetic-ticket',{priority:'normal'},{kind:'staff',id:'synthetic-staff',source:'dashboard'})).rejects.toThrow('Audited mutation result unavailable');
 expect(sli.snapshot().counts).toEqual({attempted:1,durablyCompleted:0,replayed:0,denied:0,uncertain:1,noOp:0});
});
