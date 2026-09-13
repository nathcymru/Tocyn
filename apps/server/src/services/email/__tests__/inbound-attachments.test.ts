import { describe, expect, it, vi } from 'vitest';
import { writeInboundAttachments, type InboundAttachmentContent } from '../inbound-attachments';
import type { InboundClaim, InboundEmailReceiptRepository } from '../../../repositories/inbound-email-receipt.repository';
import type { TenantAttachmentStorage } from '../../../storage/adapters';

const attachment = (changes: Partial<InboundAttachmentContent> = {}): InboundAttachmentContent => ({
  filename: 'synthetic.txt', contentType: 'text/plain', content: new Uint8Array([1, 2, 3]), ...changes,
});
function fixture() {
  const calls: string[] = [];
  const receipts = {
    planArtifacts: vi.fn(async (_claim: InboundClaim, items: readonly { contentHash: string; byteSize: number }[]) => {
      calls.push('manifest');
      return items.map((item, ordinal) => ({ ...item, ordinal, objectId: `synthetic/${ordinal}` }));
    }),
    beforeArtifactWrite: vi.fn(async () => { calls.push('fence'); }),
    confirmArtifact: vi.fn(async () => { calls.push('confirm'); }),
  };
  const storage = {
    putAttachment: vi.fn(async (key: string, _content: Uint8Array, _options: unknown) => {
      calls.push('put'); return { key, res: {} };
    }),
    deleteAttachment: vi.fn(),
  };
  const run = (attachments: readonly InboundAttachmentContent[]) => writeInboundAttachments({
    storage: storage as unknown as TenantAttachmentStorage,
    receipts: receipts as unknown as InboundEmailReceiptRepository, claim: {} as InboundClaim, attachments,
  });
  return { receipts, storage, calls, run };
}
describe('bounded inbound attachment writes', () => {
  it.each([
    ['count', Array.from({ length: 11 }, () => attachment())],
    ['aggregate bytes', [attachment({ content: new Uint8Array(1_048_577) }), attachment({ content: new Uint8Array(1_048_576) })]],
    ['empty content', [attachment({ content: new Uint8Array() })]],
    ['wrong content type', [attachment({ content: [1] as unknown as Uint8Array })]],
    ['empty filename', [attachment({ filename: '' })]],
    ['UTF-8 filename bytes', [attachment({ filename: 'é'.repeat(128) })]],
    ['filename newline', [attachment({ filename: 'a\nb' })]],
    ['filename DEL', [attachment({ filename: 'a\x7fb' })]],
    ['empty media type', [attachment({ contentType: '' })]],
    ['long media type', [attachment({ contentType: 'a'.repeat(256) })]],
    ['media type control', [attachment({ contentType: 'text/plain\r' })]],
    ['non-ASCII media type', [attachment({ contentType: 'text/é' })]],
  ] as const)('rejects %s before any durable or object write', async (_name, items) => {
    const f = fixture(); await expect(f.run(items)).rejects.toThrow();
    expect(f.receipts.planArtifacts).not.toHaveBeenCalled(); expect(f.storage.putAttachment).not.toHaveBeenCalled();
  });
  it('accepts exact aggregate, count, filename and media-type limits', async () => {
    const f = fixture(); const items = Array.from({ length: 10 }, (_, index) => attachment({
      filename: 'a'.repeat(255), contentType: 'a'.repeat(255), content: new Uint8Array(index === 0 ? 2_097_143 : 1),
    }));
    expect(await f.run(items)).toHaveLength(10); expect(f.storage.putAttachment).toHaveBeenCalledTimes(10);
  });
  it('persists the complete digest manifest before the first put and fences each write', async () => {
    const f = fixture(); const result = await f.run([attachment(), attachment({ content: new Uint8Array([4]) })]);
    expect(f.receipts.planArtifacts.mock.calls[0][1]).toEqual([
      { contentHash: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81', byteSize: 3 },
      { contentHash: 'e52d9c508c502347344d8c07ad91cbd6068afc75ff6292f062a09ca381c89e71', byteSize: 1 },
    ]);
    expect(f.calls).toEqual(['manifest', 'fence', 'put', 'confirm', 'fence', 'put', 'confirm']);
    expect(result.map(item => item.storageKey)).toEqual(['synthetic/0', 'synthetic/1']);
  });
  it.each(['manifest', 'fence'] as const)('stops before object writes when the %s is rejected', async failure => {
    const f = fixture(); const denied = new Error('synthetic authority denied');
    if (failure === 'manifest') f.receipts.planArtifacts.mockRejectedValueOnce(denied);
    else f.receipts.beforeArtifactWrite.mockRejectedValueOnce(denied);
    await expect(f.run([attachment()])).rejects.toThrow(denied);
    expect(f.storage.putAttachment).not.toHaveBeenCalled();
    expect(f.storage.deleteAttachment).not.toHaveBeenCalled();
    expect(f.receipts.confirmArtifact).not.toHaveBeenCalled();
  });
  it('copies all caller bytes and metadata before the first asynchronous boundary', async () => {
    const f = fixture(); const first = { ...attachment() }; const second = { ...attachment({ content: new Uint8Array([4]) }) };
    const pending = f.run([first, second]);
    first.content.fill(9); second.content.fill(9); first.filename = 'changed.txt'; second.contentType = 'changed/type';
    const result = await pending;
    expect(Array.from(f.storage.putAttachment.mock.calls[0][1])).toEqual([1, 2, 3]);
    expect(Array.from(f.storage.putAttachment.mock.calls[1][1])).toEqual([4]);
    expect(result[0].filename).toBe('synthetic.txt'); expect(result[1].contentType).toBe('text/plain');
  });
  it.each(['provider', 'confirmation', 'missing result', 'wrong key'] as const)('propagates %s uncertainty without deleting objects or continuing', async failure => {
    const f = fixture(); const lost = new Error('synthetic acknowledgment lost');
    if (failure === 'provider') f.storage.putAttachment.mockRejectedValueOnce(lost);
    if (failure === 'confirmation') f.receipts.confirmArtifact.mockRejectedValueOnce(lost);
    if (failure === 'missing result') f.storage.putAttachment.mockResolvedValueOnce({ key: 'synthetic/0', res: null as unknown as object });
    if (failure === 'wrong key') f.storage.putAttachment.mockResolvedValueOnce({ key: 'wrong', res: {} });
    await expect(f.run([attachment(), attachment()])).rejects.toThrow(failure === 'provider' || failure === 'confirmation' ? lost : 'uncertain');
    expect(f.receipts.planArtifacts.mock.calls[0][1]).toHaveLength(2);
    expect(f.storage.putAttachment).toHaveBeenCalledTimes(1); expect(f.storage.deleteAttachment).not.toHaveBeenCalled();
    expect(f.receipts.confirmArtifact).toHaveBeenCalledTimes(failure === 'confirmation' ? 1 : 0);
  });
});
