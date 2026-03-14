import { test as base } from '@playwright/test';

export const test = base.extend({
  // Auto-reset DB before every test (runs even without page)
  baseURL: async ({ baseURL }, use) => {
    await fetch(`${baseURL}/api/test/reset`, { method: 'POST' });
    await use(baseURL!);
  },
});

export { expect } from '@playwright/test';
