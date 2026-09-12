const DATETIME_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

const pad = (value: number) => String(value).padStart(2, '0');

/**
 * Formats an instant for a datetime-local input using an explicit UTC offset.
 * `utcOffsetMinutes` is positive east of UTC, which makes DST boundaries
 * deterministic in tests and keeps the browser's local-time semantics clear.
 */
export function instantToDateTimeLocal(instant: string, utcOffsetMinutes: number): string {
  const local = new Date(new Date(instant).getTime() + utcOffsetMinutes * 60_000);
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
}

/** Converts a datetime-local wall time to an ISO instant using its UTC offset. */
export function dateTimeLocalToInstant(value: string, utcOffsetMinutes: number): string {
  const match = DATETIME_LOCAL.exec(value);
  if (!match) throw new Error('Expected a datetime-local value');
  const [, year, month, day, hour, minute] = match;
  const utcMillis = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  return new Date(utcMillis - utcOffsetMinutes * 60_000).toISOString();
}

/** The runtime offset for a Date, expressed positive east of UTC. */
export function browserUtcOffsetMinutes(date: Date): number {
  return -date.getTimezoneOffset();
}

export function browserInstantToDateTimeLocal(instant: string): string {
  return instantToDateTimeLocal(instant, browserUtcOffsetMinutes(new Date(instant)));
}

export function browserDateTimeLocalToInstant(value: string): string {
  return dateTimeLocalToInstant(value, browserUtcOffsetMinutes(new Date(value)));
}
