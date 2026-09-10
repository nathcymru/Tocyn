import { operationalEvent, type OperationalEvent } from './operational-events';
import { resourceOperationEvent, type ResourceOperationEvent } from './resource-operation';

/**
 * A disposable, caller-owned evidence sink. It has no global registry, binding,
 * file, network, timer, or retention lifecycle: a process loses it when the
 * caller releases this object.
 */
export type LocalObservabilityEvent = OperationalEvent | ResourceOperationEvent;

export type LocalCollectorOptions = Readonly<{
  maxEvents?: number;
  maxBytes?: number;
  /** Keep every Nth validated event, beginning with the first (N defaults to 1). */
  sampleEvery?: number;
}>;

export type LocalCollectionCounts = Readonly<{
  attempted: number;
  retained: number;
  retainedBytes: number;
  invalid: number;
  sampledOut: number;
  eventLimitDrops: number;
  byteLimitDrops: number;
}>;

export type LocalObservabilityExport = Readonly<{
  version: 1;
  type: 'local.observability.export';
  /** False means this bounded diagnostic snapshot omitted one or more inputs. */
  complete: boolean;
  retention: Readonly<{ scope: 'caller-owned-memory'; maxEvents: number; maxBytes: number; sampleEvery: number }>;
  counts: LocalCollectionCounts;
  events: readonly LocalObservabilityEvent[];
}>;

const DEFAULT_MAX_EVENTS = 64;
const DEFAULT_MAX_BYTES = 16 * 1024;
const MAX_EVENTS = 256;
const MAX_BYTES = 64 * 1024;
const MAX_SAMPLE_EVERY = 1_000;
const encoder = new TextEncoder();

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) throw new Error('Invalid local observability collector options');
  return value;
}

/** Reconstructs known envelopes so callers cannot smuggle extra fields into an export. */
function normalize(event: unknown): LocalObservabilityEvent | undefined {
  try {
    if (!event || typeof event !== 'object') return undefined;
    const value = event as Record<string, unknown>;
    if (value.type === 'http.request' && value.version === 1) {
      return operationalEvent({
        correlationId: value.correlationId as string,
        route: value.route as string,
        method: value.method as string,
        outcome: 'success',
        status: value.status as number,
        latencyMs: value.latencyMs as number,
      });
    }
    if (value.type === 'resource.operation' && value.version === 1) {
      return resourceOperationEvent({
        resource: value.resource as ResourceOperationEvent['resource'],
        operation: value.operation as string,
        outcome: value.outcome as ResourceOperationEvent['outcome'],
        latencyMs: value.latencyMs as number,
      });
    }
  } catch { /* Invalid diagnostics are counted below and never escape to callers. */ }
  return undefined;
}

export type LocalObservabilityCollector = Readonly<{
  /** Synchronous and non-throwing so diagnostics cannot become request backpressure. */
  record: (event: unknown) => void;
  /** Returns an immutable point-in-time copy; exporting never clears the evidence. */
  export: () => LocalObservabilityExport;
}>;

/**
 * Creates bounded local-only evidence. Retention is deterministic first-fit after
 * sampling; limits never evict earlier events. This is sampled diagnostic output,
 * never canonical audit, billing, or a complete SLI denominator.
 */
export function createLocalObservabilityCollector(options: LocalCollectorOptions = {}): LocalObservabilityCollector {
  const maxEvents = boundedInteger(options.maxEvents, DEFAULT_MAX_EVENTS, 1, MAX_EVENTS);
  const maxBytes = boundedInteger(options.maxBytes, DEFAULT_MAX_BYTES, 256, MAX_BYTES);
  const sampleEvery = boundedInteger(options.sampleEvery, 1, 1, MAX_SAMPLE_EVERY);
  const events: LocalObservabilityEvent[] = [];
  let attempted = 0;
  let retainedBytes = 0;
  let invalid = 0;
  let sampledOut = 0;
  let eventLimitDrops = 0;
  let byteLimitDrops = 0;

  const record = (input: unknown): void => {
    attempted++;
    const event = normalize(input);
    if (!event) { invalid++; return; }
    const validOrdinal = attempted - invalid;
    if ((validOrdinal - 1) % sampleEvery !== 0) { sampledOut++; return; }
    if (events.length >= maxEvents) { eventLimitDrops++; return; }
    const bytes = encoder.encode(JSON.stringify(event)).byteLength;
    if (bytes > maxBytes - retainedBytes) { byteLimitDrops++; return; }
    events.push(event);
    retainedBytes += bytes;
  };

  return Object.freeze({
    record,
    export: () => {
      const counts = Object.freeze({ attempted, retained: events.length, retainedBytes, invalid, sampledOut, eventLimitDrops, byteLimitDrops });
      const complete = invalid === 0 && sampledOut === 0 && eventLimitDrops === 0 && byteLimitDrops === 0;
      return Object.freeze({
        version: 1,
        type: 'local.observability.export',
        complete,
        retention: Object.freeze({ scope: 'caller-owned-memory' as const, maxEvents, maxBytes, sampleEvery }),
        counts,
        events: Object.freeze([...events]),
      });
    },
  });
}
