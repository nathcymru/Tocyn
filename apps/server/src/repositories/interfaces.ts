import { User, Ticket, Article, Attachment } from '../types';

export interface UserRepository {
  get(id: string): Promise<User | null>;
  create(data: Omit<User, 'id' | 'created_at' | 'last_login_at'>): Promise<User>;
  update(id: string, data: Partial<User>): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface TicketRepository {
  get(id: string): Promise<Ticket | null>;
  create(data: Omit<Ticket, 'id' | 'created_at' | 'updated_at' | 'ticket_no'>): Promise<Ticket>;
  update(id: string, data: Partial<Ticket>): Promise<void>;
  touch(id: string): Promise<void>;
  delete(id: string): Promise<void>;
  findCustomerTickets(customerEmail: string, page: number, limit: number): Promise<{ data: Ticket[], total: number }>;
}

export interface ArticleRepository {
  get(id: string): Promise<Article | null>;
  create(data: Omit<Article, 'id' | 'created_at'>): Promise<Article>;
  update(id: string, data: Partial<Article>): Promise<void>;
  delete(id: string): Promise<void>;
  findByTicket(ticketId: string): Promise<Article[]>;
}

export interface AttachmentRepository {
  get(id: string): Promise<Attachment | null>;
  create(data: Omit<Attachment, 'id' | 'created_at'>): Promise<Attachment>;
  delete(id: string): Promise<void>;
  findByArticle(articleId: string): Promise<Attachment[]>;
  getAttachmentWithMeta(id: string): Promise<any>;
}

export interface Repositories {
  users: UserRepository;
  tickets: TicketRepository;
  articles: ArticleRepository;
  attachments: AttachmentRepository;
}
