import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InboundEmailService } from '../inbound.service';
import PostalMime from 'postal-mime';

vi.mock('postal-mime');

describe('InboundEmailService', () => {
  let service: InboundEmailService;
  let mockDeps: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDeps = {
      scope: { tenantId: 'tenant-A' },
      repositories: {
        tickets: {
          findBySubject: vi.fn(),
          get: vi.fn(),
          create: vi.fn(),
          touch: vi.fn()
        },
        articles: {
          findByRawEmailId: vi.fn(),
          create: vi.fn()
        },
        attachments: {
          create: vi.fn()
        },
        users: {
          findByEmail: vi.fn(),
          create: vi.fn()
        }
      },
      attachmentStorage: {
        putAttachment: vi.fn().mockResolvedValue({ key: 'mocked-key' }),
        deleteAttachment: vi.fn().mockResolvedValue(true)
      }
    };
    
    service = new InboundEmailService(mockDeps as any);
  });

  it('should create a new ticket for a new email', async () => {
    const mockEmail = {
      subject: 'New issue',
      from: { address: 'customer@example.com', name: 'Customer' },
      text: 'Help me!',
      messageId: 'msg-123',
    };

    (PostalMime.prototype.parse as any).mockResolvedValue(mockEmail);
    mockDeps.repositories.tickets.findBySubject.mockResolvedValue(null);
    mockDeps.repositories.users.findByEmail.mockResolvedValue(null);
    mockDeps.repositories.users.create.mockResolvedValue({ id: 'user-1', email: 'customer@example.com' });
    mockDeps.repositories.tickets.create.mockResolvedValue({ id: 'ticket-1', subject: 'New issue', customer_id: 'user-1' });
    mockDeps.repositories.articles.create.mockResolvedValue({ id: 'article-1' });

    await service.handle({
      from: 'customer@example.com',
      to: 'support@luminatick.com',
      subject: 'New issue',
      raw: new ReadableStream(),
    } as any);

    expect(mockDeps.repositories.users.create).toHaveBeenCalledWith(expect.objectContaining({
      email: 'customer@example.com',
    }));
    expect(mockDeps.repositories.tickets.create).toHaveBeenCalledWith(expect.objectContaining({
      subject: 'New issue',
      customer_email: 'customer@example.com',
    }));
    expect(mockDeps.repositories.articles.create).toHaveBeenCalledWith(expect.objectContaining({
      ticket_id: 'ticket-1',
      body: 'Help me!',
    }));
  });

  it('should add a reply to an existing ticket found by subject', async () => {
    const mockEmail = {
      subject: 'Re: [#123] New issue',
      from: { address: 'customer@example.com' },
      text: 'Following up.',
      messageId: 'msg-456',
    };

    (PostalMime.prototype.parse as any).mockResolvedValue(mockEmail);
    mockDeps.repositories.tickets.findBySubject.mockResolvedValue({ id: '123', subject: '[#123] New issue', customer_id: 'user-1' });
    mockDeps.repositories.articles.create.mockResolvedValue({ id: 'article-2' });

    await service.handle({
      from: 'customer@example.com',
      to: 'support@luminatick.com',
      subject: 'Re: [#123] New issue',
      raw: new ReadableStream(),
    } as any);

    expect(mockDeps.repositories.tickets.create).not.toHaveBeenCalled();
    expect(mockDeps.repositories.articles.create).toHaveBeenCalledWith(expect.objectContaining({
      ticket_id: '123',
      body: 'Following up.',
    }));
  });

  it('should compensate by deleting R2 attachment if DB insert fails', async () => {
    const mockEmail = {
      subject: 'Help me',
      from: { address: 'customer@test.com' },
      text: 'My issue',
      messageId: 'msg-1',
      attachments: [{
        filename: 'test.png',
        mimeType: 'image/png',
        content: new Uint8Array([1, 2, 3])
      }]
    };

    (PostalMime.prototype.parse as any).mockResolvedValue(mockEmail);
    mockDeps.repositories.tickets.findBySubject.mockResolvedValue(null);
    mockDeps.repositories.users.findByEmail.mockResolvedValue({ id: 'user-1', email: 'customer@test.com' });
    mockDeps.repositories.tickets.create.mockResolvedValue({ id: 'ticket-1', customer_id: 'user-1' });
    mockDeps.repositories.articles.create.mockResolvedValue({ id: 'article-1' });

    mockDeps.repositories.attachments.create.mockRejectedValue(new Error("FK error"));

    await expect(service.handle({
      from: 'customer@test.com',
      to: 'support@test.com',
      subject: 'Help me',
      raw: new ReadableStream()
    })).rejects.toThrow("FK error");

    expect(mockDeps.attachmentStorage.putAttachment).toHaveBeenCalled();
    expect(mockDeps.attachmentStorage.deleteAttachment).toHaveBeenCalled();
  });
});
