import { SqlKnowledgeRepository } from './knowledge.repository';
import { User, Ticket, Article, Attachment } from '../types';

export interface UserRepository {
  revokeSessions(id: string): Promise<void>;
  list(options: {role?: string; page: number; limit: number; staffOnly?: boolean}): Promise<any[]>;
  findByEmail(email: string): Promise<User | null>;
  get(id: string): Promise<User | null>;
  create(data: Omit<User, 'id' | 'created_at' | 'last_login_at'>): Promise<User>;
  update(id: string, data: Partial<User>): Promise<void>;
  delete(id: string): Promise<void>;
  storeCustomerAuthToken(userId: string, tokenId: string, tokenHash: string, type: string, expiresAt: string): Promise<void>;
  verifyAndConsumeCustomerAuthToken(tokenHash: string, now: string, challengeId?: string): Promise<User | null>;
}

export type InitialTicketArticleData = {
  ticket: Omit<Ticket, 'id' | 'created_at' | 'updated_at' | 'ticket_no' | 'tenant_id'> & {
    intake_received_at: string;
    intake_processed_at: string;
  };
  article: Omit<Article, 'id' | 'created_at' | 'ticket_id' | 'tenant_id'> & {
    intake_source: Ticket['source'];
    received_at: string;
    processed_at: string;
  };
};

export interface TicketRepository {
  claimRetention(id: string, cutoff: string): Promise<{ token: string } | null>;
  releaseClaim(id: string, token: string): Promise<void>;
  completeRetention(id: string, token: string): Promise<boolean>;
  withExternalWrite<T>(id: string, operation: () => Promise<T>): Promise<T>;

  list(options: {page?: number; limit?: number; filterId?: string; status?: string; priority?: string; assignedTo?: string; groupId?: string; ticketNo?: string; search?: string; customerEmail?: string}): Promise<{data:Ticket[]; total:number; meta:{total:number;page:number;limit:number;total_pages:number}}>;
  dashboardStats(): Promise<any>;
  findBySubject(subject: string): Promise<Ticket | null>;
  get(id: string): Promise<Ticket | null>;
  create(data: Omit<Ticket, 'id' | 'created_at' | 'updated_at' | 'ticket_no'>): Promise<Ticket>;
  createWithInitialArticle(data: InitialTicketArticleData): Promise<{ ticket: Ticket; article: Article }>;
  update(id: string, data: Partial<Ticket>): Promise<void>;
  touch(id: string): Promise<void>;
  delete(id: string): Promise<void>;
  findCustomerTickets(customerEmail: string, page: number, limit: number): Promise<{ data: Ticket[], total: number }>;
  findTicketsForRetention(cutoffStr: string): Promise<Ticket[]>;
}

export interface ArticleRepository {
  listByTicket(ticketId: string): Promise<Article[]>;
  updateQAState(id: string, type: string | null, chunkCount: number): Promise<void>;
  findByRawEmailId(rawEmailId: string): Promise<Article | null>;
  getRecentCustomerArticleCount(customerId: string, since: string): Promise<number>;
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


export interface ChannelsRepository {
  listSupportEmails(): Promise<any[]>;
  createSupportEmail(data: { id: string, email_address: string, name?: string, group_id?: string, is_default: boolean }): Promise<any>;
  deleteSupportEmail(id: string): Promise<void>;
  getSupportEmail(id: string): Promise<any>;
  findByEmail(email_address: string): Promise<any>;
}

export interface ConfigRepository {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export interface ApiKeyRepository {
  recordUsage(id: string): Promise<void>;
  list(): Promise<any[]>;
  create(name: string, permissions?: string[]): Promise<{ apiKey: string; id: string; name: string; prefix: string; permissions: string[] }>;
  get(id: string): Promise<any | null>;
  delete(id: string): Promise<void>;
}

export interface AutomationRepository {
  list(): Promise<any[]>;
  get(id: string): Promise<any | null>;
  create(data: { name: string; event_type: string; conditions?: string; action_type: string; action_config?: string; is_active: boolean }): Promise<any>;
  update(id: string, data: Record<string, any>): Promise<any | null>;
  delete(id: string): Promise<void>;
  getActiveRules(eventType: string): Promise<any[]>;
}

export interface TicketFieldRepository {
  list(): Promise<any[]>;
  create(data: { name: string; label: string; field_type: string; options?: string | null; is_active: boolean }): Promise<any>;
}

export interface GroupRepository {
  list(): Promise<any[]>;
  get(id: string): Promise<any | null>;
  create(data: { name: string; description?: string | null }): Promise<any>;
  delete(id: string): Promise<void>;
  getMembers(groupId: string): Promise<any[]>;
  isMember(groupId: string, userId: string): Promise<boolean>;
  addMember(groupId: string, userId: string): Promise<void>;
  removeMember(groupId: string, userId: string): Promise<void>;
  hasTickets(groupId: string): Promise<boolean>;
}

export interface FilterRepository {
  list(): Promise<any[]>;
  get(id: string): Promise<any | null>;
  create(data: { name: string; conditions: any }): Promise<any>;
  update(id: string, data: { name: string; conditions: any }): Promise<any | null>;
  delete(id: string): Promise<void>;
}

export interface Repositories {
  requestLimits: { consume(bucket: string, limit: number, windowMs: number, now?: number): Promise<boolean> };
  knowledge: SqlKnowledgeRepository;
  users: UserRepository;
  tickets: TicketRepository;
  articles: ArticleRepository;
  attachments: AttachmentRepository;
  channels: ChannelsRepository;
  config: ConfigRepository;
  apiKeys: ApiKeyRepository;
  automations: AutomationRepository;
  ticketFields: TicketFieldRepository;
  groups: GroupRepository;
  ticketFilters: FilterRepository;
}
