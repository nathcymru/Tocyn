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
if (!HTMLElement.prototype.getClientRects) HTMLElement.prototype.getClientRects = () => [] as unknown as DOMRectList;
if (typeof Range !== 'undefined' && !Range.prototype.getClientRects) Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
if (!HTMLElement.prototype.getBoundingClientRect) HTMLElement.prototype.getBoundingClientRect = () => new DOMRect();
// Tiptap renders a contenteditable instead of a native textarea. Keep legacy
// test helpers usable while assertions migrate to the editor's text content.
const htmlValue = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'value');
if (!htmlValue) Object.defineProperty(HTMLElement.prototype, 'value', {
  configurable: true,
  get() { return this.getAttribute('contenteditable') !== null ? this.textContent ?? '' : undefined; },
  set(next: string) { if (this.getAttribute('contenteditable') !== null) this.textContent = next; },
});

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
