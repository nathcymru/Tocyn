import { encryptString } from '../../../utils/crypto';
let encryptedTestKey = '';
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EmailService } from "../outbound.service";
import { LOCAL_AUTH_CAPTURE_RECIPIENT, LocalAuthCaptureTransport } from '../transport';
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
            if (boundKey === 'RESEND_API_KEY') return { value: encryptedTestKey };
            if (boundKey === 'RESEND_FROM_EMAIL') return { value: 'support@test.com' };
            if (boundKey === 'TICKET_PREFIX') return { value: '#' };
            return { value: encryptedTestKey };
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
  beforeEach(async () => {
    encryptedTestKey = await encryptString("test-key", mockEnv.APP_MASTER_KEY);
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

describe('EmailService isolated recipient allowlist', () => {
  beforeEach(async () => {
    encryptedTestKey = await encryptString('test-key', mockEnv.APP_MASTER_KEY);
    vi.clearAllMocks();
  });

  it('refuses preview mail until the protected recipient allowlist is present', async () => {
    const service = new EmailService({ ...mockEnv, ENVIRONMENT: 'preview' } as any, createTenantRequestDeps(createVerifiedTenantScope('default-tenant', 'system', [], 1), mockEnv) as any);
    await expect(service.send({ to: ['synthetic@example.test'], subject: 'Test', text: 'Test' })).rejects.toThrow('allowlist');
  });

  it('sends preview mail only to an exact allowlisted recipient', async () => {
    const transport = { send: vi.fn().mockResolvedValue({ id: 'test-message' }) };
    const env = { ...mockEnv, ENVIRONMENT: 'preview', OUTBOUND_EMAIL_RECIPIENT_ALLOWLIST: 'recipient@example.test' };
    const service = new EmailService(env as any, createTenantRequestDeps(createVerifiedTenantScope('default-tenant', 'system', [], 1), env) as any, transport as any);
    await expect(service.send({ to: ['other@example.test'], subject: 'Test', text: 'Test' })).rejects.toThrow('not in the isolated allowlist');
    await service.send({ to: ['recipient@example.test'], subject: 'Test', text: 'Test' });
    expect(transport.send).toHaveBeenCalledTimes(1);
  });
});

describe('EmailService local capture enforcement', () => {
  it('refuses a local provider fallback before reading tenant provider configuration', async () => {
    const configGet = vi.fn(async () => { throw new Error('provider configuration must not be read'); });
    const deps = { scope: { tenantId: 'local-tenant' }, repositories: { config: { get: configGet }, channels: { listSupportEmails: async () => [] } } };
    const service = new EmailService({ ENVIRONMENT: 'local' } as any, deps as any);
    await expect(service.send({ to: [LOCAL_AUTH_CAPTURE_RECIPIENT], subject: 'Local', text: 'Local' })).rejects.toThrow('refuses external email transport');
    expect(configGet).not.toHaveBeenCalled();
  });

  it('uses the injected local capture without reading or decrypting Resend configuration', async () => {
    const configGet = vi.fn(async () => { throw new Error('provider configuration must not be read'); });
    const deps = { scope: { tenantId: 'local-tenant' }, repositories: { config: { get: configGet }, channels: { listSupportEmails: async () => [] } } };
    const capture = new LocalAuthCaptureTransport();
    const service = new EmailService({ ENVIRONMENT: 'local' } as any, deps as any, capture);
    await service.send({ to: [LOCAL_AUTH_CAPTURE_RECIPIENT], subject: 'Local', text: 'Local' });
    expect(capture.list()).toHaveLength(1);
    expect(configGet).not.toHaveBeenCalled();
  });
});

describe("EmailService Outbound Group Email Resolution", () => {
  beforeEach(async () => {
    encryptedTestKey = await encryptString("test-key", mockEnv.APP_MASTER_KEY);
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

  it("rejects an unowned source email even when no channels exist", async () => {
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

    await expect(service.sendTicketReply(ticket as Ticket, article as Article)).rejects.toThrow('does not belong');
    expect(global.fetch).not.toHaveBeenCalled();
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
