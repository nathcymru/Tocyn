import '@testing-library/jest-dom';

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
