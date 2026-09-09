/** SQLite CURRENT_TIMESTAMP values omit an offset but are stored as UTC. */
export function utcTimestamp(value: string): Date {
  return new Date(/[zZ]$|[+-]\d\d(?::?\d\d)?$/.test(value) ? value : `${value.replace(' ', 'T')}Z`);
}
