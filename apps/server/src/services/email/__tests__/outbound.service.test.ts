import { describe, it, expect, vi, beforeEach } from "vitest";
import { EmailService } from "../outbound.service";
import { Ticket, Article } from "../../types";
// eslint-disable-next-line no-restricted-imports
import { createVerifiedTenantScope } from "../../../auth/scope";
import { createTenantRequestDeps } from "../../../middleware/tenant.middleware";

const createMockDB = (mockGroupEmail: string | null = null, mockDefaultEmail: string | null = null) => {
  return {
    prepare: vi.fn().mockImplementation((query: string) => {
      const createExec = (boundKey?: string) => ({
        first: vi.fn().mockImplementation(async () => {
          if (query.includes('tenant_config')) {
            if (boundKey === 'RESEND_API_KEY') return { value: 'test-key' };
            if (boundKey === 'RESEND_FROM_EMAIL') return { value: 'support@test.com' };
            if (boundKey === 'TICKET_PREFIX') return { value: '#' };
            return { value: 'test-key' };
          }
          if (query.includes('group_id = ?') && mockGroupEmail) {
            return { email_address: mockGroupEmail };
          }
          if (query.includes('is_default = 1') && mockDefaultEmail) {
            return { email_address: mockDefaultEmail };
          }
          return null;
        }),
        all: vi.fn().mockImplementation(async () => {
          const list: any[] = [];
          if (mockGroupEmail) list.push({ id: 'g1', email_address: mockGroupEmail, is_default: 0, group_id: 'group-1' });
          if (mockDefaultEmail) list.push({ id: 'd1', email_address: mockDefaultEmail, is_default: 1 });
          return { results: list };
        }),
        run: vi.fn().mockResolvedValue({ success: true })
      });

      return {
        bind: vi.fn().mockImplementation((...args: any[]) => createExec(args[1] || args[0])),
        ...createExec()
      };
    })
  };
};

const mockEnv = {
  RESEND_API_KEY: "test-key",
  RESEND_FROM_EMAIL: "support@test.com",
  APP_MASTER_KEY: "master-key-12345678901234567890",
  DB: createMockDB()
};

describe("EmailService Outbound Subject Padding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: "email-id" }),
    });
  });

  it("should format subject with ticket_no without padding (1 -> 1)", async () => {
    const service = new EmailService(mockEnv as any, createTenantRequestDeps(createVerifiedTenantScope("default-tenant", "system", [], 1), mockEnv) as any);
    const ticket: Partial<Ticket> = {
      id: "uuid-1",
      ticket_no: 1,
      subject: "Help Me",
      customer_email: "customer@example.com",
    };
    const article: Partial<Article> = {
      body: "How can we help?",
    };

    await service.sendTicketReply(ticket as Ticket, article as Article);

    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        body: expect.stringContaining("[#1] Help Me")
      })
    );
  });

  it("should format subject with ticket_no without padding (123 -> 123)", async () => {
    const service = new EmailService(mockEnv as any, createTenantRequestDeps(createVerifiedTenantScope("default-tenant", "system", [], 1), mockEnv) as any);
    const ticket: Partial<Ticket> = {
      id: "uuid-123",
      ticket_no: 123,
      subject: "Bug Report",
      customer_email: "customer@example.com",
    };
    const article: Partial<Article> = {
      body: "Fix this please.",
    };

    await service.sendTicketReply(ticket as Ticket, article as Article);

    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        body: expect.stringContaining("[#123] Bug Report")
      })
    );
  });

  it("should fallback to ticket.id if ticket_no is missing", async () => {
    const service = new EmailService(mockEnv as any, createTenantRequestDeps(createVerifiedTenantScope("default-tenant", "system", [], 1), mockEnv) as any);
    const ticket: Partial<Ticket> = {
      id: "uuid-123",
      subject: "Help Me",
      customer_email: "customer@example.com",
    };
    const article: Partial<Article> = {
      body: "How can we help?",
    };

    await service.sendTicketReply(ticket as Ticket, article as Article);

    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        body: expect.stringContaining("[#uuid-123] Help Me")
      })
    );
  });
});

describe("EmailService Outbound Group Email Resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: "email-id" }),
    });
  });

  it("should use group email when ticket has group_id and group email exists", async () => {
    const mockDB = createMockDB("sales@test.com", "default@test.com");
    const envWithDb = { ...mockEnv, DB: mockDB };
    const service = new EmailService(envWithDb as any, createTenantRequestDeps(createVerifiedTenantScope("default-tenant", "system", [], 1), envWithDb) as any);

    const ticket: Partial<Ticket> = {
      id: "uuid-1",
      subject: "Buy",
      customer_email: "customer@example.com",
      group_id: "group-1",
      source_email: "source@test.com"
    };
    const article: Partial<Article> = { body: "Yes." };

    await service.sendTicketReply(ticket as Ticket, article as Article);

    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        body: expect.stringContaining('"from":"sales@test.com"')
      })
    );
  });

  it("should fallback to default email when group_id present but no group email exists", async () => {
    const mockDB = createMockDB(null, "default@test.com");
    const envWithDb = { ...mockEnv, DB: mockDB };
    const service = new EmailService(envWithDb as any, createTenantRequestDeps(createVerifiedTenantScope("default-tenant", "system", [], 1), envWithDb) as any);

    const ticket: Partial<Ticket> = {
      id: "uuid-1",
      subject: "Buy",
      customer_email: "customer@example.com",
      group_id: "group-1",
      source_email: "source@test.com"
    };
    const article: Partial<Article> = { body: "Yes." };

    await service.sendTicketReply(ticket as Ticket, article as Article);

    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        body: expect.stringContaining('"from":"default@test.com"')
      })
    );
  });

  it("should fallback to source_email if no default email exists either", async () => {
    const mockDB = createMockDB(null, null);
    const envWithDb = { ...mockEnv, DB: mockDB };
    const service = new EmailService(envWithDb as any, createTenantRequestDeps(createVerifiedTenantScope("default-tenant", "system", [], 1), envWithDb) as any);

    const ticket: Partial<Ticket> = {
      id: "uuid-1",
      subject: "Buy",
      customer_email: "customer@example.com",
      group_id: "group-1",
      source_email: "source@test.com"
    };
    const article: Partial<Article> = { body: "Yes." };

    await service.sendTicketReply(ticket as Ticket, article as Article);

    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        body: expect.stringContaining('"from":"source@test.com"')
      })
    );
  });

  it("should fallback to RESEND_FROM_EMAIL if source_email is missing and no DB emails", async () => {
    const mockDB = createMockDB(null, null);
    const envWithDb = { ...mockEnv, DB: mockDB };
    const service = new EmailService(envWithDb as any, createTenantRequestDeps(createVerifiedTenantScope("default-tenant", "system", [], 1), envWithDb) as any);

    const ticket: Partial<Ticket> = {
      id: "uuid-1",
      subject: "Buy",
      customer_email: "customer@example.com",
      group_id: "group-1"
    };
    const article: Partial<Article> = { body: "Yes." };

    await service.sendTicketReply(ticket as Ticket, article as Article);

    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        body: expect.stringContaining('"from":"support@test.com"')
      })
    );
  });
});
