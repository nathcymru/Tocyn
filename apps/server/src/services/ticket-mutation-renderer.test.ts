import { describe, expect, it } from 'vitest';
import { renderMutationSnapshotV2, TicketMutationError } from './ticket-mutation-replay.service';

describe('V2 retry snapshot defensive parsing',()=>{
  it.each(['{','null','[]','{}',JSON.stringify({version:2,audit:[null]}),JSON.stringify({version:2,audit:[{}]}),JSON.stringify({version:2,audit:[{eventId:42}]})])('returns a controlled unavailable error for malformed snapshot %s',raw=>{
    expect(()=>renderMutationSnapshotV2(raw,'api.ticket.create',true,true)).toThrow(TicketMutationError);
    try {renderMutationSnapshotV2(raw,'api.ticket.create',true,true);}catch(error){expect(error).toMatchObject({status:503,code:'mutation_unavailable'});}
  });
});
