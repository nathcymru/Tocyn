import { observabilityEnabled } from './operational-events';
export const RESOURCE_OPERATION_EVENT_VERSION = 1 as const;

export type ResourceKind = 'd1' | 'r2' | 'durable_object' | 'workflow' | 'ai';
export type ResourceOperationOutcome = 'success' | 'failure';

export type ResourceOperationEvent = Readonly<{
  version: typeof RESOURCE_OPERATION_EVENT_VERSION;
  type: 'resource.operation';
  resource: ResourceKind;
  operation: string;
  outcome: ResourceOperationOutcome;
  latencyMs: number;
}>;

const RESOURCES = new Set<ResourceKind>(['d1', 'r2', 'durable_object', 'workflow', 'ai']);
const OPERATIONS = new Set(['read', 'write', 'batch', 'delete', 'invoke', 'run', 'search', 'embed', 'fallback']);

export function resourceOperationEvent(input: Omit<ResourceOperationEvent, 'version' | 'type'>): ResourceOperationEvent {
  if (!RESOURCES.has(input.resource) || !OPERATIONS.has(input.operation)
    || (input.outcome !== 'success' && input.outcome !== 'failure')
    || !Number.isFinite(input.latencyMs) || input.latencyMs < 0) {
    throw new Error('Invalid resource operation event');
  }
  return Object.freeze({ version: RESOURCE_OPERATION_EVENT_VERSION, type: 'resource.operation', resource: input.resource, operation: input.operation, outcome: input.outcome, latencyMs: input.latencyMs });
}

export type ResourceOperationOptions<T> = {
  resource: ResourceKind;
  operation: string;
  execute: () => T | Promise<T>;
  emit?: (event: ResourceOperationEvent) => void | Promise<void>;
  now?: () => number;
};

/** Measures one trusted operation without exposing arguments, results, errors or identifiers. */
export async function measureResourceOperation<T>(options: ResourceOperationOptions<T>): Promise<T> {
  // Disabled diagnostics neither read the clock nor inspect classifications.
  if (!options.emit) return options.execute();
  const now = options.now ?? Date.now;
  let start: number | undefined;
  try { const value = now(); if (Number.isFinite(value)) start = value; } catch { /* No trustworthy sample. */ }
  const finish = (outcome: ResourceOperationOutcome) => {
    if (start === undefined) return;
    try {
      const elapsed = now() - start;
      const event = resourceOperationEvent({ resource: options.resource, operation: options.operation, outcome, latencyMs: elapsed });
      // A diagnostic transport must not become application backpressure. Callers
      // own any waitUntil lifecycle; this wrapper observes rejections only.
      const pending = options.emit?.(event);
      if (pending) void Promise.resolve(pending).catch(() => {});
    } catch { /* Diagnostics never change operation behavior. */ }
  };
  try {
    const result = await options.execute();
    finish('success');
    return result;
  } catch (error) {
    finish('failure');
    throw error;
  }
}

export type ResourceOperationEmitter = (event: ResourceOperationEvent) => void | Promise<void>;
/** A per-composition output ceiling, not an SLO or a complete usage counter. */
export const MAX_RESOURCE_EVENTS_PER_COMPOSITION = 64;
export function createResourceOperationEmitter(env: Parameters<typeof observabilityEnabled>[0]): ResourceOperationEmitter | undefined {
  try { if (!observabilityEnabled(env)) return undefined; } catch { return undefined; }
  let emitted = 0;
  return event => {
    if (emitted >= MAX_RESOURCE_EVENTS_PER_COMPOSITION) return;
    emitted++;
    console.log(JSON.stringify(resourceOperationEvent(event)));
  };
}
