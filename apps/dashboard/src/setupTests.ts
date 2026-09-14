import '@testing-library/jest-dom';

if (!(globalThis as any).ResizeObserver) {
  (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}
if (!(globalThis as any).IntersectionObserver) {
  (globalThis as any).IntersectionObserver = class {
    readonly root = null; readonly rootMargin = ''; readonly thresholds: number[] = [];
    observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
  };
}
if (!HTMLElement.prototype.scrollTo) HTMLElement.prototype.scrollTo = () => {};

if (!(globalThis as any).localStorage) {
  const localStorageData = new Map<string, string>();
  const localStorageMock: Storage = {
    get length() {
      return localStorageData.size;
    },
    clear: () => localStorageData.clear(),
    getItem: (key: string) => localStorageData.get(key) ?? null,
    key: () => null,
    removeItem: (key: string) => { localStorageData.delete(key); },
    setItem: (key: string, value: string) => { localStorageData.set(key, value); },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, configurable: true });
}
