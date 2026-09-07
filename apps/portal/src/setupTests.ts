import '@testing-library/jest-dom';

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
