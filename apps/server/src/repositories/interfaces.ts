import type { SessionBudgetAuthorityRepository } from './session-budget-authority.repository';
import type { D1PreparedStatement } from '@cloudflare/workers-types';
import type { BudgetAuthorityRepository } from './budget-authority.repository';
import type { ConversationActor } from '../types/conversation-audit';
import { SqlKnowledgeRepository } from './knowledge.repository';
import { User, Ticket, Article, Attachment } from '../types';
import type { CapabilityWriteFence } from '../auth/capability-policy';
import type { OperatorWorkspaceRepository } from './operator-workspace.repository';
import type { OperatorWorkspaceSort } from '../types/operator-workspace';
import type { SupportStateRepository } from './support-state.repository';
import type { SlaClockRepository } from './sla-clock.repository';
import type { TicketListCurrentCredential, TicketListScanSnapshot } from './ticket-list-scan.repository';
import type { CustomerAuthBudgetFence } from './customer-auth-budget-fence';

/**
 * The identity snapshot is captured before admission is spent and rechecked in
 * the same D1 batch that writes the credential.  It intentionally contains no
 * storage-byte estimate: #64 still lacks the bounded stock model for token
 * history.
 */
export type CustomerAuthCredentialIssue = Readonly<{
  email: string;
  fullName: string;
  /** Null means the preflight observed no customer for this tenant/email. */
  expectedUserId: string | null;
  /** Existing user ID, or the ID reserved for an atomically-created shadow user. */
  userId: string;
  tokenId: string;
  tokenHash: string;
  type: 'magic_link' | 'otp';
  expiresAt: string;
  /** OTP only: null means no current challenge was observed. */
  expectedCurrentOtpTokenId: string | null;
  /** The pointed token hash is part of the OTP snapshot, not a byte estimate. */
  expectedCurrentOtpTokenHash: string | null;
}>;

export type CustomerAuthOtpChallengeSnapshot = Readonly<{ tokenId: string; tokenHash: string }>;

export interface UserRepository {
  revokeSessions(id: string, fence?: CustomerAuthBudgetFence): Promise<void>;
  beginMfaEnrollment(id: string, encryptedSecret: string, sessionVersion: number): Promise<boolean>;
  completeMfaEnrollment(id: string, expectedSecret: string, sessionVersion: number): Promise<boolean>;
  list(options: {role?: string; page: number; limit: number; staffOnly?: boolean}): Promise<any[]>;
  findByEmail(email: string): Promise<User | null>;
  get(id: string, fence?: CustomerAuthBudgetFence): Promise<User | null>;
  create(data: Omit<User, 'id' | 'created_at' | 'last_login_at'>, fence?: CustomerAuthBudgetFence): Promise<User>;
  update(id: string, data: Partial<User>, fence?: CustomerAuthBudgetFence): Promise<void>;
  delete(id: string): Promise<void>;
  getCurrentCustomerOtpChallenge(userId: string): Promise<CustomerAuthOtpChallengeSnapshot | null>;
  issueCustomerAuthCredential(input: CustomerAuthCredentialIssue, fence?: CustomerAuthBudgetFence): Promise<void>;
  storeCustomerAuthToken(userId: string, tokenId: string, tokenHash: string, type: string, expiresAt: string, fence?: CustomerAuthBudgetFence): Promise<void>;
  findCustomerAuthTokenUser(tokenHash: string, challengeId?: string): Promise<string | null>;
  verifyAndConsumeCustomerAuthToken(tokenHash: string, now: string, challengeId?: string, fence?: CustomerAuthBudgetFence): Promise<User | null>;
}

export type InitialTicketArticleData = {
  audit?: ConversationActor;
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
  withExternalWrite<T>(id: string, operation: () => Promise<T>, fenceStatements?: () => readonly D1PreparedStatement[]): Promise<T>;

  list(options: {page?: number; limit?: number; filterId?: string; status?: string; priority?: string; assignedTo?: string; groupId?: string; ticketNo?: string; search?: string; customerEmail?: string; sort?: OperatorWorkspaceSort; viewer?: { role: 'admin' | 'agent'; actorId: string }; scanFence?: TicketListScanSnapshot; currentCredential?: TicketListCurrentCredential}): Promise<{data:Ticket[]; total:number; meta:{total:number;page:number;limit:number;total_pages:number}}>;
  dashboardStats(): Promise<any>;
  findBySubject(subject: string): Promise<Ticket | null>;
  get(id: string): Promise<Ticket | null>;
  create(data: Omit<Ticket, 'id' | 'created_at' | 'updated_at' | 'ticket_no'>): Promise<Ticket>;
  createWithInitialArticle(data: InitialTicketArticleData): Promise<{ ticket: Ticket; article: Article }>;
  update(id: string, data: Partial<Ticket>): Promise<void>;
  touch(id: string): Promise<void>;
  delete(id: string): Promise<void>;
  findCustomerTickets(customerEmail: string, page: number, limit: number, scanFence?: TicketListScanSnapshot, currentCredential?: TicketListCurrentCredential): Promise<{ data: Ticket[], total: number }>;
  findTicketsForRetention(cutoffStr: string): Promise<Ticket[]>;
}

export const AI_SUGGESTION_MAX_MESSAGES = 5;
export const AI_SUGGESTION_MAX_INLINE_BODY_BYTES = 8_192;
export const AI_SUGGESTION_MAX_R2_KEY_BYTES = 1_024;

/** Deliberately projected rather than a general article: no full inline body or oversized R2 key crosses D1. */
export type AiSuggestionMessage = Readonly<{
  id: string;
  sender_type: Article['sender_type'];
  body: string | null;
  body_r2_key: string | null;
  body_bytes: number;
  body_r2_key_bytes: number;
}>;

export interface ArticleRepository {
  listByTicket(ticketId: string): Promise<Article[]>;
  /** Five newest rows, newest-first, with inline bytes projected before D1 returns them. */
  listRecentAiSuggestionMessages(ticketId: string): Promise<AiSuggestionMessage[]>;
  updateQAState(id: string, type: string | null, chunkCount: number): Promise<void>;
  updateQAStateStatement(id: string, type: string | null, chunkCount: number): D1PreparedStatement;
  updateQAStateRequiredStatements(id: string, type: string | null, chunkCount: number): readonly D1PreparedStatement[];
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
  findReplySender(groupId?: string | null): Promise<{ email_address: string } | null>;
  createSupportEmail(data: { id: string, email_address: string, name?: string, group_id?: string, is_default: boolean }, fence?: CapabilityWriteFence): Promise<any>;
  deleteSupportEmail(id: string, fence?: CapabilityWriteFence): Promise<void>;
  getSupportEmail(id: string): Promise<any>;
  findByEmail(email_address: string): Promise<any>;
}

export interface ConfigRepository {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, fence?: CapabilityWriteFence): Promise<void>;
}

export interface ApiKeyRepository {
  recordUsage(id: string): Promise<void>;
  list(): Promise<any[]>;
  create(name: string, permissions?: string[], fence?: CapabilityWriteFence): Promise<{ apiKey: string; id: string; name: string; prefix: string; permissions: string[] }>;
  get(id: string): Promise<any | null>;
  delete(id: string, fence?: CapabilityWriteFence): Promise<void>;
}

export interface AutomationRepository {
  list(): Promise<any[]>;
  get(id: string): Promise<any | null>;
  create(data: { name: string; event_type: string; conditions?: string; action_type: string; action_config?: string; is_active: boolean }, fence?: CapabilityWriteFence): Promise<any>;
  update(id: string, data: Record<string, any>, fence?: CapabilityWriteFence): Promise<any | null>;
  delete(id: string, fence?: CapabilityWriteFence): Promise<void>;
  getActiveRules(eventType: string): Promise<any[]>;
}

export interface TicketFieldRepository {
  list(): Promise<any[]>;
  create(data: { name: string; label: string; field_type: string; options?: string | null; is_active: boolean }, fence?: CapabilityWriteFence): Promise<any>;
}

export interface GroupRepository {
  list(): Promise<any[]>;
  get(id: string): Promise<any | null>;
  create(data: { name: string; description?: string | null }, fence?: CapabilityWriteFence): Promise<any>;
  delete(id: string, fence?: CapabilityWriteFence): Promise<void>;
  getMembers(groupId: string): Promise<any[]>;
  isMember(groupId: string, userId: string): Promise<boolean>;
  addMember(groupId: string, userId: string, fence?: CapabilityWriteFence): Promise<void>;
  removeMember(groupId: string, userId: string, fence?: CapabilityWriteFence): Promise<void>;
  hasTickets(groupId: string): Promise<boolean>;
}

export interface FilterRepository {
  list(): Promise<any[]>;
  get(id: string): Promise<any | null>;
  create(data: { name: string; conditions: any }, fence?: CapabilityWriteFence): Promise<any>;
  update(id: string, data: { name: string; conditions: any }, fence?: CapabilityWriteFence): Promise<any | null>;
  delete(id: string, fence?: CapabilityWriteFence): Promise<void>;
}

export interface Repositories {
  budgetAuthority: BudgetAuthorityRepository;
  sessionBudgetAuthority: SessionBudgetAuthorityRepository;
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
  supportStates: SupportStateRepository;
  slaClocks: SlaClockRepository;
  operatorWorkspace: OperatorWorkspaceRepository;
}
