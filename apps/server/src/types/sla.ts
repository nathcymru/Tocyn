import type { SlaCalendar, SlaReopenPolicy } from '../domain/sla-clock';

export type SlaPolicy = Readonly<{
  calendar: SlaCalendar;
  responseTargetMs: number | null;
  resolutionTargetMs: number | null;
  reopenPolicy: SlaReopenPolicy;
  revision: number;
}>;

export type SlaPolicyInput = Readonly<{
  expectedRevision: number;
  calendar: unknown;
  responseTargetMs: number | null;
  resolutionTargetMs: number | null;
  reopenPolicy?: Partial<SlaReopenPolicy>;
}>;

export type TicketSlaClock = Readonly<{
  ticketId: string;
  responseStartedAt: string;
  responseCompletedAt: string | null;
  resolutionStartedAt: string;
  resolutionCompletedAt: string | null;
  pausedAt: string | null;
  pauseReason: 'waiting' | null;
  supportStateRevision: number;
  revision: number;
  policyRevision: number;
  policyCalendarJson: string | null;
  policyResponseTargetMs: number | null;
  policyResolutionTargetMs: number | null;
  policyResponseReopenPolicy: 'continue' | 'restart' | null;
  policyResolutionReopenPolicy: 'continue' | 'restart' | null;
}>;

export type SlaTargetProjection = Readonly<{
  state: 'unavailable' | 'on-track' | 'breached';
  /** Lifecycle is separate from the preserved breach outcome. */
  phase: 'unavailable' | 'running' | 'paused' | 'completed';
  completedAt: string | null;
  dueAt: string | null;
  remainingWorkingMilliseconds: number | null;
  targetWorkingMilliseconds: number | null;
}>;

/** Customer-safe: handler name only, never staff identifiers, email, or pause facts. */
export type TicketSlaProjection = Readonly<{
  response: SlaTargetProjection;
  resolution: SlaTargetProjection;
  handlerName: string | null;
}>;
