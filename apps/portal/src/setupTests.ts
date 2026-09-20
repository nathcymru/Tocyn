import '@testing-library/jest-dom';

// Ark's Radio Group measures its selected indicator; JSDOM has no observer.
if (typeof window !== 'undefined' && typeof window.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(window, 'ResizeObserver', { configurable: true, writable: true, value: ResizeObserverStub });
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, writable: true, value: ResizeObserverStub });
}

if (typeof window !== 'undefined' && (!window.localStorage || typeof window.localStorage.getItem !== 'function')) {
  const store = new Map<string, string>();
  const localStoragePolyfill = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, String(value)),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() { return store.size; }
  };
  Object.defineProperty(window, 'localStorage', { value: localStoragePolyfill, writable: true, configurable: true });
  Object.defineProperty(globalThis, 'localStorage', { value: localStoragePolyfill, writable: true, configurable: true });
}
