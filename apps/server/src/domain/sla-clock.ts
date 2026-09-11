/**
 * Pure calendar arithmetic for SLA clocks.
 *
 * This module deliberately does not infer ticket lifecycle, waiting-state, or
 * reopening policy. Callers must supply the clock anchors and pause intervals
 * they have established from accepted conversation facts.
 */

export const SLA_WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;

export type SlaWeekday = typeof SLA_WEEKDAYS[number];
export type SlaWorkingInterval = Readonly<{ startMinute: number; endMinute: number }>;
export type SlaDstPolicy = Readonly<{
  /** How an endpoint in a repeated local hour is mapped to an instant. */
  ambiguousLocalTime: 'earlier' | 'later' | 'both';
  /** How an endpoint in a skipped local hour is mapped to an instant. */
  nonexistentLocalTime: 'next-valid' | 'previous-valid' | 'reject';
}>;
export type SlaCalendarException = Readonly<{ date: string; intervals: readonly SlaWorkingInterval[] }>;
export type SlaCalendar = Readonly<{
  timeZone: string;
  weekly: Readonly<Partial<Record<SlaWeekday, readonly SlaWorkingInterval[]>>>;
  exceptions: readonly SlaCalendarException[];
  dst: SlaDstPolicy;
}>;

export type SlaPauseInterval = Readonly<{ startsAt: Date | number; endsAt: Date | number }>;
export type SlaEvaluationLimits = Readonly<{
  /** Maximum local calendar dates inspected by one calculation. */
  maxCalendarDays: number;
  /** Maximum working intervals emitted by one calculation. */
  maxIntervals: number;
}>;
export type SlaClockInput = Readonly<{
  calendar: SlaCalendar;
  startedAt: Date | number;
  evaluatedAt: Date | number;
  pauses?: readonly SlaPauseInterval[];
  limits?: Partial<SlaEvaluationLimits>;
}>;
export type SlaDeadlineInput = Readonly<{
  calendar: SlaCalendar;
  startedAt: Date | number;
  targetWorkingMilliseconds: number;
  pauses?: readonly SlaPauseInterval[];
  limits?: Partial<SlaEvaluationLimits>;
}>;
export type SlaClockResult = Readonly<{
  elapsedWorkingMilliseconds: number;
  activePauseMilliseconds: number;
  inspectedCalendarDays: number;
  inspectedIntervals: number;
}>;
export type SlaDeadlineResult = SlaClockResult & Readonly<{
  dueAt: Date | null;
  reason?: 'no-working-time' | 'resource-limit';
}>;
export type SlaTargetResult = SlaDeadlineResult & Readonly<{
  targetWorkingMilliseconds: number;
  remainingWorkingMilliseconds: number;
  state: 'on-track' | 'breached' | 'unavailable';
}>;
export type SlaReopenPolicy = Readonly<{
  response: 'continue' | 'restart';
  resolution: 'continue' | 'restart';
}>;
export type SlaClockKind = 'response' | 'resolution';

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;
const DEFAULT_LIMITS: SlaEvaluationLimits = Object.freeze({ maxCalendarDays: 366, maxIntervals: 4_096 });
const MAX_CALENDAR_EXCEPTIONS = 3_660;
const MAX_INTERVALS_PER_DAY = 48;
const MAX_FORMATTER_CACHE_ENTRIES = 64;
const MIN_SUPPORTED_YEAR = 100;
const MAX_SUPPORTED_YEAR = 9_999;

export class SlaClockError extends Error {
  constructor(readonly code: 'invalid-calendar' | 'invalid-instant' | 'invalid-pause' | 'invalid-target' | 'resource-limit' | 'nonexistent-local-time', message: string) {
    super(message);
    this.name = 'SlaClockError';
  }
}

/** The only built-in calendar. Configured calendars must state a DST policy. */
export const DEFAULT_SLA_CALENDAR: SlaCalendar = Object.freeze({
  timeZone: 'UTC',
  weekly: Object.freeze(Object.fromEntries(SLA_WEEKDAYS.map(day => [day, Object.freeze([{ startMinute: 0, endMinute: 1_440 }])]))),
  exceptions: Object.freeze([]),
  dst: Object.freeze({ ambiguousLocalTime: 'earlier', nonexistentLocalTime: 'next-valid' }),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertInteger(value: unknown, description: string, minimum: number, maximum: number): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new SlaClockError('invalid-calendar', `${description} must be an integer from ${minimum} to ${maximum}`);
  }
}

function assertTimeZone(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128) {
    throw new SlaClockError('invalid-calendar', 'timeZone must be a non-empty IANA timezone name');
  }
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: value }).format(0);
  } catch {
    throw new SlaClockError('invalid-calendar', 'timeZone must be a supported IANA timezone name');
  }
}

function assertDateKey(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new SlaClockError('invalid-calendar', 'exception date must use YYYY-MM-DD');
  }
  const [year, month, day] = value.split('-').map(Number);
  if (year < MIN_SUPPORTED_YEAR) {
    throw new SlaClockError('invalid-calendar', `exception dates before ${MIN_SUPPORTED_YEAR.toString().padStart(4, '0')} are unsupported`);
  }
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new SlaClockError('invalid-calendar', 'exception date must be a real Gregorian date');
  }
}

function validateIntervals(value: unknown, description: string): readonly SlaWorkingInterval[] {
  if (!Array.isArray(value) || value.length > MAX_INTERVALS_PER_DAY) {
    throw new SlaClockError('invalid-calendar', `${description} must contain at most ${MAX_INTERVALS_PER_DAY} intervals`);
  }
  const intervals = value.map((item, index) => {
    if (!isRecord(item)) throw new SlaClockError('invalid-calendar', `${description}[${index}] must be an object`);
    assertInteger(item.startMinute, `${description}[${index}].startMinute`, 0, 1_439);
    assertInteger(item.endMinute, `${description}[${index}].endMinute`, 1, 1_440);
    if (item.startMinute >= item.endMinute) {
      throw new SlaClockError('invalid-calendar', `${description}[${index}] must end after it starts; split overnight work across dates`);
    }
    return Object.freeze({ startMinute: item.startMinute, endMinute: item.endMinute });
  });
  for (let index = 1; index < intervals.length; index += 1) {
    if (intervals[index - 1].endMinute > intervals[index].startMinute) {
      throw new SlaClockError('invalid-calendar', `${description} intervals must be sorted and non-overlapping`);
    }
  }
  return Object.freeze(intervals);
}

/**
 * Validates untrusted configuration into immutable, bounded pure data. Empty
 * weekly days and empty exceptions are intentional calendar closures.
 */
export function parseSlaCalendar(value: unknown): SlaCalendar {
  if (!isRecord(value)) throw new SlaClockError('invalid-calendar', 'calendar must be an object');
  assertTimeZone(value.timeZone);
  if (!isRecord(value.weekly)) throw new SlaClockError('invalid-calendar', 'calendar.weekly must be an object');
  if (!isRecord(value.dst) || !['earlier', 'later', 'both'].includes(value.dst.ambiguousLocalTime as string)
    || !['next-valid', 'previous-valid', 'reject'].includes(value.dst.nonexistentLocalTime as string)) {
    throw new SlaClockError('invalid-calendar', 'calendar.dst must explicitly define fold and gap handling');
  }
  const weekly: Partial<Record<SlaWeekday, readonly SlaWorkingInterval[]>> = {};
  for (const day of SLA_WEEKDAYS) {
    if (value.weekly[day] !== undefined) weekly[day] = validateIntervals(value.weekly[day], `calendar.weekly.${day}`);
  }
  if (Object.keys(value.weekly).some(key => !SLA_WEEKDAYS.includes(key as SlaWeekday))) {
    throw new SlaClockError('invalid-calendar', 'calendar.weekly contains an unknown weekday');
  }
  if (value.exceptions !== undefined && !Array.isArray(value.exceptions)) {
    throw new SlaClockError('invalid-calendar', 'calendar.exceptions must be an array');
  }
  const rawExceptions = value.exceptions ?? [];
  if (rawExceptions.length > MAX_CALENDAR_EXCEPTIONS) {
    throw new SlaClockError('invalid-calendar', `calendar.exceptions cannot exceed ${MAX_CALENDAR_EXCEPTIONS}`);
  }
  const seenDates = new Set<string>();
  const exceptions = rawExceptions.map((item, index) => {
    if (!isRecord(item)) throw new SlaClockError('invalid-calendar', `calendar.exceptions[${index}] must be an object`);
    assertDateKey(item.date);
    if (seenDates.has(item.date)) throw new SlaClockError('invalid-calendar', 'calendar.exceptions dates must be unique');
    seenDates.add(item.date);
    return Object.freeze({ date: item.date, intervals: validateIntervals(item.intervals, `calendar.exceptions[${index}].intervals`) });
  });
  return Object.freeze({
    timeZone: value.timeZone,
    weekly: Object.freeze(weekly),
    exceptions: Object.freeze(exceptions),
    dst: Object.freeze({ ambiguousLocalTime: value.dst.ambiguousLocalTime as SlaDstPolicy['ambiguousLocalTime'], nonexistentLocalTime: value.dst.nonexistentLocalTime as SlaDstPolicy['nonexistentLocalTime'] }),
  });
}

function epoch(value: Date | number, code: SlaClockError['code'] = 'invalid-instant'): number {
  const result = value instanceof Date ? value.getTime() : value;
  if (!Number.isSafeInteger(result) || Math.abs(result) > 8_640_000_000_000_000) {
    throw new SlaClockError(code, 'instant must be a valid, safe epoch millisecond value');
  }
  const date = new Date(result);
  if (date.getUTCFullYear() < MIN_SUPPORTED_YEAR || date.getUTCFullYear() > MAX_SUPPORTED_YEAR) {
    throw new SlaClockError(code, `instant year must be from ${MIN_SUPPORTED_YEAR} to ${MAX_SUPPORTED_YEAR}`);
  }
  return result;
}

function limits(value: Partial<SlaEvaluationLimits> | undefined): SlaEvaluationLimits {
  const candidate = { ...DEFAULT_LIMITS, ...value };
  if (!Number.isInteger(candidate.maxCalendarDays) || candidate.maxCalendarDays < 1 || candidate.maxCalendarDays > 3_660
    || !Number.isInteger(candidate.maxIntervals) || candidate.maxIntervals < 1 || candidate.maxIntervals > 65_536) {
    throw new SlaClockError('resource-limit', 'evaluation limits are outside the supported bounds');
  }
  return candidate;
}

type LocalDateTime = Readonly<{ year: number; month: number; day: number; hour: number; minute: number; weekday: SlaWeekday }>;
type LocalDate = Pick<LocalDateTime, 'year' | 'month' | 'day' | 'weekday'>;
type EpochInterval = Readonly<{ startsAt: number; endsAt: number }>;

const formatterCache = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let cached = formatterCache.get(timeZone);
  if (!cached) {
    if (formatterCache.size >= MAX_FORMATTER_CACHE_ENTRIES) formatterCache.clear();
    cached = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    formatterCache.set(timeZone, cached);
  }
  return cached;
}

function localDateTime(instant: number, timeZone: string): LocalDateTime {
  const values: Record<string, string> = {};
  for (const part of formatter(timeZone).formatToParts(instant)) if (part.type !== 'literal') values[part.type] = part.value;
  const weekday = values.weekday.toLowerCase() as SlaWeekday;
  if (!SLA_WEEKDAYS.includes(weekday)) throw new SlaClockError('invalid-calendar', 'timezone formatter returned an unsupported weekday');
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day), hour: Number(values.hour), minute: Number(values.minute), weekday };
}

function localDateKey(date: Pick<LocalDate, 'year' | 'month' | 'day'>): string {
  return `${date.year.toString().padStart(4, '0')}-${date.month.toString().padStart(2, '0')}-${date.day.toString().padStart(2, '0')}`;
}

function nextLocalDate(date: LocalDate): LocalDate {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + 1));
  const weekdayIndex = (SLA_WEEKDAYS.indexOf(date.weekday) + 1) % SLA_WEEKDAYS.length;
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate(), weekday: SLA_WEEKDAYS[weekdayIndex] };
}

function sameLocalMinute(actual: LocalDateTime, expected: LocalDateTime): boolean {
  return actual.year === expected.year && actual.month === expected.month && actual.day === expected.day && actual.hour === expected.hour && actual.minute === expected.minute;
}

function offsetsNear(nominal: number, timeZone: string): readonly number[] {
  const result = new Set<number>();
  for (let delta = -36 * 60; delta <= 36 * 60; delta += 360) {
    const instant = nominal + delta * MS_PER_MINUTE;
    const local = localDateTime(instant, timeZone);
    const renderedAsUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
    result.add(renderedAsUtc - instant);
  }
  return [...result];
}

function localMinuteToInstants(local: LocalDateTime, timeZone: string): readonly number[] {
  const nominal = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  return offsetsNear(nominal, timeZone)
    .map(offset => nominal - offset)
    .filter(candidate => sameLocalMinute(localDateTime(candidate, timeZone), local))
    .sort((left, right) => left - right);
}

function boundaryInstant(local: LocalDateTime, calendar: SlaCalendar, edge: 'start' | 'end'): number {
  const exact = localMinuteToInstants(local, calendar.timeZone);
  if (exact.length > 0) {
    if (calendar.dst.ambiguousLocalTime === 'later') return exact[exact.length - 1];
    if (calendar.dst.ambiguousLocalTime === 'both') return edge === 'start' ? exact[0] : exact[exact.length - 1];
    return exact[0];
  }
  if (calendar.dst.nonexistentLocalTime === 'reject') {
    throw new SlaClockError('nonexistent-local-time', `calendar boundary falls in a DST gap: ${localDateKey(local)} ${local.hour}:${local.minute}`);
  }
  const direction = calendar.dst.nonexistentLocalTime === 'next-valid' ? 1 : -1;
  for (let minutes = 1; minutes <= 180; minutes += 1) {
    const shifted = new Date(Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute + direction * minutes));
    const candidate: LocalDateTime = {
      year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate(), hour: shifted.getUTCHours(), minute: shifted.getUTCMinutes(), weekday: local.weekday,
    };
    const instants = localMinuteToInstants(candidate, calendar.timeZone);
    if (instants.length > 0) return direction === 1 ? instants[0] : instants[instants.length - 1];
  }
  throw new SlaClockError('nonexistent-local-time', 'no valid instant was found within the DST gap bound');
}

function dateIntervals(date: LocalDate, calendar: SlaCalendar, exceptions: ReadonlyMap<string, readonly SlaWorkingInterval[]>): readonly EpochInterval[] {
  const intervals = exceptions.get(localDateKey(date)) ?? calendar.weekly[date.weekday] ?? [];
  const mapped = intervals.map(interval => {
    const startHour = Math.floor(interval.startMinute / 60);
    const startMinute = interval.startMinute % 60;
    const endDate = interval.endMinute === 1_440 ? nextLocalDate(date) : date;
    const endHour = interval.endMinute === 1_440 ? 0 : Math.floor(interval.endMinute / 60);
    const endMinute = interval.endMinute === 1_440 ? 0 : interval.endMinute % 60;
    const startsAt = boundaryInstant({ ...date, hour: startHour, minute: startMinute }, calendar, 'start');
    const endsAt = boundaryInstant({ ...endDate, hour: endHour, minute: endMinute }, calendar, 'end');
    return Object.freeze({ startsAt, endsAt });
  }).filter(interval => interval.startsAt < interval.endsAt).sort((left, right) => left.startsAt - right.startsAt);
  const normalized: EpochInterval[] = [];
  for (const interval of mapped) {
    const previous = normalized[normalized.length - 1];
    if (previous && interval.startsAt <= previous.endsAt) {
      normalized[normalized.length - 1] = { startsAt: previous.startsAt, endsAt: Math.max(previous.endsAt, interval.endsAt) };
    } else normalized.push(interval);
  }
  return normalized;
}

function pauseIntervals(value: readonly SlaPauseInterval[] | undefined): readonly EpochInterval[] {
  if (!value) return [];
  if (value.length > 4_096) throw new SlaClockError('invalid-pause', 'pause intervals cannot exceed 4096');
  const sorted = value.map(interval => {
    if (!isRecord(interval)) throw new SlaClockError('invalid-pause', 'pause interval must be an object');
    const startsAt = epoch(interval.startsAt, 'invalid-pause');
    const endsAt = epoch(interval.endsAt, 'invalid-pause');
    if (startsAt >= endsAt) throw new SlaClockError('invalid-pause', 'pause interval must end after it starts');
    return { startsAt, endsAt };
  }).sort((left, right) => left.startsAt - right.startsAt);
  const merged: EpochInterval[] = [];
  for (const interval of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && interval.startsAt <= previous.endsAt) {
      merged[merged.length - 1] = { startsAt: previous.startsAt, endsAt: Math.max(previous.endsAt, interval.endsAt) };
    } else merged.push({ ...interval });
  }
  return merged;
}

function unpausedSlices(interval: EpochInterval, pauses: readonly EpochInterval[]): readonly EpochInterval[] {
  const slices: EpochInterval[] = [];
  let cursor = interval.startsAt;
  for (const pause of pauses) {
    if (pause.endsAt <= cursor) continue;
    if (pause.startsAt >= interval.endsAt) break;
    if (pause.startsAt > cursor) slices.push({ startsAt: cursor, endsAt: Math.min(pause.startsAt, interval.endsAt) });
    cursor = Math.max(cursor, pause.endsAt);
    if (cursor >= interval.endsAt) break;
  }
  if (cursor < interval.endsAt) slices.push({ startsAt: cursor, endsAt: interval.endsAt });
  return slices;
}

type CollectedIntervals = Readonly<{ intervals: readonly EpochInterval[]; inspectedCalendarDays: number; inspectedIntervals: number; exhausted: boolean }>;
function collectIntervals(calendar: SlaCalendar, startsAt: number, endsAt: number, evaluationLimits: SlaEvaluationLimits): CollectedIntervals {
  if (startsAt > endsAt) throw new SlaClockError('invalid-instant', 'evaluatedAt must not precede startedAt');
  const exceptions = new Map(calendar.exceptions.map(exception => [exception.date, exception.intervals]));
  const intervals: EpochInterval[] = [];
  let date: LocalDate = localDateTime(startsAt, calendar.timeZone);
  const finalDate = localDateTime(endsAt, calendar.timeZone);
  let inspectedCalendarDays = 0;
  let inspectedIntervals = 0;
  while (inspectedCalendarDays < evaluationLimits.maxCalendarDays) {
    const dayIntervals = dateIntervals(date, calendar, exceptions);
    inspectedCalendarDays += 1;
    for (const interval of dayIntervals) {
      inspectedIntervals += 1;
      if (inspectedIntervals > evaluationLimits.maxIntervals) return { intervals, inspectedCalendarDays, inspectedIntervals, exhausted: true };
      if (interval.endsAt > startsAt && interval.startsAt < endsAt) intervals.push({ startsAt: Math.max(interval.startsAt, startsAt), endsAt: Math.min(interval.endsAt, endsAt) });
    }
    if (date.year === finalDate.year && date.month === finalDate.month && date.day === finalDate.day) {
      return { intervals, inspectedCalendarDays, inspectedIntervals, exhausted: false };
    }
    date = nextLocalDate(date);
  }
  return { intervals, inspectedCalendarDays, inspectedIntervals, exhausted: true };
}

function worked(intervals: readonly EpochInterval[], pauses: readonly EpochInterval[]): { elapsedWorkingMilliseconds: number; activePauseMilliseconds: number } {
  let elapsedWorkingMilliseconds = 0;
  let activePauseMilliseconds = 0;
  for (const interval of intervals) {
    const slices = unpausedSlices(interval, pauses);
    const available = slices.reduce((total, slice) => total + slice.endsAt - slice.startsAt, 0);
    elapsedWorkingMilliseconds += available;
    activePauseMilliseconds += interval.endsAt - interval.startsAt - available;
  }
  return { elapsedWorkingMilliseconds, activePauseMilliseconds };
}

/** Returns elapsed scheduled working time after subtracting the explicit pauses. */
export function elapsedWorkingTime(input: SlaClockInput): SlaClockResult {
  const startedAt = epoch(input.startedAt);
  const evaluatedAt = epoch(input.evaluatedAt);
  const evaluationLimits = limits(input.limits);
  const collected = collectIntervals(input.calendar, startedAt, evaluatedAt, evaluationLimits);
  if (collected.exhausted) throw new SlaClockError('resource-limit', 'working-time calculation exceeded configured evaluation limits');
  return { ...worked(collected.intervals, pauseIntervals(input.pauses)), inspectedCalendarDays: collected.inspectedCalendarDays, inspectedIntervals: collected.inspectedIntervals };
}

/**
 * Finds the instant at which a target amount of scheduled, unpaused work has
 * passed. `null` denotes an intentionally empty calendar, not a breach.
 */
export function deadlineAfterWorkingTime(input: SlaDeadlineInput): SlaDeadlineResult {
  const startedAt = epoch(input.startedAt);
  if (!Number.isSafeInteger(input.targetWorkingMilliseconds) || input.targetWorkingMilliseconds < 0) {
    throw new SlaClockError('invalid-target', 'targetWorkingMilliseconds must be a non-negative safe integer');
  }
  const evaluationLimits = limits(input.limits);
  const pauses = pauseIntervals(input.pauses);
  if (input.targetWorkingMilliseconds === 0) return { dueAt: new Date(startedAt), elapsedWorkingMilliseconds: 0, activePauseMilliseconds: 0, inspectedCalendarDays: 0, inspectedIntervals: 0 };
  if (!Object.values(input.calendar.weekly).some(intervals => intervals && intervals.length > 0)
    && !input.calendar.exceptions.some(exception => exception.intervals.length > 0)) {
    return { dueAt: null, reason: 'no-working-time', elapsedWorkingMilliseconds: 0, activePauseMilliseconds: 0, inspectedCalendarDays: 0, inspectedIntervals: 0 };
  }
  const exceptions = new Map(input.calendar.exceptions.map(exception => [exception.date, exception.intervals]));
  let date: LocalDate = localDateTime(startedAt, input.calendar.timeZone);
  let cursor = startedAt;
  let remaining = input.targetWorkingMilliseconds;
  let elapsedWorkingMilliseconds = 0;
  let activePauseMilliseconds = 0;
  let inspectedCalendarDays = 0;
  let inspectedIntervals = 0;
  while (inspectedCalendarDays < evaluationLimits.maxCalendarDays) {
    const dayIntervals = dateIntervals(date, input.calendar, exceptions);
    inspectedCalendarDays += 1;
    for (const dayInterval of dayIntervals) {
      inspectedIntervals += 1;
      if (inspectedIntervals > evaluationLimits.maxIntervals) return { dueAt: null, reason: 'resource-limit', elapsedWorkingMilliseconds, activePauseMilliseconds, inspectedCalendarDays, inspectedIntervals };
      const interval = { startsAt: Math.max(dayInterval.startsAt, cursor), endsAt: dayInterval.endsAt };
      if (interval.startsAt >= interval.endsAt) continue;
      const slices = unpausedSlices(interval, pauses);
      const available = slices.reduce((total, slice) => total + slice.endsAt - slice.startsAt, 0);
      elapsedWorkingMilliseconds += available;
      activePauseMilliseconds += interval.endsAt - interval.startsAt - available;
      if (available >= remaining) {
        for (const slice of slices) {
          const duration = slice.endsAt - slice.startsAt;
          if (duration >= remaining) {
            return { dueAt: new Date(slice.startsAt + remaining), elapsedWorkingMilliseconds: input.targetWorkingMilliseconds, activePauseMilliseconds, inspectedCalendarDays, inspectedIntervals };
          }
          remaining -= duration;
        }
      }
      remaining -= available;
    }
    date = nextLocalDate(date);
    cursor = -Infinity;
  }
  return { dueAt: null, reason: 'resource-limit', elapsedWorkingMilliseconds, activePauseMilliseconds, inspectedCalendarDays, inspectedIntervals };
}

/** Applies a caller-selected reopen policy; it does not infer one from ticket state. */
export function slaClockStart(input: Readonly<{ openedAt: Date | number; reopenedAt?: Date | number; clock: SlaClockKind; reopenPolicy: SlaReopenPolicy }>): Date {
  const openedAt = epoch(input.openedAt);
  const reopenedAt = input.reopenedAt === undefined ? undefined : epoch(input.reopenedAt);
  if (reopenedAt !== undefined && reopenedAt < openedAt) throw new SlaClockError('invalid-instant', 'reopenedAt must not precede openedAt');
  return new Date(reopenedAt !== undefined && input.reopenPolicy[input.clock] === 'restart' ? reopenedAt : openedAt);
}

function targetResult(input: SlaDeadlineInput & Readonly<{ evaluatedAt: Date | number }>): SlaTargetResult {
  const evaluatedAt = epoch(input.evaluatedAt);
  const deadline = deadlineAfterWorkingTime(input);
  if (!deadline.dueAt) return { ...deadline, targetWorkingMilliseconds: input.targetWorkingMilliseconds, remainingWorkingMilliseconds: Math.max(0, input.targetWorkingMilliseconds - deadline.elapsedWorkingMilliseconds), state: 'unavailable' };
  const elapsed = elapsedWorkingTime({ calendar: input.calendar, startedAt: input.startedAt, evaluatedAt, pauses: input.pauses, limits: input.limits });
  return {
    ...deadline,
    elapsedWorkingMilliseconds: elapsed.elapsedWorkingMilliseconds,
    activePauseMilliseconds: elapsed.activePauseMilliseconds,
    targetWorkingMilliseconds: input.targetWorkingMilliseconds,
    remainingWorkingMilliseconds: Math.max(0, input.targetWorkingMilliseconds - elapsed.elapsedWorkingMilliseconds),
    state: evaluatedAt > deadline.dueAt.getTime() ? 'breached' : 'on-track',
  };
}

/** Response rule arithmetic; anchors and pause intervals are supplied by the caller. */
export function evaluateResponseSla(input: SlaDeadlineInput & Readonly<{ evaluatedAt: Date | number }>): SlaTargetResult {
  return targetResult(input);
}

/** Resolution rule arithmetic; anchors and pause intervals are supplied by the caller. */
export function evaluateResolutionSla(input: SlaDeadlineInput & Readonly<{ evaluatedAt: Date | number }>): SlaTargetResult {
  return targetResult(input);
}
