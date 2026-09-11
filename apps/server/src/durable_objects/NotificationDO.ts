import { Env } from '../bindings';
import { UserAuthResolver, type UserAuthResolution } from '../auth/user-auth-resolver';
import { createResourceOperationEmitter } from '../observability/resource-operation';
import { authorizeNotificationTicket } from '../repositories/notification-ticket-access.repository';
import { MAX_NOTIFICATION_BROADCAST_ATTEMPTS, MAX_NOTIFICATION_CONNECTIONS } from './notification-limits';
import { MAX_REALTIME_LEASE_RECEIPTS, realtimeAdmissionMode, realtimeReceiptIndexBytes, realtimeReceiptKey, verifyCanonicalBroadcastHandoff, verifyRealtimeLease, validRealtimeLease, type RealtimeLeaseClaim } from '../budgets/realtime-admission.service';
import {
  COLLABORATION_MAX_ACTOR_ID_LENGTH,
  COLLABORATION_MAX_ACTOR_NAME_LENGTH,
  COLLABORATION_MAX_TICKET_ID_LENGTH,
  COLLABORATION_TYPING_EVENT,
  COLLABORATION_TYPING_MIN_EMIT_INTERVAL_MS,
  COLLABORATION_TYPING_PROTOCOL_VERSION,
  COLLABORATION_TYPING_TTL_MS,
  createCollaborationTypingPayload,
} from '@luminatick/shared';

interface SessionAttachment {
  connectionId: string;
  userId: string;
  name: string;
  location: string | null;
  tenantId: string;
  role: string;
  version: number;
  expiresAt: number;
  leaseId?: string;
  leaseExpiresAt?: number;
}

type LeaseRecord = {
  claim: RealtimeLeaseClaim;
  presence: { connectionId: string; userId: string; name: string; location: string | null };
  initialRemaining: number;
  framesRemaining: number;
  typingRemaining: number;
  presenceRemaining: number;
  alarmsRemaining: number;
  cleanupsRemaining: number;
  cleanup: 'active' | 'pending' | 'settled';
  cleanupSource?: 'lease' | 'canonical' | 'prepaid';
};
const LEASE_INDEX_KEY = 'realtime:lease-index:v1';
const LEASE_RECEIPT_INDEX_KEY = 'realtime:lease-receipts:v1';
const leaseKey = (leaseId: string) => `realtime:lease:v1:${leaseId}`;
/** Fixed-order tuples keep 1,024 retained records below the shared 120 KiB state ceiling. */
type LeaseReceipt = readonly [receiptKey: string, expiresAt: number];
type BroadcastReceipt = readonly [receiptKey: string, expiresAt: number, attempts: number];
const BROADCAST_RECEIPTS_KEY = 'realtime:canonical-broadcast-receipts:v1';

/** Revalidate before delivery and every 30s within the supported registry bound; legacy overcapacity denies delivery. */
export class NotificationDO {
  /** Transient only: hibernation and reconnects intentionally discard typing state. */
  private readonly typingUpdates = new Map<WebSocket, Map<string, number>>();

  constructor(public state: DurableObjectState, private env: Env) {}

  private now(): number { return this.env.localNow?.() ?? Date.now(); }
  private admissionMode() { return realtimeAdmissionMode(this.env); }
  private admissionEnabled(): boolean { return this.admissionMode() === 'enabled'; }

  /** This object owns at most the bounded socket registry worth of lease rows. */
  private async leaseIndex(): Promise<string[] | null> {
    const index = await this.state.storage.get<unknown>(LEASE_INDEX_KEY);
    if (index === undefined) return [];
    return Array.isArray(index) && index.length <= MAX_NOTIFICATION_CONNECTIONS && index.every(value => typeof value === 'string' && value.length <= 160) ? index : null;
  }

  /** Retain only the current authority interval: a closed lease may not be replayed into a freed socket slot. */
  private async leaseReceipts(): Promise<LeaseReceipt[] | null> {
    const stored = await this.state.storage.get<unknown>(LEASE_RECEIPT_INDEX_KEY);
    if (stored === undefined) return [];
    if (!Array.isArray(stored) || realtimeReceiptIndexBytes(stored) === null || stored.length > MAX_REALTIME_LEASE_RECEIPTS
      || !stored.every(value => Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && /^[a-f0-9]{64}$/.test(value[0])
        && Number.isSafeInteger(value[1]))) return null;
    return stored.filter(value => value[1] > this.now()) as LeaseReceipt[];
  }

  /** A signed canonical handoff may cross the retry boundary at most three times. */
  private async consumeCanonicalBroadcast(request: Request, body: string): Promise<boolean> {
    if (!this.admissionEnabled()) return true;
    const handoff = await verifyCanonicalBroadcastHandoff(this.env.JWT_SECRET,
      request.headers.get('X-Realtime-Canonical-Handoff'), request.headers.get('X-Realtime-Canonical-Handoff-Signature'), body, this.now());
    if (!handoff || !this.state.id.equals(this.env.NOTIFICATION_DO.idFromName(`tenant:${handoff.grant.tenantId}`))) return false;
    const receiptKey = await realtimeReceiptKey('broadcast', handoff.grant.handoffId, handoff.payloadDigest);
    if (!receiptKey) return false;
    return this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get<unknown>(BROADCAST_RECEIPTS_KEY);
      if (stored !== undefined && (!Array.isArray(stored) || realtimeReceiptIndexBytes(stored) === null || stored.length > MAX_REALTIME_LEASE_RECEIPTS
        || !stored.every(value => Array.isArray(value) && value.length === 3 && typeof value[0] === 'string' && /^[a-f0-9]{64}$/.test(value[0])
          && Number.isSafeInteger(value[1]) && Number.isSafeInteger(value[2]) && value[2] >= 1 && value[2] <= MAX_NOTIFICATION_BROADCAST_ATTEMPTS))) return false;
      const receipts = ((stored ?? []) as BroadcastReceipt[]).filter(receipt => receipt[1] > this.now());
      const existing = receipts.find(receipt => receipt[0] === receiptKey);
      if (existing && existing[2] >= MAX_NOTIFICATION_BROADCAST_ATTEMPTS) return false;
      if (!existing && receipts.length >= MAX_REALTIME_LEASE_RECEIPTS) return false;
      const next = existing
        ? receipts.map(receipt => receipt === existing ? [receipt[0], receipt[1], receipt[2] + 1] as BroadcastReceipt : receipt)
        : [...receipts, [receiptKey, handoff.grant.expiresAt, 1] as BroadcastReceipt];
      if (realtimeReceiptIndexBytes(next) === null) return false;
      // The explicit DO input gate and durable write precede recipient side effects.
      await this.state.storage.put(BROADCAST_RECEIPTS_KEY, next);
      return true;
    });
  }


  private recordMatches(record: LeaseRecord | undefined, session: SessionAttachment | null, current = true): record is LeaseRecord {
    const claim = record?.claim;
    return !!record && !!session && !!claim && validRealtimeLease(claim, this.now(), current)
      && claim.leaseId === session.leaseId && claim.tenantId === session.tenantId && claim.actorId === session.userId
      && claim.role === session.role && claim.sessionVersion === session.version && record.initialRemaining >= 0
      && record.framesRemaining >= 0 && record.typingRemaining >= 0 && record.presenceRemaining >= 0
      && record.alarmsRemaining >= 0 && record.cleanupsRemaining >= 0;
  }

  private async loadLease(session: SessionAttachment | null, current = true): Promise<LeaseRecord | null> {
    if (!this.admissionEnabled()) return null;
    if (!session?.leaseId) return null;
    const record = await this.state.storage.get<LeaseRecord>(leaseKey(session.leaseId));
    return this.recordMatches(record, session, current) ? record : null;
  }

  /** Persist the debit before authorization/fanout. A restart can only retain the debit. */
  private async debit(session: SessionAttachment | null, kind: 'initial' | 'frame' | 'typing' | 'presence' | 'alarm'): Promise<boolean> {
    if (!this.admissionEnabled()) return true;
    const record = await this.loadLease(session);
    if (!record || record.cleanup !== 'active' || !session?.leaseId) return false;
    const property = kind === 'initial' ? 'initialRemaining' : kind === 'frame' ? 'framesRemaining'
      : kind === 'typing' ? 'typingRemaining' : kind === 'presence' ? 'presenceRemaining' : 'alarmsRemaining';
    if (record[property] < 1) return false;
    record[property]--;
    await this.state.storage.put(leaseKey(session.leaseId), record);
    return true;
  }

  private async installLease(session: SessionAttachment, request: Request): Promise<boolean> {
    if (!this.admissionEnabled()) return true;
    const claim = await verifyRealtimeLease(this.env.JWT_SECRET, request.headers.get('X-Realtime-Lease'), request.headers.get('X-Realtime-Lease-Signature'), this.now());
    if (!claim || claim.tenantId !== session.tenantId || claim.actorId !== session.userId || claim.role !== session.role
      || claim.sessionVersion !== session.version || claim.expiresAt > session.expiresAt * 1_000) return false;
    const receiptKey = await realtimeReceiptKey('lease', claim.leaseId);
    if (!receiptKey) return false;
    return this.state.blockConcurrencyWhile(async () => {
      const index = await this.leaseIndex();
      const receipts = await this.leaseReceipts();
      if (!index || !receipts || index.includes(claim.leaseId) || receipts.some(receipt => receipt[0] === receiptKey)
        || index.length >= MAX_NOTIFICATION_CONNECTIONS || receipts.length >= MAX_REALTIME_LEASE_RECEIPTS) return false;
      session.leaseId = claim.leaseId;
      session.leaseExpiresAt = claim.expiresAt;
      const record: LeaseRecord = { claim, presence: this.presence(session), initialRemaining: 1, framesRemaining: claim.frames,
        typingRemaining: claim.typingEvents, presenceRemaining: claim.presenceEvents, alarmsRemaining: claim.alarms,
        cleanupsRemaining: claim.cleanups, cleanup: 'active' };
      const nextReceipts = [...receipts, [receiptKey, claim.expiresAt] as LeaseReceipt];
      if (realtimeReceiptIndexBytes(nextReceipts) === null) return false;
      // The input gate and paired write precede acceptWebSocket. A replayed
      // forwarded claim cannot install a second row after an async boundary.
      await this.state.storage.put({ [leaseKey(claim.leaseId)]: record, [LEASE_INDEX_KEY]: [...index, claim.leaseId],
        [LEASE_RECEIPT_INDEX_KEY]: nextReceipts });
      return true;
    });
  }

  private async removeLease(leaseId: string): Promise<void> {
    const index = await this.leaseIndex();
    if (!index) return;
    await this.state.storage.transaction(async transaction => {
      await transaction.delete(leaseKey(leaseId));
      await transaction.put(LEASE_INDEX_KEY, index.filter(value => value !== leaseId));
    });
  }

  private async updateLeasePresence(session: SessionAttachment): Promise<boolean> {
    if (!this.admissionEnabled()) return true;
    const record = await this.loadLease(session);
    if (!record || !session.leaseId) return false;
    record.presence = this.presence(session);
    await this.state.storage.put(leaseKey(session.leaseId), record);
    return true;
  }

  /** Marking cleanup before close carries canonical-vs-lease ownership through a hibernating callback. */
  private async markCleanup(session: SessionAttachment | null, source: 'lease' | 'canonical' | 'prepaid'): Promise<void> {
    if (!this.admissionEnabled() || !session?.leaseId) return;
    const record = await this.loadLease(session, false);
    if (!record || record.cleanup !== 'active') return;
    record.cleanupSource = source;
    await this.state.storage.put(leaseKey(session.leaseId), record);
  }

  private async closeInvalid(ws: WebSocket, source: 'lease' | 'canonical' | 'prepaid', code = 1008, reason = 'Session no longer authorized'): Promise<void> {
    await this.markCleanup(ws.deserializeAttachment() as SessionAttachment | null, source);
    try { ws.close(code, reason); } catch { /* Already closed. */ }
  }

  /** A close is charged once. A delivery failure remains pending for one bounded alarm recovery attempt. */
  private async beginCleanup(session: SessionAttachment | null): Promise<{ record: LeaseRecord; source: 'lease' | 'canonical' | 'prepaid' } | null> {
    if (!this.admissionEnabled()) return { record: undefined as never, source: 'lease' };
    if (!session?.leaseId) return null;
    const record = await this.loadLease(session, false);
    if (!record || record.cleanup !== 'active') return null;
    const source = record.cleanupSource ?? 'lease';
    if (source === 'lease') {
      if (record.cleanupsRemaining < 1) return null;
      record.cleanupsRemaining--;
    }
    record.cleanup = 'pending';
    await this.state.storage.put(leaseKey(session.leaseId), record);
    return { record, source };
  }

  private async settleCleanup(session: SessionAttachment | null): Promise<void> {
    if (!this.admissionEnabled() || !session?.leaseId) return;
    const record = await this.loadLease(session, false);
    if (!record || record.cleanup !== 'pending') return;
    record.cleanup = 'settled';
    await this.state.storage.put(leaseKey(session.leaseId), record);
    await this.removeLease(session.leaseId);
  }

  private async recoverPendingCleanup(): Promise<void> {
    if (!this.admissionEnabled()) return;
    const index = await this.leaseIndex();
    if (!index) return;
    for (const leaseId of index) {
      const record = await this.state.storage.get<LeaseRecord>(leaseKey(leaseId));
      if (!record || record.cleanup !== 'pending' || !validRealtimeLease(record.claim, this.now(), false)) continue;
      const message = { type: 'presence.update', payload: { ...record.presence, status: 'offline' } };
      if (await this.fanout(message, undefined, false, 'lease')) await this.settleCleanup({ connectionId: '', userId: record.claim.actorId,
        name: '', location: null, tenantId: record.claim.tenantId, role: record.claim.role, version: record.claim.sessionVersion,
        expiresAt: Math.floor(record.claim.expiresAt / 1_000), leaseId });
    }
  }

  private belongsToThisObject(session: SessionAttachment | null): session is SessionAttachment {
    return !!session && !!session.tenantId &&
      this.state.id.equals(this.env.NOTIFICATION_DO.idFromName(`tenant:${session.tenantId}`));
  }

  private async currentStaff(session: SessionAttachment | null): Promise<UserAuthResolution | null> {
    try {
      if (this.belongsToThisObject(session) && Number.isSafeInteger(session.expiresAt) && session.expiresAt * 1000 > Date.now() &&
          Number.isSafeInteger(session.version) && session.version >= 0 && ['agent', 'admin'].includes(session.role)) {
        // Each revalidation is an independently capped #159 diagnostic composition.
        const user = await UserAuthResolver.fromEnvironment(this.env, createResourceOperationEmitter(this.env))
          .resolveUserById(session.tenantId, session.userId);
        if (user && user.tenantId === session.tenantId && user.userId === session.userId &&
          user.role === session.role && user.sessionVersion === session.version && session.expiresAt * 1000 > Date.now()
          && (!this.admissionEnabled() || user.mfaEnabled)) return user;
      }
    } catch { /* Database failures deny delivery, including after hibernation. */ }
    return null;
  }

  private async authorized(session: SessionAttachment | null): Promise<boolean> {
    return !!await this.currentStaff(session);
  }

  private async activeStaff(ws: WebSocket, closeInvalid = true, source: 'lease' | 'canonical' | 'prepaid' = 'lease'): Promise<UserAuthResolution | null> {
    if (ws.readyState !== WebSocket.OPEN) return null;
    const session = ws.deserializeAttachment() as SessionAttachment | null;
    // A lease never outlives the authority snapshot that issued it. The route
    // reloads both policy and restriction before a successor can be installed.
    if (this.admissionEnabled() && !await this.loadLease(session)) {
      if (closeInvalid) await this.closeInvalid(ws, source);
      return null;
    }
    const user = await this.currentStaff(session);
    if (user) return user;
    if (closeInvalid) {
      await this.closeInvalid(ws, source);
    }
    return null;
  }

  private async active(ws: WebSocket, closeInvalid = true, source: 'lease' | 'canonical' | 'prepaid' = 'lease'): Promise<boolean> {
    return !!await this.activeStaff(ws, closeInvalid, source);
  }

  /** Never truncate recipients. Legacy overcapacity needs connections to drain before service resumes. */
  private boundedSockets(): WebSocket[] | null {
    const sockets = this.state.getWebSockets();
    return sockets.length <= MAX_NOTIFICATION_CONNECTIONS ? sockets : null;
  }

  private capacityDenied(): Response {
    return new Response('Realtime capacity temporarily unavailable', { status: 503, headers: { 'Retry-After': '30' } });
  }

  private presence(session: SessionAttachment) {
    return { connectionId: session.connectionId, userId: session.userId, name: session.name, location: session.location };
  }

  /** Current tenant, staff session, ticket and group membership are all required for this advisory signal. */
  private async authorizedForTicket(session: SessionAttachment | null, user: UserAuthResolution, ticketId: string): Promise<boolean> {
    if (!this.belongsToThisObject(session) || !this.validTicketId(ticketId)) return false;
    try {
      return await authorizeNotificationTicket(this.env, session.tenantId, user, ticketId);
    } catch { /* A failed current authorization check must never disclose a typing event. */ }
    return false;
  }

  private validTicketId(ticketId: unknown): ticketId is string {
    return typeof ticketId === 'string' && ticketId.length > 0 && ticketId.length <= COLLABORATION_MAX_TICKET_ID_LENGTH
      && !/[\u0000-\u001f\u007f]/.test(ticketId);
  }

  /** Ticket-bearing canonical events must retain a usable current-ticket
   * reference. Presence and other advisory messages deliberately have none. */
  private canonicalTicketId(message: unknown): string | null | undefined {
    if (!message || typeof message !== 'object' || Array.isArray(message)) return undefined;
    const event = message as { type?: unknown; payload?: unknown };
    if (event.type !== 'ticket.created' && event.type !== 'ticket.updated' && event.type !== 'article.created') return undefined;
    if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) return null;
    const payload = event.payload as Record<string, unknown>;
    const ticketId = event.type === 'article.created' ? payload.ticket_id : payload.id;
    return this.validTicketId(ticketId) ? ticketId : null;
  }

  /** A small, transient per-socket map preserves ticket-specific throttling without retaining unbounded client keys. */
  private typingAllowed(ws: WebSocket, ticketId: string, now: number): boolean {
    const updates = this.typingUpdates.get(ws) ?? new Map<string, number>();
    this.typingUpdates.set(ws, updates);
    for (const [key, timestamp] of updates) if (now - timestamp >= COLLABORATION_TYPING_TTL_MS) updates.delete(key);
    const previous = updates.get(ticketId);
    if (previous !== undefined && now - previous < COLLABORATION_TYPING_MIN_EMIT_INTERVAL_MS) return false;
    // Do not evict a live key: rotating ticket ids could otherwise bypass its one-second throttle.
    // New keys wait for the short transient window to expire once this bounded map is full.
    if (!updates.has(ticketId) && updates.size >= 16) return false;
    updates.set(ticketId, now);
    return true;
  }

  private async fanoutTyping(sender: WebSocket, ticketId: string, message: unknown): Promise<boolean> {
    const sockets = this.boundedSockets();
    if (!sockets) return false;
    const results = await Promise.all(sockets.filter(ws => ws !== sender).map(async ws => {
      const recipient = await this.activeStaff(ws, true, 'prepaid');
      if (!recipient) return true;
      if (!await this.authorizedForTicket(ws.deserializeAttachment() as SessionAttachment | null, recipient, ticketId)) return true;
      try { ws.send(JSON.stringify(message)); return true; }
      catch { return false; }
    }));
    return results.every(Boolean);
  }

  private async scheduleAlarm() {
    // Do not walk or repeatedly alarm an unbounded registry inherited from an older version.
    const sockets = this.boundedSockets();
    const expiries = (sockets ?? []).filter(ws => ws.readyState === WebSocket.OPEN).map(ws => {
      const session = ws.deserializeAttachment() as SessionAttachment | null;
      const sessionExpiry = session?.expiresAt ? session.expiresAt * 1_000 : undefined;
      return this.admissionEnabled() ? Math.min(sessionExpiry ?? Number.MAX_SAFE_INTEGER, session?.leaseExpiresAt ?? Number.MAX_SAFE_INTEGER) : sessionExpiry;
    }).filter((expiry): expiry is number => typeof expiry === 'number' && expiry > this.now());
    const index = this.admissionEnabled() ? await this.leaseIndex() : [];
    const pending = !!index && (await Promise.all(index.map(async leaseId =>
      (await this.state.storage.get<LeaseRecord>(leaseKey(leaseId)))?.cleanup === 'pending'))).some(Boolean);
    if (expiries.length || pending) await this.state.storage.setAlarm(Math.min(this.now() + 30_000, ...expiries));
    else await this.state.storage.deleteAlarm();
  }

  async alarm() {
    try {
      await Promise.all((this.boundedSockets() ?? []).map(async ws => {
        const session = ws.deserializeAttachment() as SessionAttachment | null;
        if (!await this.debit(session, 'alarm')) { await this.closeInvalid(ws, 'lease', 1013, 'Realtime lease expired'); return; }
        await this.active(ws, true, 'lease');
      }));
      await this.recoverPendingCleanup();
    }
    finally { await this.scheduleAlarm(); }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/broadcast') {
      if (this.admissionMode() === 'invalid') return this.capacityDenied();
      if (!this.boundedSockets()) return this.capacityDenied();
      let body: string;
      let message: unknown;
      try { body = await request.text(); message = JSON.parse(body); } catch { return new Response('Invalid broadcast', { status: 400 }); }
      if (this.canonicalTicketId(message) === null) return new Response('Invalid broadcast', { status: 400 });
      if (!await this.consumeCanonicalBroadcast(request, body)) return new Response('Broadcast authority unavailable', { status: 503 });
      return await this.broadcast(message, undefined, 'canonical') ? new Response('OK') : this.capacityDenied();
    }
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected Upgrade: websocket', { status: 426 });
    const session: SessionAttachment = {
      connectionId: crypto.randomUUID(), userId: request.headers.get('X-User-ID') || '',
      name: request.headers.get('X-User-Name') || '', location: null,
      tenantId: request.headers.get('X-Tenant-ID') || '', role: request.headers.get('X-Session-Role') || '',
      version: Number(request.headers.get('X-Session-Version') ?? NaN),
      expiresAt: Number(request.headers.get('X-Session-Expiry') ?? NaN),
    };
    // Authenticate before accept. The final registry check and acceptance must remain synchronous:
    // concurrent requests can all have passed their asynchronous authority checks.
    if (this.admissionMode() === 'invalid' || !await this.authorized(session) || !await this.installLease(session, request)) return new Response('Unauthorized', { status: 401 });
    if (this.state.getWebSockets().length >= MAX_NOTIFICATION_CONNECTIONS) return this.capacityDenied();
    const { 0: client, 1: server } = new WebSocketPair();
    this.state.acceptWebSocket(server);
    server.serializeAttachment(session);
    if (!await this.debit(session, 'initial')) {
      await this.closeInvalid(server, 'lease', 1013, 'Realtime lease exhausted');
      return new Response(null, { status: 101, webSocket: client });
    }
    await this.scheduleAlarm();
    const sessions = [];
    for (const ws of this.boundedSockets() ?? []) {
      if (await this.active(ws, true, 'prepaid')) sessions.push(this.presence(ws.deserializeAttachment() as SessionAttachment));
    }
    const synced = await this.send(server, { type: 'presence.sync', payload: sessions }, 'prepaid');
    const announced = await this.broadcast({ type: 'presence.update', payload: { ...this.presence(session), status: 'online' } }, server, 'prepaid');
    if (!synced || !announced) server.close(1013, 'Realtime initialization failed');
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (!this.boundedSockets()) { ws.close(1013, 'Realtime capacity temporarily unavailable'); return; }
    if (typeof message !== 'string' || message.length > 4096) { ws.close(1009, 'Message too large'); return; }
    const session = ws.deserializeAttachment() as SessionAttachment | null;
    // Malformed and unknown frames consume the same warm slot as a valid
    // callback; otherwise a client could force unbounded parse work for free.
    if (!await this.debit(session, 'frame')) { await this.closeInvalid(ws, 'lease', 1013, 'Realtime lease exhausted'); return; }
    try {
      const data = JSON.parse(message);
      const staff = await this.activeStaff(ws, true, 'prepaid');
      if (!staff) return;
      if (data.type === COLLABORATION_TYPING_EVENT) {
        const payload = createCollaborationTypingPayload(data.payload?.ticketId, data.payload?.baseConversationRevision, data.payload?.active);
        if (!payload || data.payload?.version !== COLLABORATION_TYPING_PROTOCOL_VERSION) return;
        if (!await this.debit(session, 'typing')) { await this.closeInvalid(ws, 'lease', 1013, 'Realtime typing lease exhausted'); return; }
        const now = Date.now();
        if (!this.typingAllowed(ws, payload.ticketId, now)) return;
        if (!await this.authorizedForTicket(session, staff, payload.ticketId)) return;
        const actorId = staff.userId.slice(0, COLLABORATION_MAX_ACTOR_ID_LENGTH);
        const actorName = (staff.fullName?.trim() || 'Staff member').slice(0, COLLABORATION_MAX_ACTOR_NAME_LENGTH);
        const event = { type: COLLABORATION_TYPING_EVENT, payload: {
          version: COLLABORATION_TYPING_PROTOCOL_VERSION, ticketId: payload.ticketId,
          actor: { id: actorId, name: actorName }, active: payload.active, expiresAt: now + COLLABORATION_TYPING_TTL_MS,
        } };
        if (!await this.fanoutTyping(ws, payload.ticketId, event)) ws.close(1013, 'Realtime delivery failed');
        return;
      }
      if (data.type !== 'presence.update') return;
      if (!await this.debit(session, 'presence')) { await this.closeInvalid(ws, 'lease', 1013, 'Realtime presence lease exhausted'); return; }
      const presenceSession = ws.deserializeAttachment() as SessionAttachment;
      presenceSession.location = typeof data.payload?.location === 'string' ? data.payload.location.slice(0, 100) : null;
      ws.serializeAttachment(presenceSession);
      if (!await this.updateLeasePresence(presenceSession)) { await this.closeInvalid(ws, 'lease', 1013, 'Realtime lease expired'); return; }
      if (!await this.broadcast({ type: 'presence.update', payload: { ...this.presence(presenceSession), status: 'online' } }, undefined, 'prepaid')) {
        ws.close(1013, 'Realtime delivery failed');
      }
    } catch { console.error('Invalid realtime message'); }
  }

  async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean) {
    this.typingUpdates.delete(ws);
    // Complete the close handshake on compatibility dates before automatic close replies.
    try { ws.close(1000, 'Connection closed'); } catch { /* Already closed. */ }
    const session = ws.deserializeAttachment() as SessionAttachment | null;
    const cleanup = await this.beginCleanup(session);
    if (this.belongsToThisObject(session) && cleanup && !await this.fanout({ type: 'presence.update', payload: { ...this.presence(session), status: 'offline' } }, ws, false, 'lease')) {
      console.error('Realtime cleanup delivery failed');
    }
    else if (cleanup) await this.settleCleanup(session);
    await this.scheduleAlarm();
  }

  async webSocketError(ws: WebSocket, _error: unknown) {
    try { ws.close(1011, 'Connection error'); } catch { /* Already closed. */ }
    await this.webSocketClose(ws, 1011, '', false);
  }

  /** A failed send is explicit; no accepted recipient is silently sliced out of a successful fanout. */
  async broadcast(message: unknown, excludeWs?: WebSocket, source: 'lease' | 'canonical' | 'prepaid' = 'canonical'): Promise<boolean> {
    return this.fanout(message, excludeWs, true, source);
  }

  private async fanout(message: unknown, excludeWs: WebSocket | undefined, closeInvalid: boolean, source: 'lease' | 'canonical' | 'prepaid'): Promise<boolean> {
    const sockets = this.boundedSockets();
    if (!sockets) return false;
    const results = await Promise.all(sockets.filter(ws => ws !== excludeWs).map(ws =>
      closeInvalid ? this.send(ws, message, source) : this.deliver(ws, message, false, source)));
    return results.every(Boolean);
  }

  async send(ws: WebSocket, message: unknown, source: 'lease' | 'canonical' | 'prepaid' = 'canonical'): Promise<boolean> {
    return this.deliver(ws, message, true, source);
  }

  private async deliver(ws: WebSocket, message: unknown, closeInvalid: boolean, source: 'lease' | 'canonical' | 'prepaid'): Promise<boolean> {
    // Cleanup must revalidate, but cannot initiate more closes and recursive offline fanouts.
    // A later ordinary event/alarm still closes invalid sessions. This mode is never client-controlled.
    const recipient = await this.activeStaff(ws, closeInvalid, source);
    if (!recipient) return true; // Closed or currently unauthorized recipients cannot receive data.
    if (ws.readyState !== WebSocket.OPEN) return true;
    const ticketId = this.canonicalTicketId(message);
    // A malformed ticket-bearing event has no safe recipient set. This also
    // protects direct internal calls that do not cross the HTTP parser.
    if (ticketId === null) return false;
    if (ticketId !== undefined && !await this.authorizedForTicket(ws.deserializeAttachment() as SessionAttachment | null, recipient, ticketId)) return true;
    try { ws.send(JSON.stringify(message)); return true; }
    catch { return false; } // Caller observes bounded failure; successful recipients may already have received it.
  }
}
