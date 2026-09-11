import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    jwtVerify: vi.fn().mockResolvedValue({
      payload: {
        sub: "agent-1",
        email: "agent@example.com",
        role: "admin",
        tenant_id: "default-tenant",
        mfa_verified: true,
        session_version: 0,
        exp: 2_000_000_000
      }
    })
  };
});




import knowledgeHandler from "../knowledge.handler";
import { authService } from "../../services/auth/auth.service";


// Mock DB
const mockDB = {
  prepare: vi.fn().mockReturnThis(),
  bind: vi.fn().mockReturnThis(),
  first: vi.fn().mockResolvedValue({ tenant_id: "default-tenant", id: "agent-1", role: "admin", mfa_enabled: true }),
};

const JWT_SECRET = "test-secret-key-at-least-32-chars-long-123456";
let validToken: string;

import { TenantKnowledgeService } from "../../services/tenant-knowledge.service";
import { IsolateBudgetAdmissionCache } from '../../budgets/isolate-admission.service';
import { SessionBudgetAdmissionService } from '../../budgets/session-admission.service';
import { KnowledgeSourceAdmissionError } from '../../budgets/knowledge-source-admission.service';
describe("Knowledge Handler Integration Tests", () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    const mockUser = {
      id: "agent-1",
      tenant_id: "default-tenant",
      email: "agent@example.com",
      role: "admin" as const,
      mfa_enabled: true,
    };
    // authMiddleware expects session in db or a valid JWT
    validToken = await authService.generateToken(mockUser as any, JWT_SECRET, true);
  });

  const request = async (path: string, method: string = "GET", body?: any) => {
    return knowledgeHandler.request(
      path,
      {
        method,
        headers: {
          Authorization: `Bearer ${validToken}`,
          "Content-Type": "application/json"
        },
        body: body ? JSON.stringify(body) : undefined
      },
      { DB: mockDB as any, JWT_SECRET }
    );
  };

  const rawRequest = async (body: string) => knowledgeHandler.request(
    "/articles/art-1/qa",
    { method: "POST", headers: { Authorization: `Bearer ${validToken}`, "Content-Type": "application/json" }, body },
    { DB: mockDB as any, JWT_SECRET }
  );

  describe("Categories", () => {
    it("should get categories", async () => {
      vi.spyOn(TenantKnowledgeService.prototype, 'getCategories').mockResolvedValue([{ id: "cat-1", name: "General", created_at: "", updated_at: "" }] as any);
      const res = await request("/categories");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual([{ id: "cat-1", name: "General", created_at: "", updated_at: "" }]);
    });

    it("should create a category with valid payload", async () => {
      const mockCreate = vi.spyOn(TenantKnowledgeService.prototype, 'createCategory').mockResolvedValue("new-cat-id");
      const res = await request("/categories", "POST", { name: "New Category" });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({ id: "new-cat-id" });
      expect(mockCreate).toHaveBeenCalledWith("New Category", undefined);
    });

    it("should reject creating a category with missing name", async () => {
      const res = await request("/categories", "POST", { name: "" });
      expect(res.status).toBe(400);
      const data: any = await res.json();
      expect(data.error).toBe("Name is required");
    });

    it("should delete a category", async () => {
      const mockDelete = vi.spyOn(TenantKnowledgeService.prototype, 'deleteCategory').mockResolvedValue(undefined);
      const res = await request("/categories/cat-1", "DELETE");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({ success: true });
      expect(mockDelete).toHaveBeenCalledWith("cat-1");
    });
  });

  describe("Articles", () => {
    it("should create an article with valid payload", async () => {
      const mockCreate = vi.spyOn(TenantKnowledgeService.prototype, 'createArticle').mockResolvedValue("new-article-id");
      const res = await request("/articles", "POST", { title: "Title", content: "Content" });
      expect(res.status).toBe(202);
      const data = await res.json();
      expect(data).toEqual({ id: "new-article-id", indexing: "pending" });
      expect(mockCreate).toHaveBeenCalledWith("Title", "Content", null, undefined, { status: 'disabled' });
    });

    it('does not write a source or dispatch a workflow when current staff budget admission is denied', async () => {
      const create = vi.spyOn(TenantKnowledgeService.prototype, 'createArticle').mockResolvedValue('new-article-id');
      vi.spyOn(SessionBudgetAdmissionService.prototype, 'admit').mockResolvedValueOnce({ status: 'rejected', reason: 'exhausted' } as any);
      const response = await knowledgeHandler.request('/articles', {
        method: 'POST', headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Title', content: 'Content' }),
      }, { DB: mockDB as any, JWT_SECRET, BUDGET_ADMISSION_POLICY: 'ticket-mutations-v1', BUDGET_COORDINATOR_DO: {} } as any);
      expect(response.status).toBe(429);
      expect(create).not.toHaveBeenCalled();
    });

    it('returns the controlled admission failure when authority changes before source commit',async()=>{
      vi.spyOn(TenantKnowledgeService.prototype,'createArticle').mockRejectedValueOnce(new KnowledgeSourceAdmissionError('Knowledge source admission unavailable'));
      const response=await request('/articles','POST',{title:'Title',content:'Content'});
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({code:'budget_admission_unavailable',error:'Budget admission authority is unavailable'});
    });

    it("should reject creating an article with missing content", async () => {
      const res = await request("/articles", "POST", { title: "Title" });
      expect(res.status).toBe(400);
    });

    it("should update an article with valid payload", async () => {
      const mockUpdate = vi.spyOn(TenantKnowledgeService.prototype, 'updateArticle').mockResolvedValue(undefined);
      const res = await request("/articles/art-1", "PUT", { title: "New Title", content: "New Content" });
      expect(res.status).toBe(202);
      const data = await res.json();
      expect(data).toEqual({ success: true, indexing: "pending" });
      expect(mockUpdate).toHaveBeenCalledWith("art-1", "New Title", "New Content", null, undefined, { status: 'disabled' });
    });

    it("should get article content", async () => {
      const mockGetContent = vi.spyOn(TenantKnowledgeService.prototype, 'getArticleContent').mockResolvedValue("Article content here");
      const res = await request("/articles/art-1/content");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({ content: "Article content here" });
      expect(mockGetContent).toHaveBeenCalledWith("art-1");
    });

    it("should handle article content not found", async () => {
      const mockGetContent = vi.spyOn(TenantKnowledgeService.prototype, 'getArticleContent').mockRejectedValue(new Error("Article not found"));
      const res = await request("/articles/art-1/content");
      expect(res.status).toBe(404);
      const data: any = await res.json();
      expect(data.error).toBe("Article not found");
    });

    it.each([
      ['unsupported string', { type: 'question' }],
      ['unknown string', { type: 'invalid' }],
      ['missing type', {}],
      ['null body', null],
      ['array body', []],
      ['non-string type', { type: 1 }],
    ])('rejects %s without mutation', async (_label, body) => {
      const mark = vi.spyOn(TenantKnowledgeService.prototype, 'markArticleAsQA').mockResolvedValue(undefined);
      const res = await request('/articles/art-1/qa', 'POST', body);
      expect(res.status).toBe(400);
      expect(mark).not.toHaveBeenCalled();
    });

    it('rejects malformed JSON without mutation', async () => {
      const mark = vi.spyOn(TenantKnowledgeService.prototype, 'markArticleAsQA').mockResolvedValue(undefined);
      const res = await rawRequest('{"type":');
      expect(res.status).toBe(400);
      expect(mark).not.toHaveBeenCalled();
    });

    it('accepts null to unmark an article', async () => {
      const mark = vi.spyOn(TenantKnowledgeService.prototype, 'markArticleAsQA').mockResolvedValue(undefined);
      const res = await request('/articles/art-1/qa', 'POST', { type: null });
      expect(res.status).toBe(200);
      expect(mark).toHaveBeenCalledWith('art-1', null, undefined);
    });

    it.each(['answer', 'sop'])('accepts the tenant QA marker %s', async (type) => {
      const mark = vi.spyOn(TenantKnowledgeService.prototype, 'markArticleAsQA').mockResolvedValue(undefined);
      const res = await request('/articles/art-1/qa', 'POST', { type });
      expect(res.status).toBe(202);
      expect(mark).toHaveBeenCalledWith('art-1', type, { status: 'disabled' });
    });
  });
  it('returns a controlled error when knowledge tag stripping rejects excessive depth', async () => {
    vi.spyOn(TenantKnowledgeService.prototype, 'getAiSuggestion').mockRejectedValueOnce(new Error('Maximum tag stripping depth exceeded: possible malicious input'));
    vi.spyOn(IsolateBudgetAdmissionCache.prototype, 'admit').mockResolvedValueOnce({ status: 'spent' } as any);
    const response = await knowledgeHandler.request('/tickets/ticket/ai-suggest', {headers:{Authorization:`Bearer ${validToken}`}}, {
      DB:mockDB, JWT_SECRET, BUDGET_ADMISSION_POLICY: 'ticket-mutations-v1', BUDGET_COORDINATOR_DO: {},
    } as any);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({error:'Content exceeds supported markup depth'});
  });

  it('returns the manual suggestion fallback before ticket, Vectorize, R2, or AI work when AI is off', async () => {
    const suggestion = vi.spyOn(TenantKnowledgeService.prototype, 'getAiSuggestion');
    const response = await knowledgeHandler.request('/tickets/ticket/ai-suggest', {
      headers: { Authorization: `Bearer ${validToken}` },
    }, { DB: mockDB, JWT_SECRET, BUDGET_ADMISSION_POLICY: 'off', AI: { run: vi.fn() },
      VECTOR_INDEX: { query: vi.fn() }, ATTACHMENTS_BUCKET: { get: vi.fn() } } as any);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ suggestion: "I'm sorry, I'm having trouble generating a suggestion right now. Please try again or draft a manual response." });
    expect(suggestion).not.toHaveBeenCalled();
  });

  it('does not retry an admitted provider failure', async () => {
    const suggestion = vi.spyOn(TenantKnowledgeService.prototype, 'getAiSuggestion').mockRejectedValueOnce(new Error('synthetic provider failure'));
    const admission = vi.spyOn(IsolateBudgetAdmissionCache.prototype, 'admit').mockResolvedValueOnce({ status: 'spent' } as any);
    const response = await knowledgeHandler.request('/tickets/ticket/ai-suggest', {
      headers: { Authorization: `Bearer ${validToken}` },
    }, { DB: mockDB, JWT_SECRET, BUDGET_ADMISSION_POLICY: 'ticket-mutations-v1', BUDGET_COORDINATOR_DO: {} } as any);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ suggestion: "I'm sorry, I'm having trouble generating a suggestion right now. Please try again or draft a manual response." });
    expect(admission).toHaveBeenCalledTimes(1);
    expect(suggestion).toHaveBeenCalledTimes(1);
  });

});
