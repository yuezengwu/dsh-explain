import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/web.snapshot.ts'],
    hookTimeout: 120_000,
    testTimeout: 60_000,
    sequence: { concurrent: false },
  },
})
