import { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { VerifiedTenantScope } from '../types/tenant';
import crypto from 'node:crypto';

export interface KnowledgeDoc {
  tenant_id: string;
  id: string;
  title: string;
  file_path: string;
  status: string;
  category_id?: string;
  chunk_count: number;
  tier: 'answer' | 'sop';
  created_at: string;
}

export interface KnowledgeCategory {
  tenant_id: string;
  id: string;
  name: string;
  parent_id?: string;
  created_at: string;
}

export class SqlKnowledgeRepository {
  constructor(private scope: VerifiedTenantScope, private db: D1Database) {}

  async listDocuments(): Promise<KnowledgeDoc[]> {
    return this.db.prepare("SELECT * FROM knowledge_docs WHERE tenant_id = ? ORDER BY created_at DESC")
      .bind(this.scope.tenantId).all<KnowledgeDoc>().then(r => r.results);
  }

  async getDocument(id: string): Promise<KnowledgeDoc | null> {
    return this.db.prepare("SELECT * FROM knowledge_docs WHERE tenant_id = ? AND id = ?")
      .bind(this.scope.tenantId, id).first<KnowledgeDoc>();
  }

  createDocumentStatement(data: { id: string; title: string; file_path: string; category_id?: string | null; tier?: 'answer' | 'sop' }): D1PreparedStatement {
    return this.db.prepare(
      "INSERT INTO knowledge_docs (tenant_id, id, title, file_path, category_id, tier) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(this.scope.tenantId, data.id, data.title, data.file_path, data.category_id || null, data.tier || 'answer');
  }

  async createDocument(data: { id?: string; title: string; file_path: string; category_id?: string | null; tier?: 'answer' | 'sop' }): Promise<string> {
    const id = data.id || crypto.randomUUID();
    await this.createDocumentStatement({ ...data, id }).run();
    return id;
  }

  async updateDocument(id: string, data: { title?: string; file_path?: string; category_id?: string | null; chunk_count?: number; tier?: 'answer' | 'sop', status?: 'draft'|'pending'|'published' }): Promise<void> {
    const statement = this.updateDocumentStatement(id,data);
    if (statement) await statement.run();
  }

  updateDocumentStatement(id: string, data: { title?: string; file_path?: string; category_id?: string | null; chunk_count?: number; tier?: 'answer' | 'sop', status?: 'draft'|'pending'|'published' }): D1PreparedStatement | null {
    const updates: string[] = [];
    const values: any[] = [];
    if (data.title !== undefined) { updates.push('title = ?'); values.push(data.title); }
    if (data.file_path !== undefined) { updates.push('file_path = ?'); values.push(data.file_path); }
    if (data.category_id !== undefined) { updates.push('category_id = ?'); values.push(data.category_id); }
    if (data.chunk_count !== undefined) { updates.push('chunk_count = ?'); values.push(data.chunk_count); }
    if (data.status !== undefined) { updates.push('status = ?'); values.push(data.status); }
    if (data.tier !== undefined) { updates.push('tier = ?'); values.push(data.tier); }
    
    if (updates.length === 0) return null;
    
    values.push(this.scope.tenantId, id);
    const sql = `UPDATE knowledge_docs SET ${updates.join(', ')} WHERE tenant_id = ? AND id = ?`;
    return this.db.prepare(sql).bind(...values);
  }

  /** Required source metadata update. A missing/superseded document aborts the
   * surrounding fenced batch instead of leaving a detached source version. */
  updateDocumentRequiredStatements(id: string, data: { title?: string; file_path?: string; category_id?: string | null; chunk_count?: number; tier?: 'answer' | 'sop', status?: 'draft'|'pending'|'published' }): readonly D1PreparedStatement[] {
    const update = this.updateDocumentStatement(id,data);
    if (!update) throw new Error('Empty knowledge source metadata update');
    return [update,this.db.prepare(`INSERT INTO budget_mutation_assertion(tenant_id,accepted) VALUES (?,CASE WHEN changes()=1 THEN 1 ELSE 0 END)
      ON CONFLICT(tenant_id) DO UPDATE SET accepted=excluded.accepted`).bind(this.scope.tenantId)];
  }

  async deleteDocument(id: string): Promise<void> {
    await this.db.prepare("DELETE FROM knowledge_docs WHERE tenant_id = ? AND id = ?").bind(this.scope.tenantId, id).run();
  }

  async getCategories(): Promise<KnowledgeCategory[]> {
    return this.db.prepare("SELECT * FROM knowledge_categories WHERE tenant_id = ? ORDER BY created_at ASC")
      .bind(this.scope.tenantId).all<KnowledgeCategory>().then(r => r.results);
  }

  async createCategory(name: string, parentId?: string): Promise<string> {
    const id = crypto.randomUUID();
    await this.db.prepare(
      "INSERT INTO knowledge_categories (tenant_id, id, name, parent_id) VALUES (?, ?, ?, ?)"
    ).bind(this.scope.tenantId, id, name, parentId || null).run();
    return id;
  }

  async deleteCategory(id: string): Promise<void> {
    const hasDocs = await this.db.prepare("SELECT 1 FROM knowledge_docs WHERE tenant_id = ? AND category_id = ? LIMIT 1").bind(this.scope.tenantId, id).first();
    if (hasDocs) {
      throw new Error("Category contains articles and cannot be deleted");
    }
    await this.db.prepare("DELETE FROM knowledge_categories WHERE tenant_id = ? AND id = ?").bind(this.scope.tenantId, id).run();
  }
}
