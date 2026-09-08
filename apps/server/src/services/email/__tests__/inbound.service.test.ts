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
    mockDeps.repositories.tickets.findBySubject.mockResolvedValue({ id: '123', subject: '[#123] New issue', customer_id: 'user-1', customer_email: 'customer@example.com' });
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

  it.each(['subject', 'inReplyTo', 'references'])('rejects an unrelated sender using %s without writes', async (route) => {
    const ticket = { id: 'private-ticket', customer_id: 'owner', customer_email: 'owner@example.com' };
    (PostalMime.prototype.parse as any).mockResolvedValue({
      subject: 'Thread', from: { address: 'other@example.com' }, text: 'Untrusted reply',
      inReplyTo: route === 'inReplyTo' ? 'message-id' : undefined,
      references: route === 'references' ? 'message-id' : undefined,
    });
    mockDeps.repositories.tickets.findBySubject.mockResolvedValue(route === 'subject' ? ticket : null);
    mockDeps.repositories.articles.findByRawEmailId.mockResolvedValue({ ticket_id: ticket.id });
    mockDeps.repositories.tickets.get.mockResolvedValue(ticket);
    await expect(service.handle({ from: 'other@example.com', to: 'support@example.com', subject: 'Thread', raw: new ReadableStream() })).rejects.toThrow('participant');
    expect(mockDeps.repositories.articles.create).not.toHaveBeenCalled();
    expect(mockDeps.repositories.tickets.touch).not.toHaveBeenCalled();
    expect(mockDeps.repositories.users.create).not.toHaveBeenCalled();
    expect(mockDeps.attachmentStorage.putAttachment).not.toHaveBeenCalled();
  });

  it('rejects a forged MIME sender before creating a customer', async () => {
    (PostalMime.prototype.parse as any).mockResolvedValue({ from: { address: 'victim@example.com' }, text: 'Text' });
    await expect(service.handle({ from: 'other@example.com', to: 'support@example.com', subject: 'Thread', raw: new ReadableStream() })).rejects.toThrow('sender mismatch');
    expect(mockDeps.repositories.users.create).not.toHaveBeenCalled();
    expect(mockDeps.repositories.articles.create).not.toHaveBeenCalled();
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
