import { describe, expect, it, vi } from 'vitest';
import { AttachmentReferenceError, validateAttachmentReferences } from '../attachment-references';

describe('attachment reference preflight', () => {
  it.each([null, undefined, false, 42, 'file', [], {}, { storageKey: 'customer-attachments/a/file', filename: null }])('rejects malformed entries before storage access: %j', async (entry) => {
    const getAttachment = vi.fn();
    const deps = { attachmentStorage: { getAttachment } } as any;
    await expect(validateAttachmentReferences(deps, 'customer-attachments/a/', [entry])).rejects.toBeInstanceOf(AttachmentReferenceError);
    expect(getAttachment).not.toHaveBeenCalled();
  });

  it('uses stored metadata and rejects a later wrong-owner reference before callers write', async () => {
    const getAttachment = vi.fn().mockImplementation(async () => ({ size: 3, httpMetadata: { contentType: 'text/plain' }, body: new ReadableStream({ start(c) { c.close(); } }) }));
    const deps = { attachmentStorage: { getAttachment } } as any;
    const own = { storageKey: 'customer-attachments/a/file', filename: 'file.txt', size: 9999, contentType: 'image/png' };
    expect(await validateAttachmentReferences(deps, 'customer-attachments/a/', [own])).toEqual([{ storageKey: own.storageKey, filename: 'file.txt', size: 3, contentType: 'text/plain' }]);
    await expect(validateAttachmentReferences(deps, 'customer-attachments/a/', [own, { ...own, storageKey: 'customer-attachments/b/file' }])).rejects.toThrow('Invalid attachment');
  });
  it('rejects absent objects and duplicate references', async () => {
    const deps = { attachmentStorage: { getAttachment: vi.fn().mockResolvedValue(null) } } as any;
    await expect(validateAttachmentReferences(deps, 'customer-attachments/a/', [{ storageKey: 'customer-attachments/a/missing', filename: 'file.txt' }])).rejects.toThrow('not found');
  });
});
