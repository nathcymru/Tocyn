/** Bounded durable work projection kinds approved for #133. */
export const OPERATOR_ACTIVITY_KINDS = [
  'assignment', 'mention', 'customer_reply', 'sla_risk', 'resurfaced_work', 'delivery_intervention',
] as const;
export type OperatorActivityKind = typeof OPERATOR_ACTIVITY_KINDS[number];

export type OperatorActivityFacts = Readonly<Record<string, string | number | boolean | null>>;

/** Producer identity is attribution only; recipient access is always re-authorized separately. */
export type ActivityProducer = Readonly<
  | { kind: 'system'; id?: never }
  | { kind: 'staff'; id: string }
>;
export type ActivityProducerProjection = Readonly<
  | { kind: 'system' }
  | { kind: 'staff'; /** Null only after the former staff user has been deleted. */ id: string | null }
>;

export type TrustedActivityAppend = Readonly<{
  /** Stable projection ID: replay must reuse this ID and every immutable field. */
  id: string;
  ticketId: string;
  recipientUserId: string;
  kind: OperatorActivityKind;
  /** Stable canonical/event identity. Exact replays (including the projection ID) are idempotent. */
  sourceId: string;
  producer: ActivityProducer;
  /** Compact render facts only; message bodies and delivery payloads do not belong here. */
  facts: OperatorActivityFacts;
  resurfacedAt?: string | null;
}>;

export type OperatorActivity = Readonly<{
  id: string;
  ticketId: string;
  /** Present on authorized activity-list rows; mutations return no ticket content. */
  ticketSubject?: string | null;
  recipientUserId: string;
  kind: OperatorActivityKind;
  sourceId: string;
  producer: ActivityProducerProjection;
  facts: OperatorActivityFacts;
  revision: number;
  createdAt: string;
  resurfacedAt: string | null;
  readAt: string | null;
  dismissedAt: string | null;
}>;

export type OperatorActivityCursor = Readonly<{ createdAt: string; id: string }>;
/** Empty pages may carry a continuation across filtered candidates; consume until next is null. */
export type OperatorActivityPage = Readonly<{ status: 'available'; items: readonly OperatorActivity[]; next: string | null }>;
export type OperatorActivityUnreadCount = Readonly<
  | { status: 'available'; count: number }
  | { status: 'unavailable'; reason: 'recipient_activity_candidate_cap_exceeded'; count: null }
>;
export type ActivityPresentationCredential = Readonly<{
  sessionVersion: number;
  expiresAt: number;
  role: 'agent' | 'admin';
  /** Must originate from the MFA-authenticated staff credential accepted by middleware. */
  mfaVerified: true;
}>;
