import { AsyncLocalStorage } from 'node:async_hooks';
/** Synthetic-only RPC counters; namespace identity remains stable across requests. */
export function recoveryRuntimeCounters() {
  const coordinatorCalls = { refresh: 0, reserve: 0, reconcile: 0 };
  let wrapped: any;
  return { coordinatorCalls, wrap(namespace: any): any {
    return wrapped ??= { idFromName: (name: string) => namespace.idFromName(name), get: (id: any) => {
      const target = namespace.get(id);
      return {
        refreshFromTrustedAuthority: (input: any) => { coordinatorCalls.refresh++; return target.refreshFromTrustedAuthority(input); },
        reserveFromTrustedAuthority: (input: any) => { coordinatorCalls.reserve++; return target.reserveFromTrustedAuthority(input); },
        reconcileFromTrustedAuthority: (input: any) => { coordinatorCalls.reconcile++; return target.reconcileFromTrustedAuthority(input); },
        revokeFromTrustedAuthority: (input: any) => target.revokeFromTrustedAuthority(input),
      };
    } };
  } };
}

/** Preserve the real binding identity while keeping concurrent request metrics separate. */
export function recoveryRuntimeDatabase() {
  const requestDatabase = new AsyncLocalStorage<any>();
  const binding = new Proxy({}, { get(_target, property) {
    const database = requestDatabase.getStore();
    if (!database) throw new Error('Synthetic database accessed outside request context');
    const value = Reflect.get(database, property);
    return typeof value === 'function' ? value.bind(database) : value;
  } });
  return { binding, run<T>(database: any, callback: () => T): T { return requestDatabase.run(database, callback); } };
}
