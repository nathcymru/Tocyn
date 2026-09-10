import { describe, it, expect, vi, beforeEach } from "vitest";
import dashboard from "../dashboard.handler";
import { authService } from "../../services/auth/auth.service";

// Mock DB
const mockDB = {
  prepare: vi.fn().mockReturnThis(),
  bind: vi.fn().mockReturnThis(),
  all: vi.fn(),
  first: vi.fn(),
  run: vi.fn(),
  batch: vi.fn(),
};

const mockNotificationsDO = {
  idFromName: vi.fn().mockReturnValue({}),
  get: vi.fn().mockReturnValue({
    fetch: vi.fn().mockResolvedValue(new Response())
  })
};

const mockBucket = {
  put: vi.fn().mockResolvedValue({}),
  get: vi.fn().mockResolvedValue(null),
  delete: vi.fn().mockResolvedValue({}),
};

const JWT_SECRET = "test-secret-key-at-least-32-chars-long-123456";
let validToken: string;

const request = (path: string, init?: RequestInit, env?: any) => {
  return dashboard.request(path, init, { DB: mockDB as any, JWT_SECRET, NOTIFICATION_DO: mockNotificationsDO as any, ATTACHMENTS_BUCKET: mockBucket, ...env });
};

let firstQueue: any[] = [];

describe("Dashboard Handler Integration Tests", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    firstQueue = [];
    mockDB.all.mockResolvedValue({ results: [] });
    mockDB.run.mockResolvedValue({ success: true });
    mockDB.batch.mockResolvedValue([{results:[{id:'t-1'}]}]);
    mockDB.prepare.mockReturnThis();
    mockDB.bind.mockReturnThis();
    mockDB.first.mockImplementation(async () => {
      const prepCalls = vi.mocked(mockDB.prepare).mock.calls;
      const lastQuery = prepCalls.length > 0 ? prepCalls[prepCalls.length - 1][0] : "";
      if (typeof lastQuery === "string" && lastQuery.includes("deployment_capability_ceiling")) return { enabled: 1, revision: 1 };
      if (typeof lastQuery === "string" && lastQuery.includes("deployment_role_capability_grants")) return { enabled: 1, revision: 1 };
      if (typeof lastQuery === "string" && lastQuery.includes("tenant_role_capability_policies")) {
        const bindCalls = vi.mocked(mockDB.bind).mock.calls;
        const capability = bindCalls.at(-1)?.[2];
        return { enabled: capability === "api-keys.manage" ? 1 : 0, revision: 1 };
      }
      if (typeof lastQuery === "string" && lastQuery.includes("FROM users")) {
        const bindCalls = vi.mocked(mockDB.bind).mock.calls;
        const sub = bindCalls.length > 0 ? bindCalls[bindCalls.length - 1][1] : "agent-1";
        if (sub === "c-1") return { tenant_id: "default-tenant", id: "c-1", email: "customer@example.com", role: "customer" };
        return { tenant_id: "default-tenant", id: sub, email: "agent@example.com", role: "agent" };
      }
      if (firstQueue.length > 0) {
        return firstQueue.shift();
      }
      return { value: JSON.stringify({ api_keys: true }) };
    });

    const mockUser = {
      id: "agent-1",
      email: "agent@example.com",
      role: "agent" as const,
      mfa_enabled: true,
      tenant_id: "default-tenant",
    };
    validToken = await authService.generateToken(mockUser as any, JWT_SECRET, true);
  });

  describe("GET /tickets", () => {
    it("should list tickets with default pagination", async () => {
      mockDB.all.mockResolvedValueOnce({ results: [{ id: "t-1", subject: "Ticket 1" }] });
      firstQueue.push({ total: 1 });

      const res = await dashboard.request(
        "/tickets",
        {
          headers: { Authorization: `Bearer ${validToken}` },
        },
        { DB: mockDB as any, JWT_SECRET, NOTIFICATION_DO: mockNotificationsDO as any, ATTACHMENTS_BUCKET: mockBucket }
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toBeDefined();
      expect(body.total).toBe(1);
    });

    it("should list customer tickets", async () => {
      mockDB.all.mockResolvedValueOnce({ results: [] });
      firstQueue.push({ count: 0 });

      const res = await dashboard.request(
        "/tickets?customer_email=test@example.com&page=2&limit=10",
        {
          headers: { Authorization: `Bearer ${validToken}` },
        },
        { DB: mockDB as any, JWT_SECRET, NOTIFICATION_DO: mockNotificationsDO as any, ATTACHMENTS_BUCKET: mockBucket }
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toBeDefined();
      expect(body.total).toBe(0);
      expect(mockDB.bind).toHaveBeenCalledWith("default-tenant", "test@example.com", 10, 10);
    });

    it("should apply status filter ", async () => {
      mockDB.all.mockResolvedValueOnce({ results: [] });
      firstQueue.push({ count: 0 });

      const res = await dashboard.request(
        "/tickets?status=open",
        {
          headers: { Authorization: `Bearer ${validToken}` },
        },
        { DB: mockDB as any, JWT_SECRET, NOTIFICATION_DO: mockNotificationsDO as any, ATTACHMENTS_BUCKET: mockBucket }
      );

      expect(res.status).toBe(200);
    });

    it("should apply assigned_to filter ", async () => {
      mockDB.all.mockResolvedValueOnce({ results: [] });
      firstQueue.push({ count: 0 });

      const res = await dashboard.request(
        "/tickets?assigned_to=agent-1",
        {
          headers: { Authorization: `Bearer ${validToken}` },
        },
        { DB: mockDB as any, JWT_SECRET, NOTIFICATION_DO: mockNotificationsDO as any, ATTACHMENTS_BUCKET: mockBucket }
      );

      expect(res.status).toBe(200);
    });
  });

  describe("GET /tickets/:id", () => {
    it("should return detailed ticket info", async () => {
      const mockTicket = {
        id: "t-1",
        subject: "Ticket 1",
        customer_id: "c-1",
        assigned_to: "agent-1"
      };
      const mockArticles = [
        { id: "art-1", ticket_id: "t-1", body: "Hello", sender_type: "customer" }
      ];
      const mockAttachments = [
        { id: "att-1", article_id: "art-1", file_name: "test.txt" }
      ];

      firstQueue.push(mockTicket);

      mockDB.all
        .mockResolvedValueOnce({ results: mockArticles })    // Articles
        .mockResolvedValueOnce({ results: mockAttachments }); // Attachments

      const res = await dashboard.request(
        "/tickets/t-1",
        {
          headers: { Authorization: `Bearer ${validToken}` },
        },
        { DB: mockDB as any, JWT_SECRET, NOTIFICATION_DO: mockNotificationsDO as any, ATTACHMENTS_BUCKET: mockBucket }
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe("t-1");
      expect(body.articles).toHaveLength(1);
      expect(body.articles[0].attachments).toHaveLength(1);
      expect(body.customer.email).toBe("customer@example.com");
      expect(body.assignee.email).toBe("agent@example.com");
    });

    it("should return 404 for non-existent ticket", async () => {
      firstQueue.push(null);

      const res = await dashboard.request(
        "/tickets/non-existent",
        {
          headers: { Authorization: `Bearer ${validToken}` },
        },
        { DB: mockDB as any, JWT_SECRET, NOTIFICATION_DO: mockNotificationsDO as any, ATTACHMENTS_BUCKET: mockBucket }
      );

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Ticket not found" });
    });
  });

  describe("PATCH /tickets/:id", () => {
    it("should update ticket and create a system note", async () => {
      mockDB.run.mockResolvedValue({ success: true });

      const validUuid = "123e4567-e89b-12d3-a456-426614174000";

      const res = await dashboard.request(
        "/tickets/t-1",
        {
          method: "PATCH",
          headers: {
            "Authorization": `Bearer ${validToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            status: "resolved",
            assigned_to: validUuid
          })
        },
        { DB: mockDB as any, JWT_SECRET, NOTIFICATION_DO: mockNotificationsDO as any, ATTACHMENTS_BUCKET: mockBucket }
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });

      // Verify ticket update query
      expect(mockDB.prepare).toHaveBeenCalledWith(expect.stringContaining("UPDATE tickets SET status=?,assigned_to=?,updated_at=CURRENT_TIMESTAMP"));
      expect(mockDB.bind).toHaveBeenCalledWith("resolved", validUuid, "default-tenant", "t-1", "resolved", validUuid);
      expect(mockDB.batch).toHaveBeenCalledTimes(1);
      expect(mockDB.prepare).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO conversation_events"));
      // Verify system note insertion
      expect(mockDB.prepare).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO articles"));
    });

    it("should return 400 for no valid fields", async () => {
      const res = await dashboard.request(
        "/tickets/t-1",
        {
          method: "PATCH",
          headers: {
            "Authorization": `Bearer ${validToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ invalid_field: "value" })
        },
        { DB: mockDB as any, JWT_SECRET, NOTIFICATION_DO: mockNotificationsDO as any, ATTACHMENTS_BUCKET: mockBucket }
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "No valid fields to update" });
    });
  });

  describe("Lookups", () => {
    it("should return agents list", async () => {
      const res = await dashboard.request(
        "/users/agents",
        {
          headers: { Authorization: `Bearer ${validToken}` },
        },
        { DB: mockDB as any, JWT_SECRET, NOTIFICATION_DO: mockNotificationsDO as any, ATTACHMENTS_BUCKET: mockBucket }
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
    });

    it("should return groups list", async () => {
      const mockGroups = [
        { id: "g-1", name: "Support" },
        { id: "g-2", name: "Engineering" },
      ];
      mockDB.all.mockResolvedValueOnce({ results: mockGroups });

      const res = await dashboard.request(
        "/groups",
        {
          headers: { Authorization: `Bearer ${validToken}` },
        },
        { DB: mockDB as any, JWT_SECRET, NOTIFICATION_DO: mockNotificationsDO as any, ATTACHMENTS_BUCKET: mockBucket }
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(mockGroups);
      expect(mockDB.prepare).toHaveBeenCalledWith("SELECT * FROM groups WHERE tenant_id = ?");
    });
  });

  describe("API Key Management", () => {
    it("should list API keys", async () => {
      const mockKeys = [{ id: "key-1", name: "Production" }];
      mockDB.all.mockResolvedValueOnce({ results: [] }).mockResolvedValueOnce({ results: mockKeys });

      const res = await dashboard.request(
        "/api-keys",
        {
          headers: { Authorization: `Bearer ${validToken}` },
        },
        { DB: mockDB as any, JWT_SECRET, NOTIFICATION_DO: mockNotificationsDO as any, ATTACHMENTS_BUCKET: mockBucket }
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(mockKeys);
      expect(mockDB.prepare).toHaveBeenCalledWith(expect.stringContaining("SELECT id, name, prefix, is_active, created_at, last_used_at FROM api_keys WHERE tenant_id = ?"));
    });

    it("should create a new API key", async () => {
      mockDB.run.mockResolvedValueOnce({ success: true });

      const res = await dashboard.request(
        "/api-keys",
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${validToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ name: "Production" })
        },
        { DB: mockDB as any, JWT_SECRET, NOTIFICATION_DO: mockNotificationsDO as any, ATTACHMENTS_BUCKET: mockBucket }
      );

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.apiKey).toBeDefined();
      expect(body.apiKey).toMatch(/^lt_[a-zA-Z0-9]{8}\.[a-zA-Z0-9]{32}$/);
      expect(mockDB.prepare).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO api_keys (tenant_id, id, name, key_hash, prefix, permissions, is_active, created_at)"));
    });

    it("should delete an API key", async () => {
      const res = await dashboard.request(
        "/api-keys/key-1",
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${validToken}` },
        },
        { DB: mockDB as any, JWT_SECRET, NOTIFICATION_DO: mockNotificationsDO as any, ATTACHMENTS_BUCKET: mockBucket }
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });
      expect(mockDB.prepare).toHaveBeenCalledWith(expect.stringContaining("DELETE FROM api_keys WHERE tenant_id = ? AND id = ?"));
    });
  });

  describe("POST /attachments/upload", () => {
    it("should successfully upload a valid file and return a storage key", async () => {
      const formData = new FormData();
      formData.append("file", new File(["test content"], "test.txt", { type: "text/plain" }));

      const res = await dashboard.request(
        "/attachments/upload",
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${validToken}`,
          },
          body: formData
        },
        { DB: mockDB as any, JWT_SECRET, NOTIFICATION_DO: mockNotificationsDO as any, ATTACHMENTS_BUCKET: mockBucket }
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.key).toBeDefined();
      expect(body.key).toContain("agent-attachments/agent-1/");
      expect(body.key).toContain(".txt");
      expect(mockBucket.put).toHaveBeenCalledWith(
        expect.stringContaining("agent-attachments/agent-1/"),
        expect.any(Object),
        expect.objectContaining({ httpMetadata: { contentType: "text/plain" } })
      );
    });

    it("should reject large files based on content-length header", async () => {
      const res = await dashboard.request(
        "/attachments/upload",
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${validToken}`,
            "Content-Length": "10485761"
          },
        },
        { DB: mockDB as any, JWT_SECRET, NOTIFICATION_DO: mockNotificationsDO as any, ATTACHMENTS_BUCKET: mockBucket }
      );

      expect(res.status).toBe(413);
      const body = await res.json();
      expect(body.error).toContain("Payload too large");
    });

    it("should reject unsupported file types", async () => {
      const formData = new FormData();
      formData.append("file", new File(["test content"], "test.exe", { type: "application/x-msdownload" }));

      const res = await dashboard.request(
        "/attachments/upload",
        {
          method: "POST",
          headers: { "Authorization": `Bearer ${validToken}` },
          body: formData
        },
        { DB: mockDB as any, JWT_SECRET, NOTIFICATION_DO: mockNotificationsDO as any, ATTACHMENTS_BUCKET: mockBucket }
      );

      expect(res.status).toBe(415);
      const body = await res.json();
      expect(body.error).toContain("Unsupported file type");
    });
  });

  describe("POST /tickets/:id/articles", () => {
    it("should create an article with attachments", async () => {
      const mockTicket = { id: "t-1", group_id: "g-1", customer_id: "c-1" };
      const mockArticle = { id: "art-1", ticket_id: "t-1", body: "Here is the requested file." };
      mockBucket.get.mockResolvedValueOnce({ size: 1024, httpMetadata: { contentType: "application/pdf" }, body: new ReadableStream({ start(c) { c.close(); } }) });
      const mockAttachment = { id: "att-1", file_name: "invoice.pdf", file_size: 1024, content_type: "application/pdf", r2_key: "agent-attachments/agent-1/uuid.pdf" };

      firstQueue.push(mockTicket, { 1: 1 });
      mockDB.batch.mockResolvedValue([{results:[{response_snapshot:JSON.stringify({version:2,ticket:mockTicket,
        article:{...mockArticle,is_internal:true},attachments:[mockAttachment],audit:[{eventId:'event-1',articleId:mockArticle.id}]})}]}]);

      const res = await dashboard.request(
        "/tickets/t-1/articles",
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${validToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            body: "Here is the requested file.",
            is_internal: true,
            attachments: [
              {
                filename: "invoice.pdf",
                size: 1024,
                contentType: "application/pdf",
                storageKey: "agent-attachments/agent-1/uuid.pdf"
              }
            ]
          })
        },
        { DB: mockDB as any, JWT_SECRET, NOTIFICATION_DO: mockNotificationsDO as any, ATTACHMENTS_BUCKET: mockBucket }
      );

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.attachments).toHaveLength(1);
      expect(body.attachments[0].filename).toBe("invoice.pdf");
      expect(mockDB.batch).toHaveBeenCalledTimes(1);
      expect(mockDB.prepare).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO conversation_events"));
    });
  });
});
