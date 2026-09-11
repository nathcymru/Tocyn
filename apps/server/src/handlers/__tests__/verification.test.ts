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

const JWT_SECRET = "test-secret-key-at-least-32-chars-long-123456";
let validToken: string;

describe("Ticket Detail Fixes Verification", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockDB.all.mockResolvedValue({ results: [] });
    mockDB.first.mockImplementation(async () => {
      const prepCalls = vi.mocked(mockDB.prepare).mock.calls;
      const lastQuery = prepCalls.length > 0 ? prepCalls[prepCalls.length - 1][0] : "";
      if (typeof lastQuery === "string" && lastQuery.includes("FROM users")) {
        return { tenant_id: "default-tenant", id: "agent-1", role: "agent", password_hash: null, mfa_enabled: 1 };
      }
      return {};
    });
    mockDB.run.mockResolvedValue({ success: true });
    mockDB.batch.mockResolvedValue([{results:[{id:'t-1'}]}]);

    const mockUser = {
      id: "agent-1",
      email: "agent@example.com",
      role: "agent" as const,
      mfa_enabled: true,
      tenant_id: "default-tenant",
    };
    validToken = await authService.generateToken(mockUser as any, JWT_SECRET, true);
  });

  it("should return articles in ASC order", async () => {
    const mockTicket = { id: "t-1", subject: "Ticket 1" };
    mockDB.first.mockImplementation(async () => {
      const prepCalls = vi.mocked(mockDB.prepare).mock.calls;
      const lastQuery = prepCalls.length > 0 ? prepCalls[prepCalls.length - 1][0] : "";
      if (typeof lastQuery === "string" && lastQuery.includes("FROM users")) {
        return { tenant_id: "default-tenant", id: "agent-1", role: "agent", password_hash: null, mfa_enabled: 1 };
      }
      return mockTicket;
    });
    mockDB.all.mockResolvedValueOnce({ results: [] }); // Articles
    mockDB.all.mockResolvedValueOnce({ results: [] }); // Attachments

    await dashboard.request(
      "/tickets/t-1",
      {
        headers: { Authorization: `Bearer ${validToken}` },
      },
      { DB: mockDB as any, JWT_SECRET, NOTIFICATION_DO: mockNotificationsDO as any, ATTACHMENTS_BUCKET: { put: vi.fn(), get: vi.fn(), delete: vi.fn() } }
    );

    // Verify the query uses ORDER BY created_at ASC
    expect(mockDB.prepare).toHaveBeenCalledWith(expect.stringContaining("ORDER BY created_at ASC"));
  });

  it("should allow updating priority, assigned_to, and group_id", async () => {
      // D1 returns one result for each submitted batch statement.
      mockDB.batch.mockImplementation(async (statements: unknown[]) => statements.map((_, index) => ({ results: index >= statements.length - 2 ? [{ id: 't-1' }] : [] })));
    mockDB.run.mockResolvedValue({ success: true });

    const validAgentUuid = "11111111-1111-1111-1111-111111111111";
    const validGroupUuid = "22222222-2222-2222-2222-222222222222";

    const res = await dashboard.request(
      "/tickets/t-1",
      {
        method: "PATCH",
        headers: {
          "Authorization": `Bearer ${validToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          priority: "urgent",
          assigned_to: validAgentUuid,
          group_id: validGroupUuid
        })
      },
      { BUDGET_ADMISSION_POLICY: 'off', DB: mockDB as any, JWT_SECRET, NOTIFICATION_DO: mockNotificationsDO as any, ATTACHMENTS_BUCKET: { put: vi.fn(), get: vi.fn(), delete: vi.fn() } }
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });

    // Verify ticket update query includes all fields
    expect(mockDB.prepare).toHaveBeenCalledWith(expect.stringContaining("UPDATE tickets SET priority=?,assigned_to=?,group_id=?,updated_at=CURRENT_TIMESTAMP"));
    expect(mockDB.bind).toHaveBeenCalledWith("urgent", validAgentUuid, validGroupUuid, "default-tenant", "t-1", "urgent", validAgentUuid, validGroupUuid);
    expect(mockDB.batch).toHaveBeenCalledTimes(1);
    expect(mockDB.prepare).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO conversation_events"));
  });});
