import { DEFAULT_SLA_CALENDAR, evaluateResolutionSla, evaluateResponseSla, parseSlaCalendar, type SlaCalendar, type SlaPauseInterval } from '../domain/sla-clock';

export type SlaMetricClockRow = Readonly<{
  responseStartedAt: string;
  responseCompletedAt: string | null;
  resolutionStartedAt: string;
  resolutionCompletedAt: string | null;
  pausedAt: string | null;
  policyCalendarJson: string | null;
  policyResponseTargetMs: number | null;
  policyResolutionTargetMs: number | null;
  currentPolicyCalendarJson: string | null;
  currentPolicyResponseTargetMs: number | null;
  currentPolicyResolutionTargetMs: number | null;
}>;

export type SlaMetricTarget = Readonly<{
  /** Null means the configured target has no truthful deadline (for example, an open pause). */
  dueAt: string | null;
  completedAt: string | null;
  completedOnTime: boolean;
  inspectedCalendarDays: number;
  inspectedCalendarIntervals: number;
}>;

export type SlaMetricClockEvaluation = Readonly<{
  response: SlaMetricTarget | null;
  resolution: SlaMetricTarget | null;
}>;

function date(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function target(value: number | null): number | null | undefined {
  if (value === null) return null;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 60_000 && value <= 7_776_000_000 ? value : undefined;
}

function policy(clock: SlaMetricClockRow): Readonly<{ calendar: SlaCalendar; responseTargetMs: number | null; resolutionTargetMs: number | null }> | null {
  try {
    if (clock.policyCalendarJson !== null) {
      const responseTargetMs = target(clock.policyResponseTargetMs); const resolutionTargetMs = target(clock.policyResolutionTargetMs);
      if (responseTargetMs === undefined || resolutionTargetMs === undefined) return null;
      return {
      calendar: parseSlaCalendar(JSON.parse(clock.policyCalendarJson)),
      responseTargetMs, resolutionTargetMs,
      };
    }
    if (clock.currentPolicyCalendarJson === null) return { calendar: DEFAULT_SLA_CALENDAR, responseTargetMs: null, resolutionTargetMs: null };
    const responseTargetMs = target(clock.currentPolicyResponseTargetMs); const resolutionTargetMs = target(clock.currentPolicyResolutionTargetMs);
    if (responseTargetMs === undefined || resolutionTargetMs === undefined) return null;
    return {
      calendar: parseSlaCalendar(JSON.parse(clock.currentPolicyCalendarJson)),
      responseTargetMs, resolutionTargetMs,
    };
  } catch { return null; }
}

function evaluateTarget(
  calendar: SlaCalendar,
  targetWorkingMilliseconds: number | null,
  startedAtValue: string,
  completedAtValue: string | null,
  pausedAtValue: string | null,
  pauses: readonly SlaPauseInterval[],
  now: Date,
  kind: 'response' | 'resolution',
): SlaMetricTarget | null {
  if (targetWorkingMilliseconds === null) return { dueAt: null, completedAt: null, completedOnTime: false, inspectedCalendarDays: 0, inspectedCalendarIntervals: 0 };
  const startedAt = date(startedAtValue);
  const completedAt = completedAtValue === null ? null : date(completedAtValue);
  const pausedAt = pausedAtValue === null ? null : date(pausedAtValue);
  if (!startedAt || (completedAtValue !== null && !completedAt) || (pausedAtValue !== null && !pausedAt)) return null;
  const evaluatedAt = completedAt ?? pausedAt ?? now;
  const cutoff = evaluatedAt.getTime();
  const applicablePauses = pauses.flatMap(pause => {
    const startsAt = Math.max(new Date(pause.startsAt).getTime(), startedAt.getTime());
    const endsAt = Math.min(new Date(pause.endsAt).getTime(), cutoff);
    return startsAt < endsAt ? [{ startsAt, endsAt }] : [];
  });
  try {
    const input = { calendar, startedAt, evaluatedAt, targetWorkingMilliseconds, pauses: applicablePauses };
    const result = kind === 'response' ? evaluateResponseSla(input) : evaluateResolutionSla(input);
    if (result.reason === 'resource-limit') return null;
    const dueAt = completedAt || !pausedAt ? result.dueAt?.toISOString() ?? null : null;
    return {
      dueAt,
      completedAt: completedAt?.toISOString() ?? null,
      completedOnTime: completedAt !== null && result.state === 'on-track',
      inspectedCalendarDays: result.inspectedCalendarDays,
      inspectedCalendarIntervals: result.inspectedIntervals,
    };
  } catch { return null; }
}

/**
 * Applies the exact frozen-policy clock evaluator used by SLA projections to a
 * bounded, already-authorized snapshot. Invalid persisted facts fail closed.
 */
export function evaluateSlaMetricClock(clock: SlaMetricClockRow, pauses: readonly SlaPauseInterval[], now: Date): SlaMetricClockEvaluation | null {
  const frozenPolicy = policy(clock);
  if (!frozenPolicy) return null;
  const response = evaluateTarget(frozenPolicy.calendar, frozenPolicy.responseTargetMs, clock.responseStartedAt, clock.responseCompletedAt, clock.pausedAt, pauses, now, 'response');
  const resolution = evaluateTarget(frozenPolicy.calendar, frozenPolicy.resolutionTargetMs, clock.resolutionStartedAt, clock.resolutionCompletedAt, clock.pausedAt, pauses, now, 'resolution');
  return response === null || resolution === null ? null : { response, resolution };
}
