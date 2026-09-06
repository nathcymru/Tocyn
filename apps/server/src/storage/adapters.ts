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
  constructor(private scope: VerifiedTenantScope, private bucket: R2Bucket) {}

  private getScopedKey(objectId: string): string {
    return `${this.scope.tenantId}/${objectId}`;
  }

  async get(objectId: string) {
    return this.bucket.get(this.getScopedKey(objectId));
  }

  async put(objectId: string, value: any, options?: any) {
    return this.bucket.put(this.getScopedKey(objectId), value, options);
  }

  async delete(objectId: string) {
    return this.bucket.delete(this.getScopedKey(objectId));
  }
}

export class TenantVectorizeAdapter {
  constructor(private scope: VerifiedTenantScope, private index: VectorizeIndex) {}

  private getNamespace(): string {
    const hash = createHash('sha256').update(this.scope.tenantId).digest('base64url');
    // Ensure <= 64 bytes (base64url of sha256 is 43 chars, "t_" + 43 = 45 chars)
    return `t_${hash}`;
  }

  private getScopedId(documentId: string): string {
    const hash = createHash('sha256');
    hash.update(this.scope.tenantId);
    hash.update('\0');
    hash.update(documentId);
    // hex digest is exactly 64 bytes, perfectly hitting the limit.
    return hash.digest('hex'); 
  }

  async upsert(documentId: string, values: number[]) {
    return this.index.upsert([{
      id: this.getScopedId(documentId),
      values,
      namespace: this.getNamespace()
    }]);
  }

  async getByIds(documentIds: string[]) {
    return this.index.getByIds(documentIds.map(id => this.getScopedId(id)));
  }

  async delete(documentId: string) {
    return this.index.deleteByIds([this.getScopedId(documentId)]);
  }

  async query(vector: number[], options: any = {}) {
    return this.index.query(vector, {
      ...options,
      namespace: this.getNamespace()
    });
  }
}

export class TenantAttachmentStorage {
  private r2Adapter: TenantR2Adapter;
  private rawBucket: R2Bucket;

  constructor(scope: VerifiedTenantScope, bucket: R2Bucket) {
    this.rawBucket = bucket;
    this.r2Adapter = new TenantR2Adapter(scope, bucket);
  }

  async getAttachment(objectId: string) {
    return this.r2Adapter.get(objectId);
  }

  async putAttachment(objectId: string, value: any, options?: any) {
    // Cloudflare R2 bucket put accepts options like { httpMetadata: { contentType: ... } }
    // but TenantR2Adapter put doesn't pass options in its current signature. 
    // We need to update TenantR2Adapter to accept options.
    return this.r2Adapter.put(objectId, value, options);
  }

  async deleteAttachment(objectId: string) {
    return this.r2Adapter.delete(objectId);
  }
}

export class LegacyArticleBodyStorage {
  constructor(private scope: VerifiedTenantScope, private rawBucket: R2Bucket) {
    if (scope.tenantId !== 'default-tenant') {
      throw new Error("LegacyArticleBodyStorage is only available to the default legacy tenant");
    }
  }

  async getLegacyUnscopedAttachment(legacyKey: string) {
    const legacyPattern = /^tickets\/[a-zA-Z0-9-]+\/articles\/[a-zA-Z0-9-]+\/body\.txt$/;
    if (!legacyPattern.test(legacyKey)) {
      throw new Error("Invalid legacy article body key format.");
    }
    return this.rawBucket.get(legacyKey);
  }
}
