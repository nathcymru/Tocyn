import { describe,expect,it } from 'vitest';
import { createSystemTenantScope } from '../../../auth/scope';
import { inboundIdentity } from '../inbound-identity';
const scope=(tenantId='one',actor='inbound-email')=>createSystemTenantScope({tenantId,actor});
const envelope={from:'sender@example.invalid',to:'support@example.invalid',subject:'Synthetic message',messageId:'<Message-1@example.invalid>',rawSize:100};
describe('bounded inbound source identity',()=>{
  it('repeats stable identity while qualifying sender, recipient, tenant and message ID',async()=>{
    const first=await inboundIdentity(scope(),envelope);
    expect(await inboundIdentity(scope(),{...envelope,from:' SENDER@EXAMPLE.INVALID '})).toEqual(first);
    for (const [s,e] of [[scope('two'),envelope],[scope(),{...envelope,from:'other@example.invalid'}],
      [scope(),{...envelope,to:'other@example.invalid'}],[scope(),{...envelope,messageId:'<message-1@example.invalid>'}]] as const) {
      expect((await inboundIdentity(s,e)).sourceHash).not.toBe(first.sourceHash);
    }
  });
  it('binds changed headers and declared size to an envelope conflict rather than a new source',async()=>{
    const first=await inboundIdentity(scope(),envelope);
    for(const change of [{subject:'Changed'},{rawSize:101}]) {
      const next=await inboundIdentity(scope(),{...envelope,...change});
      expect(next.sourceHash).toBe(first.sourceHash);expect(next.envelopeHash).not.toBe(first.envelopeHash);
    }
  });
  it.each(['','<missing-domain>','<a@b> <c@d>','<a@b>\n','<a@b\u0000>','<é@b>'])('rejects unsupported identity %j',async messageId=>{
    await expect(inboundIdentity(scope(),{...envelope,messageId})).rejects.toThrow('identity');
  });
  it('rejects wrong authority and invalid envelope bounds before hashing',async()=>{
    await expect(inboundIdentity(scope('one','scheduled-retention'),envelope)).rejects.toThrow('scope');
    for(const change of [{rawSize:0},{rawSize:2*1024*1024+1},{from:'a\n@b'},{to:'missing-domain'},
      {subject:'é'.repeat(1025)},{subject:'injected\r\nheader'}]) {
      await expect(inboundIdentity(scope(),{...envelope,...change})).rejects.toThrow();
    }
  });
});
