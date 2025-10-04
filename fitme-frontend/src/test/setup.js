import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Node >= 25 ships its own (here unconfigured, undefined) global localStorage that shadows jsdom's.
for (const key of ['localStorage', 'sessionStorage']) {
  Object.defineProperty(globalThis, key, { value: globalThis.jsdom.window[key], configurable: true, writable: true });
}

// jsdom has no layout APIs
Element.prototype.scrollIntoView = () => {};

afterEach(() => {
  cleanup();
  localStorage.clear();
});
