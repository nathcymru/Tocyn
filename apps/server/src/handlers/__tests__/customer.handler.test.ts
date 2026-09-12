vi.mock('../../auth/widget-tenant-resolver', () => ({WidgetTenantResolver: class {
  resolveTenantByKey = vi.fn().mockResolvedValue({tenantId:'default-tenant'});
}}));
import { encryptString } from "../../utils/crypto";
import { describe, it, expect, vi, beforeEach } from "vitest";
import customer from "../customer.handler";
import * as jose from "jose";
import { CustomerAuthService } from "../../services/customer-auth.service";
import { verifyTurnstileToken } from "../../utils/turnstile";
vi.mock("../../utils/turnstile", () => ({
  verifyTurnstileToken: vi.fn().mockResolvedValue(true)
}));
import { TenantTicketService } from "../../services/tenant-ticket.service";
import { Hono } from 'hono';
import { operationalObservability } from '../../middleware/operational-observability';
import type { RequestAuthSliSnapshot } from '../../observability/request-auth-sli';
import { CustomerAuthBudgetFenceError } from '../../repositories/customer-auth-budget-fence';

// Define mock functions so they can be overridden in tests
const { mockAdmitCustomerAuthEffect } = vi.hoisted(() => ({ mockAdmitCustomerAuthEffect: vi.fn() }));
const mockRequestAuth = vi.fn().mockResolvedValue(undefined);
const mockVerifyAuthWithDecision = vi.fn().mockResolvedValue({
  decision: 'accepted',
  result: {
    token: "mock-jwt-token",
    user: { id: "user-1", tenant_id: "default-tenant", email: "test@example.com", role: "customer" },
  },
});

const mockFindTickets = vi.fn().mockResolvedValue({ data: [], total: 0 });
const mockCreateTicketWithArticle = vi.fn().mockResolvedValue({
  ticket: { id: "ticket-1", customer_email: "test@example.com" },
  article: { id: "article-1", ticket_id: "ticket-1", is_internal: false },
});
const mockFindTicketById = vi.fn().mockResolvedValue({ id: "ticket-1", customer_email: "test@example.com" });
const mockCreateArticle = vi.fn().mockResolvedValue({ id: "article-1" });
const mockAddAttachment = vi.fn().mockResolvedValue({ id: "attachment-1" });
const mockProjectCanonicalConversation = vi.fn().mockReturnValue({ conversation: {}, messages: [] });
const mockGetCurrentUser = vi.fn().mockResolvedValue({ email: 'test@example.com' });

vi.mock("../../services/customer-auth.service", () => {
  return {
    CustomerAuthService: vi.fn().mockImplementation(function() {
      return {
        resolveTenantFromWidgetKey: vi.fn().mockResolvedValue("default-tenant"),
        requestAuth: mockRequestAuth,
        verifyAuthWithDecision: mockVerifyAuthWithDecision,
        resolveTenantFromWidgetKey: vi.fn().mockResolvedValue("default-tenant"),
        getConfig: vi.fn().mockResolvedValue({ TICKET_PREFIX: '#' })
      };
    })
  };
});

vi.mock('../../budgets/customer-auth-admission.service', () => ({
  admitCustomerAuthEffect: mockAdmitCustomerAuthEffect,
}));

// These tests cover customer-route orchestration after ingress has admitted a
// request. The bounded anonymous ingress path has its own Worker-runtime
// coverage, including saturation and the 429 response, in
// scripts/owner-ingress-admission-runtime.test.ts.
vi.mock('../../middleware/rate-limiter', () => ({
  rateLimiter: () => async (_c: unknown, next: () => Promise<void>) => next(),
}));

vi.mock("../../services/tenant-ticket.service", () => {
  return {
    TenantTicketService: vi.fn().mockImplementation(function() {
      return {
        findTickets: mockFindTickets,
        createTicketWithArticle: mockCreateTicketWithArticle,
        projectCanonicalConversation: mockProjectCanonicalConversation,
        projectAuditedConversation: mockProjectCanonicalConversation,
        findTicketById: mockFindTicketById,
        createArticle: mockCreateArticle,
        addAttachment: mockAddAttachment,
        getTicketArticles: vi.fn().mockResolvedValue([{ id: "article-1", is_internal: false }]),
        hydrateArticles: vi.fn().mockResolvedValue([]),
        getArticleAttachments: vi.fn().mockResolvedValue([{ id: "attachment-1", file_name: "test.png", file_size: 100, content_type: "image/png", r2_key: "key" }]),
        updateTicketTimestamp: vi.fn().mockResolvedValue(undefined)
      };
    })
  };
});

// These are handler orchestration tests. Real authorization, atomicity and replay
// are exercised with isolated D1 by scripts/ticket-mutation-replay.test.ts.
const mockPrepareMutation = vi.fn();
const mockCommitMutation = vi.fn();
let putCalledWithKey = "";
vi.mock("../../middleware/tenant.middleware", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../middleware/tenant.middleware")>();
  return {
    ...actual,
    createTenantRequestDeps: (scope: any) => ({
      scope,
      repositories: {
        users: {
          get: mockGetCurrentUser,
          revokeSessions: vi.fn().mockResolvedValue(undefined),
        },
      },
    }),
    tenantMiddleware: async (c: any, next: any) => {
      c.set('tenantDeps', {
        scope: { tenantId: 'default-tenant' },
        ticketMutationReplay: () => ({ prepareMutation: mockPrepareMutation, commit: mockCommitMutation }),
        repositories: {
          attachments: {
            getAttachmentWithMeta: async () => ({ r2_key: "test-key", customer_email: "test@example.com", file_name: "test.png" })
          },
          users: {
            get: mockGetCurrentUser,
            revokeSessions: vi.fn().mockResolvedValue(undefined),
          }
        },
        attachmentStorage: {
          prepareUploadAttempt: vi.fn().mockResolvedValue(undefined),
          putAttachment: async (key: string) => {
            putCalledWithKey = key;
            return {};
          },
          getAttachment: async () => Object.assign(new Response("fake data"), { size: 123, httpMetadata: { contentType: "image/png" } })
        }
      });
      await next();
    }
  };
});



const JWT_SECRET = "test-secret-key-at-least-32-chars-long-123456";

// Mock DO
const mockDO = {
  idFromName: vi.fn().mockReturnValue("global-id"),
  get: vi.fn().mockReturnValue({
    fetch: vi.fn().mockResolvedValue({ ok: true }),
  }),
};

// Mock DB
const mockDB = {
  prepare: vi.fn().mockImplementation(function(query) {
    return {
      bind: vi.fn().mockReturnThis(),
      first: mockDB.first,
      all: mockDB.all,
      run: mockDB.run
    };
  }),
  bind: vi.fn().mockReturnThis(),
  first: vi.fn().mockResolvedValue({ id: "user-1", tenant_id: "default-tenant", email: "test@example.com", full_name: "Test User", role: "customer" }),
  all: vi.fn(),
  run: vi.fn(),
};

async function generateCustomerToken(overrides = {}) {
  const secretKey = new TextEncoder().encode(JWT_SECRET);
  return await new jose.SignJWT({
    sub: "user-1",
    tenant_id: "default-tenant", email: "test@example.com",
    role: "customer",
    ...overrides
  })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience("widget")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(secretKey);
}

describe("Customer Handler Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrepareMutation.mockResolvedValue({ replay: null });
    mockCommitMutation.mockImplementation(async (_prepared, attachments) => ({
      status: 201, replayed: false, keyed: false, ticketId: 'ticket-1', articleId: 'article-1',
      body: attachments === undefined
        ? { ticket: { id: 'ticket-1' }, article: { id: 'article-1' }, canonical: {} }
        : { id: 'article-1', attachments },
    }));
    mockDB.all.mockResolvedValue({ results: [] });
    mockRequestAuth.mockResolvedValue(undefined);
    mockAdmitCustomerAuthEffect.mockResolvedValue({ status: 'disabled' });
    mockGetCurrentUser.mockResolvedValue({ email: 'test@example.com' });
    mockVerifyAuthWithDecision.mockResolvedValue({
      decision: 'accepted',
      result: {
        token: "mock-jwt-token",
        user: { id: "user-1", tenant_id: "default-tenant", email: "test@example.com", role: "customer" },
      },
    });
    mockFindTickets.mockResolvedValue({ data: [], total: 0 });
    mockCreateTicketWithArticle.mockResolvedValue({
      ticket: { id: "ticket-1", subject: "Test", customer_email: "test@example.com" },
      article: { id: "article-1", ticket_id: "ticket-1", is_internal: false },
    });
    mockFindTicketById.mockResolvedValue({ id: "ticket-1", customer_email: "test@example.com" });
    mockCreateArticle.mockResolvedValue({ id: "article-1" });
    mockAddAttachment.mockResolvedValue({ id: "attachment-1" });
      });

  describe("POST /auth/request", () => {
    it("should call authService.requestAuth and return success", async () => {
      const res = await customer.request(
        "/auth/request",
        {
          method: "POST",
          body: JSON.stringify({ widgetKey: "valid_widget_key", email: "test@example.com", type: "magic_link", baseUrl: "http://localhost:5173" }),
          headers: { "Content-Type": "application/json", "X-Widget-Key": "test-key" },
        },
        { DB: mockDB as any, JWT_SECRET, NOTIFICATION_DO: mockDO as any }
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(mockRequestAuth).toHaveBeenCalledWith("test@example.com", "magic_link");
    });

    it('returns 503 and leaves the grant unknown when the fenced customer creation path goes stale', async () => {
      const settle = vi.fn();
      mockAdmitCustomerAuthEffect.mockResolvedValueOnce({ status: 'admitted', admission: { fence: {}, settle } });
      mockRequestAuth.mockRejectedValueOnce(new CustomerAuthBudgetFenceError('stale'));
      const res = await customer.request('/auth/request', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-widget-key': 'test-key' },
        body: JSON.stringify({ widgetKey: 'test-key', email: 'test@example.com', type: 'magic_link' }),
      }, { DB: mockDB as any, JWT_SECRET, NOTIFICATION_DO: mockDO as any });
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ code: 'budget_admission_unavailable' });
      expect(settle).toHaveBeenCalledWith('unknown');
    });

    it('does not expose an unexpected credential-storage failure', async () => {
      const settle = vi.fn();
      mockAdmitCustomerAuthEffect.mockResolvedValueOnce({ status: 'admitted', admission: { fence: {}, settle } });
      mockRequestAuth.mockRejectedValueOnce(new Error('UNIQUE constraint failed: users.email'));
      const res = await customer.request('/auth/request', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-widget-key': 'test-key' },
        body: JSON.stringify({ widgetKey: 'test-key', email: 'test@example.com', type: 'magic_link' }),
      }, { DB: mockDB as any, JWT_SECRET, NOTIFICATION_DO: mockDO as any });
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'Authentication request could not be completed' });
      expect(settle).toHaveBeenCalledWith('unknown');
    });
  });

  describe("POST /auth/verify", () => {
    it("should return token on success and set cookie", async () => {
      const res = await customer.request(
        "/auth/verify",
        {
          method: "POST",
          body: JSON.stringify({ token: "plain-token-123" }),
          headers: { "Content-Type": "application/json", "X-Widget-Key": "test-key" },
        },
        { DB: mockDB as any, JWT_SECRET, ENVIRONMENT: "development" }
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.token).toBe("mock-jwt-token");
      expect(body.user.email).toBe("test@example.com");

      const setCookieHeader = res.headers.get("Set-Cookie");
      expect(setCookieHeader).toContain("lumina_customer_token=mock-jwt-token");
      expect(setCookieHeader).toContain("HttpOnly");
      expect(mockVerifyAuthWithDecision).toHaveBeenCalledWith("plain-token-123", undefined);
    });

    it("should return 401 if token is invalid", async () => {
      mockVerifyAuthWithDecision.mockResolvedValueOnce({ decision: 'denied' });

      const res = await customer.request(
        "/auth/verify",
        {
          method: "POST",
          body: JSON.stringify({ token: "invalid-token" }),
          headers: { "Content-Type": "application/json", "X-Widget-Key": "test-key" },
        },
        { DB: mockDB as any, JWT_SECRET, ENVIRONMENT: "development" }
      );

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Invalid token");
    });

    it('returns 503 and leaves the grant unknown when a fenced verification goes stale', async () => {
      const settle = vi.fn();
      mockAdmitCustomerAuthEffect.mockResolvedValueOnce({ status: 'admitted', admission: { fence: {}, settle } });
      mockVerifyAuthWithDecision.mockRejectedValueOnce(new CustomerAuthBudgetFenceError('stale'));
      const res = await customer.request('/auth/verify', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-widget-key': 'test-key' }, body: JSON.stringify({ token: 'a'.repeat(64) }),
      }, { DB: mockDB as any, JWT_SECRET, ENVIRONMENT: 'development' });
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ code: 'budget_admission_unavailable' });
      expect(settle).toHaveBeenCalledWith('unknown');
    });

    it('preserves the enumeration-safe response without a credential decision when local admission suppressed verification', async () => {
      mockVerifyAuthWithDecision.mockResolvedValueOnce({ decision: 'admission-suppressed' });
      const signals: RequestAuthSliSnapshot[] = [];
      const observed = new Hono();
      observed.use('*', (c, next) => operationalObservability(c as any, next, () => {}, signal => { signals.push(signal); }));
      observed.route('/', customer);
      const response = await observed.request('/auth/verify', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-widget-key': 'test-key' }, body: JSON.stringify({ token: 'opaque-but-private' }),
      }, { DB: mockDB as any, JWT_SECRET, ENVIRONMENT: 'local', LOCAL_BETA_ENABLED: 'false', OBSERVABILITY_MODE: 'isolated-evidence' });
      expect(response.status).toBe(401);
      expect(signals).toEqual([]);
    });
  });

  describe("POST /auth/logout", () => {
    it("should clear the cookie on logout", async () => {
      const token = await generateCustomerToken();
      const res = await customer.request(
        "/auth/logout",
        {
          method: "POST",
          headers: { "Authorization": `Bearer ${token}` },
        },
        { DB: mockDB as any, JWT_SECRET, NOTIFICATION_DO: mockDO as any }
      );

      expect(res.status).toBe(200);
      const setCookieHeader = res.headers.get("Set-Cookie");
      expect(setCookieHeader).toContain("lumina_customer_token=;");
      expect(setCookieHeader).toContain("Max-Age=0");
    });
  });

  describe("GET /auth/me", () => {
    it("should return the current user", async () => {
      const token = await generateCustomerToken();
      mockDB.first.mockResolvedValueOnce({ id: "user-1", tenant_id: "default-tenant", email: "test@example.com", role: "customer" });

      const res = await customer.request(
        "/auth/me",
        {
          method: "GET",
          headers: { "Authorization": `Bearer ${token}` },
        },
        { DB: mockDB as any, JWT_SECRET, NOTIFICATION_DO: mockDO as any }
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.user.email).toBe("test@example.com");

    });

    it('returns 503 and leaves the grant unknown when the current session fence is stale', async () => {
      const settle = vi.fn();
      mockAdmitCustomerAuthEffect.mockResolvedValueOnce({ status: 'admitted', admission: { fence: {}, settle } });
      mockGetCurrentUser.mockRejectedValueOnce(new CustomerAuthBudgetFenceError('stale'));
      const token = await generateCustomerToken();
      const res = await customer.request('/auth/me', { method: 'GET', headers: { Authorization: `Bearer ${token}` } },
        { DB: mockDB as any, JWT_SECRET, NOTIFICATION_DO: mockDO as any });
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ code: 'budget_admission_unavailable' });
      expect(settle).toHaveBeenCalledWith('unknown');
    });
  });

  describe("GET /tickets", () => {
    it("should return a list of tickets", async () => {
      const token = await generateCustomerToken();
      const mockTickets = { data: [{ id: "ticket-1" }, { id: "ticket-2" }], total: 2 };
      mockFindTickets.mockResolvedValueOnce(mockTickets);

      const res = await customer.request(
        "/tickets?page=1&limit=10",
        {
          method: "GET",
          headers: { "Authorization": `Bearer ${token}` },
        },
        { DB: mockDB as any, JWT_SECRET, NOTIFICATION_DO: mockDO as any }
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toHaveLength(2);
      expect(body.total).toBe(2);
      expect(mockFindTickets).toHaveBeenCalledWith({ page: 1, limit: 10, customerEmail: "test@example.com" });
    });
  });


  describe("Turnstile Integration on POST /tickets", () => {
    let originalFetch: any;
    let mockFetch: any;

    beforeEach(() => {
      originalFetch = global.fetch;
      mockFetch = vi.fn();
      global.fetch = mockFetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it("1. validation passes for valid tokens", async () => {
      const token = await generateCustomerToken();
      const masterKey = "12345678901234567890123456789012";
      const encryptedSecret = await encryptString("my-turnstile-secret", masterKey);

      // Mock DB to return the secret key
      mockDB.first.mockImplementation(async () => {
        const prepCalls = vi.mocked(mockDB.prepare).mock.calls;
        const lastQuery = prepCalls.length > 0 ? prepCalls[prepCalls.length - 1][0] : "";
        if (typeof lastQuery === "string" && lastQuery.includes("FROM users")) {
          return { id: "user-1", tenant_id: "default-tenant", email: "test@example.com", full_name: "Test User", role: "customer" };
        }
        return { value: encryptedSecret };
      });

      vi.mocked(verifyTurnstileToken).mockResolvedValueOnce(true);

      const res = await customer.request(
        "/tickets",
        {
          method: "POST",
          body: JSON.stringify({ subject: "Help", message: "I need help", turnstileToken: "valid-token" }),
          headers: { "Content-Type": "application/json", "X-Widget-Key": "test-key", "Authorization": `Bearer ${token}`, "CF-Connecting-IP": "127.0.0.1" },
        },
        { DB: mockDB as any, JWT_SECRET, APP_MASTER_KEY: masterKey, NOTIFICATION_DO: mockDO as any, BUDGET_ADMISSION_POLICY: 'off' }
      );

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.ticket.id).toBe("ticket-1");

      expect(verifyTurnstileToken).toHaveBeenCalled();
      const turnstileArgs = vi.mocked(verifyTurnstileToken).mock.calls[0];

      expect(turnstileArgs[2]).toBe('valid-token');
    });

    it("2a. validation fails securely for invalid tokens (when configured)", async () => {
      const token = await generateCustomerToken();
      const masterKey = "12345678901234567890123456789012";
      const encryptedSecret = await encryptString("my-turnstile-secret", masterKey);

      mockDB.first.mockImplementation(async () => {
        const prepCalls = vi.mocked(mockDB.prepare).mock.calls;
        const lastQuery = prepCalls.length > 0 ? prepCalls[prepCalls.length - 1][0] : "";
        if (typeof lastQuery === "string" && lastQuery.includes("FROM users")) {
          return { id: "user-1", tenant_id: "default-tenant", email: "test@example.com", full_name: "Test User", role: "customer" };
        }
        return { value: encryptedSecret };
      });

      vi.mocked(verifyTurnstileToken).mockResolvedValueOnce(false);

      const res = await customer.request(
        "/tickets",
        {
          method: "POST",
          body: JSON.stringify({ subject: "Help", message: "I need help", turnstileToken: "invalid-token" }),
          headers: { "Content-Type": "application/json", "X-Widget-Key": "test-key", "Authorization": `Bearer ${token}`, "CF-Connecting-IP": `127.0.0.${Math.floor(Math.random() * 255)}` },
        },
        { DB: mockDB as any, JWT_SECRET, APP_MASTER_KEY: masterKey, NOTIFICATION_DO: mockDO as any, BUDGET_ADMISSION_POLICY: 'off' }
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Turnstile validation failed or token missing");
    });

    it("2b. validation fails securely for missing tokens (when configured)", async () => {
      const token = await generateCustomerToken();
      const masterKey = "12345678901234567890123456789012";
      const encryptedSecret = await encryptString("my-turnstile-secret", masterKey);

      mockDB.first.mockImplementation(async () => {
        const prepCalls = vi.mocked(mockDB.prepare).mock.calls;
        const lastQuery = prepCalls.length > 0 ? prepCalls[prepCalls.length - 1][0] : "";
        if (typeof lastQuery === "string" && lastQuery.includes("FROM users")) {
          return { id: "user-1", tenant_id: "default-tenant", email: "test@example.com", full_name: "Test User", role: "customer" };
        }
        return { value: encryptedSecret };
      });

      vi.mocked(verifyTurnstileToken).mockResolvedValueOnce(false);
      const res = await customer.request(
        "/tickets",
        {
          method: "POST",
          body: JSON.stringify({ subject: "Help", message: "I need help" }), // NO turnstileToken
          headers: { "Content-Type": "application/json", "X-Widget-Key": "test-key", "Authorization": `Bearer ${token}`, "CF-Connecting-IP": `127.0.0.${Math.floor(Math.random() * 255)}` },
        },
        { DB: mockDB as any, JWT_SECRET, APP_MASTER_KEY: masterKey, NOTIFICATION_DO: mockDO as any, BUDGET_ADMISSION_POLICY: 'off' }
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Turnstile validation failed or token missing");

    });

    it("3. gracefully handles the case where Turnstile is NOT configured", async () => {
      const token = await generateCustomerToken();
      const masterKey = "12345678901234567890123456789012";

      // DB returns undefined (not configured)
      mockDB.first.mockImplementation(async () => {
        const prepCalls = vi.mocked(mockDB.prepare).mock.calls;
        const lastQuery = prepCalls.length > 0 ? prepCalls[prepCalls.length - 1][0] : "";
        if (typeof lastQuery === "string" && lastQuery.includes("FROM users")) {
          return { id: "user-1", tenant_id: "default-tenant", email: "test@example.com", full_name: "Test User", role: "customer" };
        }
        return undefined;
      });
      vi.mocked(verifyTurnstileToken).mockResolvedValueOnce(true);

      const res = await customer.request(
        "/tickets",
        {
          method: "POST",
          body: JSON.stringify({ subject: "Help", message: "I need help" }), // NO turnstileToken needed
          headers: { "Content-Type": "application/json", "X-Widget-Key": "test-key", "Authorization": `Bearer ${token}`, "CF-Connecting-IP": `127.0.0.${Math.floor(Math.random() * 255)}` },
        },
        { DB: mockDB as any, JWT_SECRET, APP_MASTER_KEY: masterKey, NOTIFICATION_DO: mockDO as any, BUDGET_ADMISSION_POLICY: 'off' }
      );

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.ticket.id).toBe("ticket-1");

    });
  });

  describe("POST /tickets", () => {
    it("should create a new ticket", async () => {
      const token = await generateCustomerToken();

      const res = await customer.request(
        "/tickets",
        {
          method: "POST",
          body: JSON.stringify({ subject: "Help", message: "I need help" }),
          headers: { "Content-Type": "application/json", "X-Widget-Key": "test-key", "Authorization": `Bearer ${token}`, "CF-Connecting-IP": `127.0.0.${Math.floor(Math.random() * 255)}` },
        },
        { DB: mockDB as any, JWT_SECRET, NOTIFICATION_DO: mockDO as any, BUDGET_ADMISSION_POLICY: 'off' }
      );

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.ticket.id).toBe("ticket-1");
      expect(mockPrepareMutation).toHaveBeenCalledWith({
        operation: 'portal.ticket.create', data: { subject: 'Help', body: 'I need help', custom_fields: undefined },
      }, undefined);
      expect(mockCommitMutation).toHaveBeenCalledWith({ replay: null });
    });
  });

  describe("GET /tickets/:id", () => {
    it("should return a ticket and its articles", async () => {
      const token = await generateCustomerToken();

      mockDB.all.mockResolvedValueOnce({ results: [{ id: "article-1" }] }); // articles
      mockDB.all.mockResolvedValueOnce({ results: [{ id: "att-1", article_id: "article-1" }] }); // attachments

      const res = await customer.request(
        "/tickets/ticket-1",
        {
          method: "GET",
          headers: { "Authorization": `Bearer ${token}` },
        },
        { DB: mockDB as any, JWT_SECRET, NOTIFICATION_DO: mockDO as any }
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ticket.id).toBe("ticket-1");
      expect(body.articles).toHaveLength(1);
      expect(body.articles[0].attachments).toHaveLength(1);
    });

    it("should return 404 if ticket not found or doesn't belong to customer", async () => {
      const token = await generateCustomerToken();
      mockFindTicketById.mockResolvedValueOnce({ id: "ticket-1", customer_email: "other@example.com" });

      const res = await customer.request(
        "/tickets/ticket-1",
        {
          method: "GET",
          headers: { "Authorization": `Bearer ${token}` },
        },
        { DB: mockDB as any, JWT_SECRET, NOTIFICATION_DO: mockDO as any }
      );

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe("Not found");
    });
  });

  describe("POST /tickets/:id/messages", () => {
    it("should add a message to an existing ticket", async () => {
      const token = await generateCustomerToken();

      const res = await customer.request(
        "/tickets/ticket-1/messages",
        {
          method: "POST",
          body: JSON.stringify({
            message: "Another reply",
            attachments: [{ filename: "test.png", size: 123, contentType: "image/png", key: "customer-attachments/user-1/s3-key.png" }]
          }),
          headers: { "Content-Type": "application/json", "X-Widget-Key": "test-key", "Authorization": `Bearer ${token}`, "CF-Connecting-IP": `127.0.0.${Math.floor(Math.random() * 255)}` },
        },
        { DB: mockDB as any, JWT_SECRET, NOTIFICATION_DO: mockDO as any, BUDGET_ADMISSION_POLICY: 'off' }
      );

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).toBe("article-1");
      expect(body.attachments).toHaveLength(1);
      expect(mockPrepareMutation).toHaveBeenCalledWith({
        operation: 'portal.ticket.reply', ticketId: 'ticket-1', data: {
          body: 'Another reply', attachments: [{ filename: 'test.png', storageKey: 'customer-attachments/user-1/s3-key.png' }],
        },
      }, undefined);
      expect(mockCommitMutation).toHaveBeenCalledWith({ replay: null }, [{
        filename: 'test.png', storageKey: 'customer-attachments/user-1/s3-key.png', size: 123, contentType: 'image/png',
      }]);
    });

    it("should return 404 if ticket not found", async () => {
      const token = await generateCustomerToken();
      const { TicketMutationError } = await import('../../services/ticket-mutation-replay.service');
      mockPrepareMutation.mockRejectedValueOnce(new TicketMutationError(404, 'not_found', 'Not found'));

      const res = await customer.request(
        "/tickets/ticket-1/messages",
        {
          method: "POST",
          body: JSON.stringify({ message: "Hello" }),
          headers: { "Content-Type": "application/json", "X-Widget-Key": "test-key", "Authorization": `Bearer ${token}`, "CF-Connecting-IP": `127.0.0.${Math.floor(Math.random() * 255)}` },
        },
        { DB: mockDB as any, JWT_SECRET, NOTIFICATION_DO: mockDO as any, BUDGET_ADMISSION_POLICY: 'off' }
      );

      expect(res.status).toBe(404);
    });
  });

  describe("POST /attachments/upload", () => {
    it("should return 400 if file is missing", async () => {
      const token = await generateCustomerToken();

      const res = await customer.request(
        "/attachments/upload",
        {
          method: "POST",
          body: new FormData(), // empty form data
          headers: { "Authorization": `Bearer ${token}` },
        },
        { DB: mockDB as any, JWT_SECRET, NOTIFICATION_DO: mockDO as any }
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("File is required");
    });

    it("should upload file to R2 and return key", async () => {
      const token = await generateCustomerToken();

      const formData = new FormData();
      formData.append("file", new File(["test content"], "test.png", { type: "image/png" }));

      let putCalledWithKey = "";
      const mockR2 = {
        put: async (key: string, data: any, options: any) => {
          putCalledWithKey = key;
        }
      };

      const res = await customer.request(
        "/attachments/upload",
        {
          method: "POST",
          body: formData,
          headers: { "Authorization": `Bearer ${token}` },
        },
        { DB: mockDB as any, JWT_SECRET, NOTIFICATION_DO: mockDO as any, ATTACHMENTS_BUCKET: mockR2 as any }
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.key).toBeDefined();

      expect(body.key).toMatch(/^customer-attachments\/.+\/.+\.png$/);
    });
  });
});
