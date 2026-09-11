import { measureResourceOperation, type ResourceOperationEmitter } from '../observability/resource-operation';
import { VerifiedTenantScope } from '../types/tenant';
import { createHash } from 'node:crypto';

interface R2Bucket {
  get(key: string): Promise<any>;
  put(key: string, value: any, options?: any): Promise<any>;
  delete(key: string): Promise<any>;
}

interface VectorizeIndex {
  upsert(vectors: any[]): Promise<any>;
  getByIds(ids: string[]): Promise<any>;
  deleteByIds(ids: string[]): Promise<any>;
  query(vector: any, options?: any): Promise<any>;
}

export class TenantR2Adapter {
  constructor(private scope: VerifiedTenantScope, private bucket: R2Bucket, private emit?: ResourceOperationEmitter) {}

  private getScopedKey(objectId: string): string {
    return `${this.scope.tenantId}/${objectId}`;
  }

  async get(objectId: string) {
    return measureResourceOperation({resource:'r2',operation:'read',execute:() => this.bucket.get(this.getScopedKey(objectId)),emit:this.emit});
  }

  async put(objectId: string, value: any, options?: any) {
    return measureResourceOperation({resource:'r2',operation:'write',execute:() => this.bucket.put(this.getScopedKey(objectId), value, options),emit:this.emit});
  }

  async delete(objectId: string) {
    return measureResourceOperation({resource:'r2',operation:'delete',execute:() => this.bucket.delete(this.getScopedKey(objectId)),emit:this.emit});
  }
}

export class TenantVectorStorage {
  constructor(private scope: VerifiedTenantScope, private index: VectorizeIndex) {}

  private getNamespace(): string {
    const hash = createHash('sha256').update(this.scope.tenantId).digest('base64url');
    return `t_${hash}`;
  }

  private getScopedId(logicalId: string): string {
    const hash = createHash('sha256');
    hash.update(this.scope.tenantId);
    hash.update('\0');
    hash.update(logicalId);
    return hash.digest('hex');
  }

  async upsert(logicalId: string, values: number[], metadata: any = {}) {
    const safeMetadata = {
      ...metadata,
      tenant_id: this.scope.tenantId,
      _logical_id: logicalId // Store logical ID to reconstruct later
    };

    return this.index.upsert([{
      id: this.getScopedId(logicalId),
      values,
      namespace: this.getNamespace(),
      metadata: safeMetadata
    }]);
  }

  async upsertMany(vectors: { id: string, values: number[], metadata?: any }[]) {
    const mapped = vectors.map(v => ({
      id: this.getScopedId(v.id),
      values: v.values,
      namespace: this.getNamespace(),
      metadata: {
        ...v.metadata,
        tenant_id: this.scope.tenantId,
        _logical_id: v.id
      }
    }));
    return this.index.upsert(mapped);
  }

  async getByIds(logicalIds: string[]) {
    if (logicalIds.length === 0) return [];
    const results = await this.index.getByIds(logicalIds.map(id => this.getScopedId(id)));
    // Restore logical IDs
    return results.map((r: any) => ({
      ...r,
      id: r.metadata?._logical_id || r.id
    }));
  }

  async delete(logicalId: string) {
    return this.index.deleteByIds([this.getScopedId(logicalId)]);
  }

  async deleteByIds(logicalIds: string[]) {
    if (logicalIds.length === 0) return;
    return this.index.deleteByIds(logicalIds.map(id => this.getScopedId(id)));
  }

  async query(vector: number[], options: any = {}) {
    const results = await this.index.query(vector, {
      ...options,
      namespace: this.getNamespace()
    });

    if (results && results.matches) {
      results.matches = results.matches.map((m: any) => ({
        ...m,
        id: m.metadata?._logical_id || m.id
      }));
    }
    return results;
  }
}

export class TenantAttachmentStorage {
  private r2Adapter: TenantR2Adapter;

  constructor(scope: VerifiedTenantScope, bucket: R2Bucket, emit?: ResourceOperationEmitter) {
    this.r2Adapter = new TenantR2Adapter(scope, bucket, emit);
  }

  /** Prepare one upload attempt before any marker read or put. */
  prepareUploadAttempt(): Promise<void> {
    return Promise.resolve();
  }

  async getAttachment(objectId: string) {
    return this.r2Adapter.get(objectId);
  }

  async putAttachment(objectId: string, value: any, options?: any) {
    const res = await this.r2Adapter.put(objectId, value, options);
    return { key: objectId, res };
  }

  async deleteAttachment(objectId: string) {
    return this.r2Adapter.delete(objectId);
  }
}

export class LegacyArticleBodyStorage {
  constructor(private scope: VerifiedTenantScope, private rawBucket: R2Bucket, private emit?: ResourceOperationEmitter) {
    if (scope.tenantId !== 'default-tenant') {
      throw new Error("LegacyArticleBodyStorage is only available to the default legacy tenant");
    }
  }

  async deleteLegacyArticleBody(legacyKey: string) {
    if (!/^tickets\/[a-zA-Z0-9-]+\/articles\/[a-zA-Z0-9-]+\/body\.txt$/.test(legacyKey)) {
      throw new Error('Invalid legacy article body key format');
    }
    return measureResourceOperation({ resource: 'r2', operation: 'delete', emit: this.emit, execute: () => this.rawBucket.delete(legacyKey) });
  }

  async getLegacyUnscopedAttachment(legacyKey: string) {
    const legacyPattern = /^tickets\/[a-zA-Z0-9-]+\/articles\/[a-zA-Z0-9-]+\/body\.txt$/;
    if (!legacyPattern.test(legacyKey)) {
      throw new Error("Invalid legacy article body key format.");
    }
    return measureResourceOperation({ resource: 'r2', operation: 'read', emit: this.emit, execute: () => this.rawBucket.get(legacyKey) });
  }
}


export class TenantArticleBodyHydrator {
  constructor(
    private attachmentStorage: TenantAttachmentStorage,
    private legacyArticleStorage?: LegacyArticleBodyStorage
  ) {}

  async hydrate(body: string | null, bodyR2Key: string | null, maxLength: number = 8192): Promise<string> {
    if (body) return body.substring(0, maxLength);
    if (!bodyR2Key) return '';

    try {
      let obj = await this.attachmentStorage.getAttachment(bodyR2Key);
      if (!obj && /^tickets\/[a-zA-Z0-9-]+\/articles\/[a-zA-Z0-9-]+\/body\.txt$/.test(bodyR2Key)) {
        if (!this.legacyArticleStorage) return '[Legacy article body unavailable]';
        obj = await this.legacyArticleStorage.getLegacyUnscopedAttachment(bodyR2Key);
      }

      if (obj) {
        // Limit bytes consumed, cancel the remaining stream, and never buffer the whole object.
        const reader = obj.body.getReader();
        const decoder = new TextDecoder();
        let text = '';
        let remaining = maxLength * 4;
        try {
          while (remaining > 0) {
            const { done, value } = await reader.read();
            if (done) break;
            const part = value.subarray(0, remaining);
            text += decoder.decode(part, { stream: true });
            remaining -= part.byteLength;
            if (text.length >= maxLength) break;
          }
          return (text + decoder.decode()).substring(0, maxLength);
        } finally {
          await reader.cancel();
          reader.releaseLock();
        }
      }
    } catch (e) {
      console.error('Failed to hydrate article body:', e);
    }
    return '';
  }
}
