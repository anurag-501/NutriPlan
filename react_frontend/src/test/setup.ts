import "@testing-library/jest-dom";

const localStorageValues = new Map<string, string>();
const localStorageShim: Storage = {
  get length() {
    return localStorageValues.size;
  },
  clear: () => localStorageValues.clear(),
  getItem: (key) => localStorageValues.get(String(key)) ?? null,
  key: (index) => [...localStorageValues.keys()][index] ?? null,
  removeItem: (key) => localStorageValues.delete(String(key)),
  setItem: (key, value) => localStorageValues.set(String(key), String(value)),
};

Object.defineProperty(globalThis, "localStorage", { configurable: true, value: localStorageShim });
Object.defineProperty(window, "localStorage", { configurable: true, value: localStorageShim });

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});
