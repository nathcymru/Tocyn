import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { measureResourceOperation, type ResourceOperationEmitter } from '../observability/resource-operation';

/**
 * Measures D1 invocation boundaries only. It deliberately does not classify SQL
 * as reads/writes or expose SQL, bindings, rows, errors, or tenant data.
 */
export function observeD1<T extends D1Database>(db: T, emit?: ResourceOperationEmitter): T {
  if (!emit) return db;
  const unwrap = new WeakMap<object, object>();
  const wrapStatement = (statement: D1PreparedStatement): D1PreparedStatement => {
    const proxy = new Proxy(statement as any, {
      get(target, property) {
        const value = Reflect.get(target, property);
        if (property === 'bind') return (...args: unknown[]) => wrapStatement(value.apply(target, args));
        if (property === 'first' || property === 'all' || property === 'raw' || property === 'run') {
          return (...args: unknown[]) => measureResourceOperation({
            resource: 'd1', operation: 'invoke', emit, execute: () => value.apply(target, args),
            // all/run return D1 result envelopes; first/raw return caller data.
            ...(property === 'all' || property === 'run' ? { isFailureResult: d1ResultFailure } : {}),
          });
        }
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    unwrap.set(proxy, statement);
    return proxy as D1PreparedStatement;
  };
  return new Proxy(db as any, {
    get(target, property) {
      const value = Reflect.get(target, property);
      if (property === 'prepare') return (sql: string) => wrapStatement(value.call(target, sql));
      if (property === 'batch') return (statements: D1PreparedStatement[]) => measureResourceOperation({
        resource: 'd1', operation: 'batch', emit,
        execute: () => value.call(target, statements.map(statement => unwrap.get(statement as object) ?? statement)),
        isFailureResult: d1BatchFailure,
      });
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as T;
}

function d1ResultFailure(result: unknown): boolean {
  return typeof result === 'object' && result !== null && 'success' in result
    && (result as { success?: unknown }).success === false;
}

function d1BatchFailure(results: unknown): boolean {
  return Array.isArray(results) && results.some(d1ResultFailure);
}
